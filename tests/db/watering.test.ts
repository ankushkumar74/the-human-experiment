import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, fakeVisitorHash, type TestDatabase } from "../helpers/db";
import { ageEvents, eventCount, getState, stateRow, water } from "../helpers/actions";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

describe("seeded experiment", () => {
  it("starts with zero waterings, health 70 and the Seed stage", async () => {
    const s = await stateRow(db.admin);
    expect(s.total).toBe(0);
    expect(s.health).toBe(70);
    expect(s.growth_stage).toBe(0);
  });

  it("reports a fresh visitor as able to water, with no next-eligible time", async () => {
    const r = await getState(db.pool(), "fresh");
    expect(r.ok).toBe(true);
    expect(r.can_water).toBe(true);
    expect(r.next_eligible_at).toBeNull();
    expect(r.state?.total_waterings).toBe(0);
  });

  it("does not create participants or events just by reading state", async () => {
    await getState(db.pool(), "reader");
    const p = await db.admin.query("select count(*)::int as n from public.participants");
    expect(p.rows[0].n).toBe(0);
    expect(await eventCount(db.admin)).toBe(0);
  });
});

describe("a valid watering", () => {
  it("records the event, bumps the counter and returns the updated state", async () => {
    const pool = db.pool();
    const before = Date.now();
    const r = await water(pool, "alice");

    expect(r.ok).toBe(true);
    expect(r.code).toBe("watered");
    expect(r.contribution_number).toBe(1);
    expect(r.state?.total_waterings).toBe(1);
    expect(r.state?.health).toBe(70);

    // Next eligible time is 24h after the SERVER timestamp.
    const next = new Date(r.next_eligible_at!).getTime();
    expect(next).toBeGreaterThanOrEqual(before + 24 * 3600_000 - 1000);
    expect(next).toBeLessThanOrEqual(Date.now() + 24 * 3600_000 + 1000);

    const s = await stateRow(db.admin);
    expect(s.total).toBe(1);
    expect(await eventCount(db.admin)).toBe(1);
  });

  it("stores only the hash of the visitor, never anything raw", async () => {
    const rows = await db.admin.query("select visitor_hash from public.participants");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].visitor_hash).toBe(fakeVisitorHash("alice"));
    expect(rows.rows[0].visitor_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("then reports that visitor as unable to water until the cooldown ends", async () => {
    const r = await getState(db.pool(), "alice");
    expect(r.can_water).toBe(false);
    expect(r.next_eligible_at).not.toBeNull();
  });
});

describe("cooldown", () => {
  it("rejects a second watering inside 24h and records nothing", async () => {
    const pool = db.pool();
    const before = await eventCount(db.admin);

    const r = await water(pool, "alice");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("cooldown");
    expect(r.retry_after_seconds).toBeGreaterThan(24 * 3600 - 60);
    expect(r.retry_after_seconds).toBeLessThanOrEqual(24 * 3600);
    expect(new Date(r.next_eligible_at!).getTime()).toBeGreaterThan(Date.now());

    expect(await eventCount(db.admin)).toBe(before);
    expect((await stateRow(db.admin)).total).toBe(before);
  });

  it("still rejects just under 24h", async () => {
    await ageEvents(db.admin, 23); // alice's watering is now 23h old
    const r = await water(db.pool(), "alice");
    expect(r.code).toBe("cooldown");
  });

  it("allows watering again once 24h have passed", async () => {
    await ageEvents(db.admin, 2); // now 25h old
    const r = await water(db.pool(), "alice");
    expect(r.ok).toBe(true);
    expect(r.code).toBe("watered");
    expect(r.contribution_number).toBe(2);
  });

  it("keeps a single participant row for a returning visitor", async () => {
    const p = await db.admin.query("select count(*)::int as n from public.participants");
    expect(p.rows[0].n).toBe(1);
  });

  it("tracks cooldowns per visitor, not globally", async () => {
    const r = await water(db.pool(), "bob");
    expect(r.ok).toBe(true);
  });
});

describe("duplicate submissions", () => {
  it("a retried request_id returns the original result and adds nothing", async () => {
    const pool = db.pool();
    const requestId = randomUUID();
    const first = await water(pool, "carol", requestId);
    expect(first.code).toBe("watered");

    const before = await eventCount(db.admin);
    const retry = await water(pool, "carol", requestId);
    expect(retry.ok).toBe(true);
    expect(retry.code).toBe("duplicate");
    expect(retry.contribution_number).toBe(first.contribution_number);
    expect(await eventCount(db.admin)).toBe(before);
  });

  it("a new request_id inside the cooldown is a cooldown, not a duplicate", async () => {
    const r = await water(db.pool(), "carol", randomUUID());
    expect(r.code).toBe("cooldown");
  });
});

describe("input validation inside the database", () => {
  it("rejects a malformed visitor hash", async () => {
    const res = await db.pool().query(
      "select public.water_experiment('save-the-plant', 'not-a-hash', null) as r",
    );
    expect(res.rows[0].r).toMatchObject({ ok: false, code: "invalid_visitor" });
  });

  it("rejects a null visitor hash", async () => {
    const res = await db.pool().query(
      "select public.water_experiment('save-the-plant', null, null) as r",
    );
    expect(res.rows[0].r).toMatchObject({ ok: false, code: "invalid_visitor" });
  });

  it("returns not_found for an unknown experiment", async () => {
    const r = await water(db.pool(), "dave", null, "no-such-experiment");
    expect(r).toMatchObject({ ok: false, code: "not_found" });
  });

  it("refuses to water a paused experiment", async () => {
    await db.admin.query("update public.experiments set status = 'paused'");
    const r = await water(db.pool(), "erin");
    expect(r).toMatchObject({ ok: false, code: "inactive" });
    const s = await getState(db.pool(), "erin");
    expect(s.can_water).toBe(false);
    await db.admin.query("update public.experiments set status = 'active'");
  });
});

describe("state consistency", () => {
  it("total_waterings always equals the number of events and the max sequence", async () => {
    const res = await db.admin.query(
      `select s.total_waterings::int as total,
              (select count(*)::int from public.watering_events) as events,
              (select coalesce(max(sequence_number), 0)::int from public.watering_events) as max_seq
         from public.experiment_state s`,
    );
    const { total, events, max_seq } = res.rows[0];
    expect(total).toBe(events);
    expect(total).toBe(max_seq);
  });

  it("sequence numbers are exactly 1..N with no gaps", async () => {
    const res = await db.admin.query(
      "select sequence_number::int as n from public.watering_events order by sequence_number",
    );
    res.rows.forEach((row, i) => expect(row.n).toBe(i + 1));
  });
});
