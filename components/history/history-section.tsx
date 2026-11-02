"use client";

import { useEffect, useState } from "react";
import { useExperiment } from "@/components/experiment/experiment-provider";
import { fetchHistory } from "@/lib/client/api";
import { formatCount, formatDay, formatLocalTime } from "@/lib/client/format";
import type { ExperimentHistory } from "@/lib/history";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; history: ExperimentHistory; at: number };

/** Fills gaps so the chart always shows consecutive days (a quiet day is a real zero). */
function fillDays(history: ExperimentHistory, now: number, count = 14) {
  const byDay = new Map(history.days.map((d) => [d.day, d]));
  const last = new Date(now).toISOString().slice(0, 10); // today, UTC
  const [y, m, d] = last.split("-").map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10);
    out.push(byDay.get(date) ?? { day: date, waterings: 0, participants: 0 });
  }
  return out;
}

export function HistorySection() {
  const { snapshot } = useExperiment();
  const total = snapshot?.totalWaterings ?? null;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  // Load on mount and again whenever the global total changes (e.g. right after you water).
  useEffect(() => {
    const controller = new AbortController();
    fetchHistory(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.kind === "ok") setState({ kind: "ready", history: result.data, at: Date.now() });
      else setState((prev) => (prev.kind === "ready" ? prev : { kind: "error" }));
    });
    return () => controller.abort();
  }, [total]);

  return (
    <section id="history" aria-labelledby="history-title" className="scroll-mt-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h2 id="history-title" className="font-display text-3xl font-bold leading-tight sm:text-4xl">
          Experiment history
        </h2>
        <p className="text-sm text-ink-soft">Real waterings only. Days are counted in UTC.</p>
      </div>

      {state.kind === "loading" ? (
        <div className="card h-64 animate-pulse bg-paper-deep" aria-busy="true" aria-label="Loading history" />
      ) : state.kind === "error" ? (
        <div className="card bg-white p-6">
          <p className="font-medium">We couldn’t load the history just now. It will show up when the connection is back.</p>
        </div>
      ) : (
        <HistoryBody history={state.history} now={state.at} active={active} setActive={setActive} table={table} setTable={setTable} />
      )}
    </section>
  );
}

function HistoryBody({
  history,
  now,
  active,
  setActive,
  table,
  setTable,
}: {
  history: ExperimentHistory;
  now: number;
  active: number | null;
  setActive: (i: number | null) => void;
  table: boolean;
  setTable: (v: boolean) => void;
}) {
  if (history.totalWaterings === 0) {
    return (
      <div className="card bg-white p-6 sm:p-8">
        <p className="font-display text-2xl font-bold">Nothing to chart yet.</p>
        <p className="mt-2 max-w-xl text-ink-soft">
          The experiment has just started and nobody has watered the plant. The first watering will start this history. Be the first stranger.
        </p>
      </div>
    );
  }

  const days = fillDays(history, now);
  const max = Math.max(1, ...days.map((d) => d.waterings));
  const today = days.at(-1)!;
  const best = days.reduce((a, b) => (b.waterings > a.waterings ? b : a), days[0]);
  const running = Math.max(1, Math.ceil((now - Date.parse(history.startedAt)) / 86_400_000));
  const shown = active !== null ? days[active] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="card bg-white p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold">Waterings per day</h3>
            <p className="text-sm text-ink-soft" aria-live="polite">
              {shown ? (
                <>
                  <strong className="text-ink">{formatDay(shown.day)}</strong>: {formatCount(shown.waterings)}{" "}
                  {shown.waterings === 1 ? "watering" : "waterings"} from {formatCount(shown.participants)}{" "}
                  {shown.participants === 1 ? "browser" : "browsers"}
                </>
              ) : (
                <>Last 14 days · busiest: {formatDay(best.day)} ({formatCount(best.waterings)})</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTable(!table)}
            aria-pressed={table}
            className="rounded-full border-[2.5px] border-ink px-3 py-1 text-sm font-semibold hover:bg-ink/5"
          >
            {table ? "Show chart" : "Show as table"}
          </button>
        </div>

        {table ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Waterings and distinct browsers per UTC day, oldest first</caption>
              <thead>
                <tr className="border-b-2 border-ink">
                  <th scope="col" className="py-2 pr-4">Day (UTC)</th>
                  <th scope="col" className="py-2 pr-4 text-right">Waterings</th>
                  <th scope="col" className="py-2 text-right">Browsers</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => (
                  <tr key={d.day} className="border-b border-ink/15">
                    <th scope="row" className="py-1.5 pr-4 font-medium">{formatDay(d.day)}</th>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{formatCount(d.waterings)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCount(d.participants)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div role="group" aria-label="Waterings per day, last 14 days" onMouseLeave={() => setActive(null)}>
            <div className="relative flex h-44 items-end gap-1 sm:h-56 lg:h-64 border-b-2 border-ink/40 sm:gap-1.5">
              {/* recessive gridline at the maximum */}
              <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-dashed border-ink/20" />
              <span aria-hidden="true" className="absolute left-0 top-[-1.15rem] text-[11px] font-semibold text-ink-soft">{formatCount(max)}</span>
              {days.map((d, i) => {
                const pct = d.waterings === 0 ? 0 : Math.max(4, Math.round((d.waterings / max) * 100));
                const isToday = i === days.length - 1;
                return (
                  <button
                    key={d.day}
                    type="button"
                    aria-label={`${formatDay(d.day)}: ${d.waterings} waterings from ${d.participants} browsers`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-md"
                  >
                    <span
                      className={`block w-full rounded-t-[6px] border-2 border-b-0 border-ink transition-[filter] group-hover:brightness-95 ${isToday ? "bg-lavender" : "bg-acid"} ${d.waterings === 0 ? "border-transparent" : ""}`}
                      style={{ height: `${pct}%` }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-xs text-ink-soft" aria-hidden="true">
              <span>{formatDay(days[0].day)}</span>
              <span>Today (so far): {formatCount(today.waterings)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <Stat label="Total waterings" value={formatCount(history.totalWaterings)} />
          <Stat label="Different browsers" value={formatCount(history.totalVisitors)} />
          <Stat label="Days running" value={formatCount(running)} />
        </dl>
        <div className="card bg-white p-5">
          <h3 className="font-display text-lg font-bold">Milestones</h3>
          <ol className="mt-3 space-y-2">
            {history.milestones.length === 0 ? (
              <li className="text-sm text-ink-soft">No stage reached yet. “Sprout” unlocks at 25 waterings.</li>
            ) : (
              history.milestones.map((m) => (
                <li key={m.stage} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-display font-bold">{m.name}</span>
                  <span className="text-ink-soft">{formatCount(m.threshold)} · {formatLocalTime(m.reachedAt)}</span>
                </li>
              ))
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border-[3px] border-ink bg-white px-3 py-3 shadow-[3px_3px_0_0_var(--color-ink)] sm:px-4">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-soft sm:text-xs">{label}</dt>
      <dd className="font-display text-2xl font-bold tabular-nums sm:text-3xl">{value}</dd>
    </div>
  );
}
