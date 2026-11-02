"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describeFailure, fetchExperiment, postWater } from "@/lib/client/api";
import { track } from "@/lib/client/analytics";
import { randomUuid } from "@/lib/client/visitor-hint";
import type { ExperimentSnapshot } from "@/lib/plant";
import { Toaster, type ToastInput, type ToastItem } from "./toaster";
import { TurnstileWidget, type TurnstileHandle } from "./turnstile";

type LoadStatus = "loading" | "ready" | "error";

interface ExperimentContextValue {
  snapshot: ExperimentSnapshot | null;
  status: LoadStatus;
  offline: boolean;
  watering: boolean;
  /** The visitor's own watering number from this session, for the share link. */
  contributionNumber: number | null;
  /** Increments on every successful watering; drives the droplet animation. */
  burst: number;
  /** When the state was last successfully fetched (ms since epoch). */
  checkedAt: number | null;
  water(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<ExperimentContextValue | null>(null);

export function useExperiment(): ExperimentContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useExperiment must be used inside <ExperimentProvider>");
  return value;
}

const POLL_MS = 30_000;
const STAGE_KEY = "he_last_stage";

function readLastStage(): number | null {
  try {
    const raw = window.localStorage.getItem(STAGE_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}
function writeLastStage(stage: number) {
  try {
    window.localStorage.setItem(STAGE_KEY, String(stage));
  } catch {
    /* storage blocked: milestones simply won't be remembered */
  }
}

let toastSeq = 0;

export function ExperimentProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ExperimentSnapshot | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [offline, setOffline] = useState(false);
  const [watering, setWatering] = useState(false);
  const [contributionNumber, setContributionNumber] = useState<number | null>(null);
  const [burst, setBurst] = useState(0);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const snapshotRef = useRef<ExperimentSnapshot | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const wateringRef = useRef(false);
  const pendingRequestId = useRef<string | null>(null);
  const viewedTracked = useRef(false);

  // Turnstile (optional)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
  const turnstileToken = useRef<string | null>(null);
  const turnstileHandle = useRef<TurnstileHandle | null>(null);
  const onTurnstileToken = useCallback((token: string | null) => {
    turnstileToken.current = token;
  }, []);

  const pushToast = useCallback((toast: ToastInput) => {
    const id = ++toastSeq;
    setToasts((all) => [...all.slice(-2), { ...toast, id }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  /** Single place where fresh state is applied, so milestone detection never misses one. */
  const applySnapshot = useCallback(
    (next: ExperimentSnapshot) => {
      snapshotRef.current = next;
      setSnapshot(next);
      setStatus("ready");

      const lastSeen = readLastStage();
      if (lastSeen !== null && next.growthStage > lastSeen) {
        pushToast({
          tone: "milestone",
          title: `Milestone: ${next.stageName}!`,
          body: `Strangers just grew the plant to ${next.totalWaterings.toLocaleString("en-US")} waterings.`,
        });
        track("milestone_unlocked", { stage: next.growthStage, stage_name: next.stageName });
      }
      if (lastSeen === null || next.growthStage !== lastSeen) writeLastStage(next.growthStage);

      if (!viewedTracked.current) {
        viewedTracked.current = true;
        track("experiment_viewed", { stage: next.growthStage, can_water: next.canWater });
      }
    },
    [pushToast],
  );

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      const result = await fetchExperiment();
      if (result.kind === "ok") {
        setOffline(false);
        setCheckedAt(Date.now());
        applySnapshot(result.data);
      } else if (result.kind === "network") {
        setOffline(true);
        if (!snapshotRef.current) setStatus("error");
      } else if (!snapshotRef.current) {
        setStatus("error");
      }
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [applySnapshot]);

  // Initial load, ~30s polling (paused while the tab is hidden), and recovery on reconnect.
  useEffect(() => {
    track("homepage_viewed");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      const jitter = Math.round((Math.random() - 0.5) * 6000); // spread load across visitors
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        schedule();
      }, POLL_MS + jitter);
    };

    void refresh();
    schedule();

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => {
      setOffline(false);
      void refresh();
    };
    const onOffline = () => setOffline(true);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  const water = useCallback(async () => {
    const current = snapshotRef.current;
    // Guard against repeated clicks while a request is in flight.
    if (wateringRef.current || !current?.canWater) return;

    if (siteKey && !turnstileToken.current) {
      pushToast({ tone: "info", title: "One sec…", body: "Running a quick human check. Tap again in a moment." });
      return;
    }

    wateringRef.current = true;
    setWatering(true);
    track("water_button_clicked", { stage: current.growthStage });

    // One idempotency key per attempt; reused when a retry may follow a request that landed.
    const requestId = (pendingRequestId.current ??= randomUuid());

    try {
      const result = await postWater({ requestId, turnstileToken: turnstileToken.current ?? undefined });

      if (result.kind === "ok") {
        pendingRequestId.current = null;
        const { experiment, contributionNumber: mine, duplicate } = result.data;
        setOffline(false);
        applySnapshot(experiment);
        setContributionNumber(mine);
        if (!duplicate) setBurst((n) => n + 1);
        pushToast({
          tone: "success",
          title: duplicate ? "Already counted!" : "Glug glug! The plant says thanks.",
          body: mine ? `You are watering #${mine.toLocaleString("en-US")}. Come back tomorrow.` : "Come back tomorrow.",
        });
        track("watering_success", { contribution: mine ?? 0, stage: experiment.growthStage });
        void refresh(); // refresh immediately after a successful watering
      } else {
        const failure = describeFailure(result);
        if (!failure.keepRequestId) pendingRequestId.current = null;
        if (result.kind === "http" && result.body.experiment) applySnapshot(result.body.experiment);
        if (result.kind === "network") setOffline(true);
        pushToast({ tone: failure.tone, title: failure.message });
        track("watering_rejected", { reason: result.kind === "network" ? "network" : result.code });
        if (failure.resetCaptcha) turnstileHandle.current?.reset();
      }
    } finally {
      if (siteKey) turnstileHandle.current?.reset(); // tokens are single-use
      wateringRef.current = false;
      setWatering(false);
    }
  }, [applySnapshot, pushToast, refresh, siteKey]);

  const value = useMemo<ExperimentContextValue>(
    () => ({ snapshot, status, offline, watering, contributionNumber, burst, checkedAt, water, refresh }),
    [snapshot, status, offline, watering, contributionNumber, burst, checkedAt, water, refresh],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {siteKey ? <TurnstileWidget siteKey={siteKey} onToken={onTurnstileToken} handleRef={turnstileHandle} /> : null}
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </Ctx.Provider>
  );
}
