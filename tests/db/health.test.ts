import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import {
  getState,
  setHealth,
  setLastHealthDaysAgo,
  stateRow,
  water,
  waterMany,
} from "../helpers/actions";

// Each test gets a pristine database so health arithmetic is easy to reason about.
let db: TestDatabase;
beforeEach(async () => {
  db = await createTestDatabase();
});
afterEach(async () => {
  await db.drop();
});

describe("daily decay", () => {
  it("starts at 70 and does not decay on the day it was created", async () => {
    const r = await getState(db.pool());
    expect(r.state?.health).toBe(70);
  });

  it("applies 2 points per elapsed UTC day", async () => {
    await setLastHealthDaysAgo(db.admin, 3);
    const r = await getState(db.pool());
    expect(r.state?.health).toBe(64);
    expect((await stateRow(db.admin)).health).toBe(64); // persisted, not just displayed
  });

  it("calculates a day exactly once, however often state is read", async () => {
    await setLastHealthDaysAgo(db.admin, 1);
    for (let i = 0; i < 5; i++) {
      const r = await getState(db.pool());
      expect(r.state?.health).toBe(68);
    }
    const s = await stateRow(db.admin);
    expect(s.health).toBe(68);
    const today = (await db.admin.query("select (now() at time zone 'utc')::date::text as d")).rows[0].d;
    expect(s.last_health_date).toBe(today);
  });

  it("processes pending days once when the first request of a new day is a watering", async () => {
    await setLastHealthDaysAgo(db.admin, 2);
    const r = await water(db.pool(), "first-of-day");
    expect(r.ok).toBe(true);
    expect(r.state?.health).toBe(66); // 70 - 2*2, no recovery yet (1 watering)
    // A read straight afterwards must not decay again.
    expect((await getState(db.pool())).state?.health).toBe(66);
  });

  it("never drops below 0, even after a very long absence", async () => {
    await setLastHealthDaysAgo(db.admin, 400);
    const r = await getState(db.pool());
    expect(r.state?.health).toBe(0);
  });

  it("matches the public view's effective health before processing", async () => {
    await setLastHealthDaysAgo(db.admin, 4);
    const view = await db.admin.query("select health from public.public_experiment_state");
    expect(view.rows[0].health).toBe(62);
    // Reading the view must not mutate state.
    expect((await stateRow(db.admin)).health).toBe(70);
  });
});

describe("recovery: +1 health per 10 valid waterings in a UTC day", () => {
  it("does not recover before the 10th watering", async () => {
    await setHealth(db.admin, 50);
    const results = await waterMany(db.pool(), 9);
    expect(results.at(-1)?.state?.health).toBe(50);
  });

  it("recovers exactly 1 point on the 10th watering", async () => {
    await setHealth(db.admin, 50);
    const results = await waterMany(db.pool(), 10);
    expect(results[8].state?.health).toBe(50);
    expect(results[9].state?.health).toBe(51);
  });

  it("recovers 3 points across 30 waterings in one day", async () => {
    await setHealth(db.admin, 50);
    await waterMany(db.pool(), 30);
    expect((await stateRow(db.admin)).health).toBe(53);
  });

  it("counts waterings per UTC day from real events (yesterday's do not carry over)", async () => {
    await setHealth(db.admin, 50);
    await waterMany(db.pool(), 9);
    // Push those 9 events into yesterday (UTC): they must not count towards today's 10.
    await db.admin.query(
      "update public.watering_events set watered_at = watered_at - interval '1 day'",
    );
    await setLastHealthDaysAgo(db.admin, 1);
    const r = await water(db.pool(), "today-1");
    // Yesterday's decay (-2) applied once; only 1 watering today, so no recovery.
    expect(r.state?.health).toBe(48);
  });

  it("caps health at 100", async () => {
    await setHealth(db.admin, 100);
    await waterMany(db.pool(), 10);
    expect((await stateRow(db.admin)).health).toBe(100);
  });

  it("recovers from 0", async () => {
    await setHealth(db.admin, 0);
    await waterMany(db.pool(), 10);
    expect((await stateRow(db.admin)).health).toBe(1);
  });
});

describe("decay and recovery together", () => {
  it("applies decay for the gap first, then recovery from the new day's waterings", async () => {
    await setHealth(db.admin, 60);
    await setLastHealthDaysAgo(db.admin, 2); // -4 → 56
    const results = await waterMany(db.pool(), 10); // +1 on the 10th
    expect(results[0].state?.health).toBe(56);
    expect(results[9].state?.health).toBe(57);
    expect((await stateRow(db.admin)).health).toBe(57);
  });
});
