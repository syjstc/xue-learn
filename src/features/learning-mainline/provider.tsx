import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  LearningPosition,
  MainlineActivity,
  MainlineResolvedPosition,
  MainlineCommand,
  MainlineSnapshot,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { apiGet, apiPost } from "@/shared/api";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import {
  currentLearningPosition,
  learningSessionId,
  learningReturnPath,
  queueLearningReturn,
} from "@/features/learning-trajectory/navigation";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { mainlineEnabled } from "./enabled.ts";
import { recoverDeletedActivity } from "./recover-deleted-activity.ts";

const base = "/api/learning-trajectory/mainline";
type Command = Omit<
  MainlineCommand,
  "commandId" | "sessionId" | "expectedRevision"
>;
type Value = {
  snapshot: MainlineSnapshot | null;
  current: MainlineActivity | null;
  sessionId: string;
  busy: boolean;
  timeLimitMinutes: number | undefined;
  setTimeLimitMinutes: (value: number | undefined) => void;
  command: (command: Command) => Promise<MainlineSnapshot>;
  resume: (activity: MainlineActivity) => Promise<void>;
  returnToSource: () => Promise<void>;
};
const Context = createContext<Value | null>(null);
export function useMainline() {
  return useContext(Context);
}
export function MainlineProvider({ children }: { children: ReactNode }) {
  const enabled = mainlineEnabled("persistence");
  const navigate = useNavigate(),
    location = useLocation(),
    t = useT();
  const [sessionId] = useState(() =>
    enabled ? learningSessionId() : "disabled",
  );
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>();
  const [snapshot, setSnapshot] = useState<MainlineSnapshot | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const state = useRef(snapshot),
    queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef<LearningPosition | null>(null),
    lastSaved = useRef("");
  const retry = useRef<(() => Promise<unknown>) | null>(null);
  const currentRoute = useRef(location.pathname);
  const navigationIntent = useRef(0);
  currentRoute.current = location.pathname;
  const publish = (value: MainlineSnapshot) => {
    if (state.current && value.focus.revision < state.current.focus.revision)
      return;
    if (value.focus.activityId !== state.current?.focus.activityId) {
      pending.current = null;
      lastSaved.current = "";
    }
    state.current = value;
    setSnapshot(value);
  };
  const command = useCallback(
    (input: Command): Promise<MainlineSnapshot> => {
      const task = async () => {
        let value = state.current;
        if (!value) {
          value = await apiGet<MainlineSnapshot>(
            `${base}?sessionId=${encodeURIComponent(sessionId)}`,
          );
          publish(value);
        }
        const current = value.activities.find(
          (a) => a.id === value!.focus.activityId,
        );
        const payload: MainlineCommand = {
          ...input,
          commandId: crypto.randomUUID(),
          sessionId,
          expectedRevision: value.focus.revision,
          ...(input.action === "position" ||
          input.action === "pause" ||
          input.action === "return"
            ? {
                activityId: input.activityId ?? current?.id,
                activityRevision: input.activityRevision ?? current?.revision,
              }
            : {}),
        };
        const execute = async () => {
          let result: MainlineSnapshot;
          try {
            result = await apiPost<MainlineSnapshot>(
              `${base}/commands`,
              payload,
            );
          } catch (error) {
            const recovered = await recoverDeletedActivity(error, payload, () =>
              apiGet<MainlineSnapshot>(
                `${base}?sessionId=${encodeURIComponent(sessionId)}`,
              ),
            );
            if (!recovered) throw error;
            pending.current = null;
            lastSaved.current = "";
            result = recovered;
          }
          publish(result);
          setError(null);
          retry.current = null;
          return result;
        };
        try {
          return await execute();
        } catch (e) {
          retry.current = execute;
          setError(e);
          throw e;
        }
      };
      const result = queue.current.then(task);
      queue.current = result.catch(() => undefined);
      return result;
    },
    [sessionId],
  );
  const flush = useCallback(async () => {
    const current = state.current?.activities.find(
      (a) => a.id === state.current?.focus.activityId,
    );
    const position = pending.current;
    if (
      !current ||
      !position ||
      position.unitId !== current.unitId ||
      JSON.stringify(position) === lastSaved.current
    )
      return;
    await command({ action: "position", position, activityId: current.id });
    lastSaved.current = JSON.stringify(position);
    if (pending.current === position) pending.current = null;
  }, [command]);
  const resume = useCallback(
    async (activity: MainlineActivity) => {
      const intent = ++navigationIntent.current;
      const from = currentRoute.current;
      const stillRequested = () =>
        intent === navigationIntent.current && currentRoute.current === from;
      setBusy(true);
      try {
        await flush();
        const result = await apiGet<MainlineResolvedPosition>(
          `${base}/activities/${encodeURIComponent(activity.id)}/position`,
        );
        if (!stillRequested()) return;
        if (!result.position) {
          navigate(
            result.goalId
              ? `/goals/${encodeURIComponent(result.goalId)}?view=plan&positionAdjusted=1`
              : "/goals?positionAdjusted=1",
          );
          setNotice(t("mainline.adjusted"));
          return;
        }
        let target = activity;
        if (state.current?.focus.activityId !== activity.id) {
          const saved = await command({
            action: "resume",
            activityId: activity.id,
          });
          target =
            saved.activities.find((a) => a.id === saved.focus.activityId) ??
            activity;
        }
        if (!stillRequested()) return;
        if (
          activity.position.blockIdentity ||
          activity.position.sectionId ||
          activity.position.classroom
        )
          queueLearningReturn(result.position);
        if (
          !result.exact &&
          (activity.position.blockIdentity ||
            activity.position.sectionId ||
            activity.position.classroom)
        )
          setNotice(t("mainline.adjusted"));
        const path =
          target.kind === "review"
            ? target.reviewSource === "flashcards"
              ? `/reviews?tab=flashcards&mainlineUnit=${encodeURIComponent(target.unitId)}`
              : `/reviews/${encodeURIComponent(target.goalId)}/${encodeURIComponent(target.unitId)}`
            : activity.kind === "supplement" && activity.branchId
              ? `/goals/${encodeURIComponent(activity.goalId)}/units/${encodeURIComponent(activity.unitId)}/supplements/${encodeURIComponent(activity.branchId)}${target.visitId ? `?learningVisit=${encodeURIComponent(target.visitId)}` : ""}`
              : learningReturnPath(activity.goalId, result.position);
        navigate(path);
      } catch (e) {
        setError(e);
        retry.current = () => resume(activity);
      } finally {
        setBusy(false);
      }
    },
    [command, flush, navigate],
  );
  const returnToSource = useCallback(async () => {
    await flush();
    const value = await command({ action: "return" });
    const current = value.activities.find(
      (a) => a.id === value.focus.activityId,
    );
    if (current) await resume(current);
  }, [command, flush, resume]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiGet<MainlineSnapshot>(
      `${base}?sessionId=${encodeURIComponent(sessionId)}`,
    )
      .then((v) => {
        if (!cancelled) publish(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, sessionId]);
  useEffect(() => {
    if (!enabled) return;
    const remember = (event: Event) => {
      const position = (event as CustomEvent<LearningPosition>).detail;
      const current = state.current?.activities.find(
        (a) => a.id === state.current?.focus.activityId,
      );
      if (
        !current ||
        position.unitId !== current.unitId ||
        (current.kind === "supplement" &&
          position.sectionId !== current.position.sectionId)
      )
        return;
      pending.current = position;
    };
    window.addEventListener("learning-position-changed", remember);
    const interval = setInterval(() => {
      if (!retry.current) void flush().catch(() => undefined);
    }, 2000);
    return () => {
      window.removeEventListener("learning-position-changed", remember);
      clearInterval(interval);
    };
  }, [enabled, flush]);
  // Persist before link-driven switches; a failed save leaves the current page mounted.
  useEffect(() => {
    if (!enabled) return;
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (
        url.origin !== window.location.origin ||
        url.pathname === window.location.pathname ||
        !state.current?.focus.activityId
      )
        return;
      const current = state.current.activities.find(
        (a) => a.id === state.current?.focus.activityId,
      );
      navigationIntent.current++;
      const captured = current
        ? currentLearningPosition(current.position)
        : undefined;
      if (captured) pending.current = captured;
      event.preventDefault();
      event.stopPropagation();
      setBusy(true);
      void flush()
        .then(() => navigate(`${url.pathname}${url.search}${url.hash}`))
        .catch(() => undefined)
        .finally(() => setBusy(false));
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [enabled, flush, navigate]);
  const startupChecked = useRef(false);
  useEffect(() => {
    if (!enabled || !snapshot || startupChecked.current) return;
    startupChecked.current = true;
    if (!["/", "/goals", "/today", "/spaces"].includes(location.pathname))
      return;
    const latest =
      snapshot.activities.find((a) => a.id === snapshot.focus.activityId) ??
      snapshot.activities[0];
    if (latest) void resume(latest);
  }, [enabled, snapshot, location.pathname, resume]);
  const tracked = useRef("");
  useEffect(() => {
    if (!enabled || !snapshot) return;
    const match = location.pathname.match(
      /^\/goals\/([^/]+)\/units\/([^/]+)(?:\/(lesson-performance|supplements)\/?([^/]*))?$/,
    );
    if (!match || match[3] === "supplements") {
      tracked.current = "";
      return;
    } // Supplements enter only through the owned visit command.
    const goalId = decodeURIComponent(match[1]),
      unitId = decodeURIComponent(match[2]);
    const current = state.current?.activities.find(
      (a) => a.id === state.current?.focus.activityId,
    );
    const routeKey = `${goalId}:${unitId}`;
    if (
      current?.unitId === unitId &&
      current.kind === "lesson" &&
      current.state !== "ended"
    ) {
      if (tracked.current !== routeKey) {
        tracked.current = routeKey;
        if (
          current.position.blockIdentity ||
          current.position.sectionId ||
          current.position.classroom
        )
          queueLearningReturn(current.position);
      }
      return;
    }
    if (tracked.current === routeKey) return;
    tracked.current = routeKey;
    const task = async () => {
      await flush();
      if (currentRoute.current !== location.pathname) return;
      const saved = await command({
        action: "start",
        goalId,
        unitId,
        kind: "lesson",
      });
      const active = saved.activities.find(
        (a) => a.id === saved.focus.activityId,
      );
      if (
        active &&
        currentRoute.current === location.pathname &&
        (active.position.blockIdentity ||
          active.position.sectionId ||
          active.position.classroom)
      )
        queueLearningReturn(active.position);
    };
    void task().catch((e) => {
      tracked.current = "";
      setError(e);
      retry.current = task;
    });
  }, [enabled, location.pathname, snapshot, command, flush]);
  const current =
    snapshot?.activities.find((a) => a.id === snapshot.focus.activityId) ??
    null;
  return (
    <Context.Provider
      value={
        enabled
          ? {
              snapshot,
              current,
              sessionId,
              busy,
              timeLimitMinutes,
              setTimeLimitMinutes,
              command,
              resume,
              returnToSource,
            }
          : null
      }
    >
      {notice && enabled ? (
        <button
          type="button"
          className="fixed bottom-4 left-4 z-40 max-w-md rounded-lg border border-border bg-background p-3 text-sm shadow"
          onClick={() => setNotice("")}
          role="status"
        >
          {notice}
        </button>
      ) : null}
      {error && enabled ? (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 max-w-md rounded-xl border border-border bg-background p-4 shadow-lg"
        >
          <ApiErrorNotice
            error={error}
            fallback={t("mainline.saveError")}
            onRetry={() => {
              void (
                retry.current
                  ? retry.current()
                  : apiGet<MainlineSnapshot>(
                      `${base}?sessionId=${encodeURIComponent(sessionId)}`,
                    ).then(publish)
              )
                .then(() => setError(null))
                .catch(setError);
            }}
          />
        </div>
      ) : null}
      {children}
    </Context.Provider>
  );
}
