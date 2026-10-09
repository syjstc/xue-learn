import { useLayoutEffect, useRef } from "react";
import {
  NavigationType,
  useLocation,
  useNavigationType,
  type Location,
} from "react-router-dom";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

const localPositions: SavedScrollPositions = {};

const STORAGE_KEY = "xuelearn:route-scroll-positions";
const MAX_SAVED_POSITIONS = 100;
const RESTORE_TIMEOUT_MS = 5_000;

type ScrollPosition = {
  x: number;
  y: number;
};

type SavedScrollPositions = Record<string, ScrollPosition>;

function readPositions(): SavedScrollPositions {
  if (isDesktopLocalRuntime()) return localPositions;
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as SavedScrollPositions) : {};
  } catch {
    return {};
  }
}

function savePosition(key: string, position: ScrollPosition) {
  if (isDesktopLocalRuntime()) {
    delete localPositions[key];
    localPositions[key] = position;
    const keys = Object.keys(localPositions);
    for (const staleKey of keys.slice(0, -MAX_SAVED_POSITIONS)) {
      delete localPositions[staleKey];
    }
    return;
  }
  try {
    const positions = readPositions();
    delete positions[key];
    positions[key] = position;

    const entries = Object.entries(positions);
    const boundedPositions =
      entries.length > MAX_SAVED_POSITIONS
        ? Object.fromEntries(entries.slice(-MAX_SAVED_POSITIONS))
        : positions;

    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(boundedPositions),
    );
  } catch {
    // Scroll restoration is an enhancement; storage may be unavailable.
  }
}

function getSavedPosition(key: string): ScrollPosition | undefined {
  return readPositions()[key];
}

function scrollToPosition(position: ScrollPosition) {
  window.scrollTo({
    left: position.x,
    top: position.y,
    behavior: "instant",
  });
}

function getMaximumScrollY() {
  return (
    Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ) - window.innerHeight
  );
}

function restorePositionWhenReady(position: ScrollPosition) {
  scrollToPosition(position);

  if (
    typeof ResizeObserver === "undefined" ||
    getMaximumScrollY() >= position.y
  ) {
    return () => {};
  }

  let timeout = 0;
  const observer = new ResizeObserver(() => {
    scrollToPosition(position);
    if (getMaximumScrollY() >= position.y) {
      window.clearTimeout(timeout);
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement);
  observer.observe(document.body);

  timeout = window.setTimeout(() => {
    scrollToPosition(position);
    observer.disconnect();
  }, RESTORE_TIMEOUT_MS);

  return () => {
    window.clearTimeout(timeout);
    observer.disconnect();
  };
}

function scrollToHash(hash: string) {
  if (!hash) return false;

  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    id = hash.slice(1);
  }

  const target = document.getElementById(id);
  if (!target) return false;

  target.scrollIntoView({ behavior: "instant", block: "start" });
  return true;
}

export function resolveScrollAction({
  current,
  previous,
  navigationType,
  savedPosition,
}: {
  current: Pick<Location, "pathname" | "hash">;
  previous: Pick<Location, "pathname" | "hash"> | null;
  navigationType: NavigationType;
  savedPosition?: ScrollPosition;
}): "hash" | "preserve" | "restore" | "top" {
  if (current.hash && current.hash !== previous?.hash) return "hash";
  if (!previous || current.pathname === previous.pathname) return "preserve";
  if (navigationType === NavigationType.Pop && savedPosition) return "restore";
  return "top";
}

export function ScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousLocationRef = useRef<Location | null>(null);

  useLayoutEffect(() => {
    const previousLocation = previousLocationRef.current;
    const savedPosition = getSavedPosition(location.key);
    const action = resolveScrollAction({
      current: location,
      previous: previousLocation,
      navigationType,
      savedPosition,
    });

    let stopDelayedRestore = () => {};

    if (action === "hash") {
      scrollToHash(location.hash);
    } else if (action === "restore" && savedPosition) {
      stopDelayedRestore = restorePositionWhenReady(savedPosition);
    } else if (action === "top") {
      scrollToPosition({ x: 0, y: 0 });
    }

    previousLocationRef.current = location;

    return () => {
      stopDelayedRestore();
      savePosition(location.key, {
        x: window.scrollX,
        y: window.scrollY,
      });
    };
  }, [location, navigationType]);

  useLayoutEffect(() => {
    const previousBehavior = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousBehavior;
    };
  }, []);

  return null;
}
