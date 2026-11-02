import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, fakeVisitorHash, type TestDatabase } from "../helpers/db";
import {
  eventCount,
  getState,
  setHealth,
  setLastHealthDaysAgo,
  stateRow,
  water,
} from "../helpers/actions";

/**
 * These tests fire genuinely parallel requests, each on its own PostgreSQL
 * connection, at the real RPC. They prove the row lock serialises everything:
 * no lost counter updates, no cooldown bypass, no duplicate events.
 */

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

describe("concurrent waterings", () => {
  it("60 simultaneous visitors → exactly 60 waterings, none lost, sequence 1..60", async () => {
    const pool = db.pool("service_role", 60);
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => water(pool, `par-${i}`)));

    expect(results.every((r) => r.ok && r.code === "watered")).toBe(true);

    const s = await stateRow(db.admin);
    expect(s.total).toBe(60);
    expect(await eventCount(db.admin)).toBe(60);

    const seqs = (
      await db.admin.query("select sequence_number::int as n from public.watering_events order by 1")
    ).rows.map((r) => r.n);
    expect(seqs).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));

    // Every caller was told a distinct contribution number.
    const numbers = new Set(results.map((r) => r.contribution_number));
    expect(numbers.size).toBe(60);

    // Growth stage is consistent with the final total (60 ≥ 25 → Sprout).
    expect(s.growth_stage).toBe(1);
  });

  it("30 simultaneous attempts by the SAME visitor → exactly one succeeds", async () => {
    const pool = db.pool("service_role", 30);
    const before = await eventCount(db.admin);

    const results = await Promise.all(Array.from({ length: 30 }, () => water(pool, "same-visitor")));

    const ok = results.filter((r) => r.ok);
    const cooldown = results.filter((r) => r.code === "cooldown");
    expect(ok).toHaveLength(1);
    expect(cooldown).toHaveLength(29);
    expect(await eventCount(db.admin)).toBe(before + 1);

    const participants = await db.admin.query(
      "select count(*)::int as n from public.participants where visitor_hash = $1",
      [fakeVisitorHash("same-visitor")],
    );
    expect(participants.rows[0].n).toBe(1);
  });

  it("the same request_id sent 20 times at once is recorded once", async () => {
    const pool = db.pool("service_role", 20);
    const requestId = randomUUID();
    const before = await eventCount(db.admin);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => water(pool, "double-clicker", requestId)),
    );

    expect(results.filter((r) => r.code === "watered")).toHaveLength(1);
    expect(results.filter((r) => r.code === "duplicate")).toHaveLength(19);
    expect(await eventCount(db.admin)).toBe(before + 1);

    const numbers = new Set(results.map((r) => r.contribution_number));
    expect(numbers.size).toBe(1);
  });

  it("a mixed burst (new visitors + repeat visitors) keeps every invariant", async () => {
    const pool = db.pool("service_role", 80);
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 40; i++) jobs.push(water(pool, `mix-new-${i}`));
    for (let i = 0; i < 40; i++) jobs.push(water(pool, `par-${i % 10}`)); // already watered above
    jobs.push(...Array.from({ length: 20 }, () => getState(pool, "mix-new-3")));
    await Promise.all(jobs);

    const res = await db.admin.query(
      `select s.total_waterings::int as total,
              (select count(*)::int from public.watering_events) as events,
              (select max(sequence_number)::int from public.watering_events) as max_seq,
              (select count(*)::int from (select participant_id from public.watering_events
                                          group by participant_id having count(*) > 1) d) as repeaters
         from public.experiment_state s`,
    );
    const { total, events, max_seq, repeaters } = res.rows[0];
    expect(total).toBe(events);
    expect(total).toBe(max_seq);
    expect(repeaters).toBe(0); // nobody got in twice inside the cooldown
  });
});

describe("concurrent daily health processing", () => {
  it("decays a pending day exactly once under heavy parallel reads and writes", async () => {
    const fresh = await createTestDatabase();
    try {
      await setHealth(fresh.admin, 70);
      await setLastHealthDaysAgo(fresh.admin, 2); // 2 pending days → -4

      const pool = fresh.pool("service_role", 60);
      const jobs: Promise<unknown>[] = [];
      for (let i = 0; i < 30; i++) jobs.push(getState(pool, `r${i}`));
      for (let i = 0; i < 10; i++) jobs.push(water(pool, `w${i}`)); // 10 waterings → +1
      for (let i = 0; i < 20; i++) jobs.push(getState(pool, null));
      await Promise.all(jobs);

      // 70 - (2 days × 2) + 1 recovery = 67. Double-processing would give 63.
      const s = await stateRow(fresh.admin);
      expect(s.total).toBe(10);
      expect(s.health).toBe(67);
    } finally {
      await fresh.drop();
    }
  });
});
