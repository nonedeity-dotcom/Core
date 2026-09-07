import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { DEFAULT_TIP_PREFS, rotationFor, type TipPrefs } from "./tipLibrary";
import type { Tip } from "../content/library";

// The counter must move once per "opening the app", and a launch and a return
// from the background are both that. Advancing on mount alone isn't enough:
// Android usually keeps the process alive, so tapping the icon again often
// doesn't re-run any of this — the tip would look stuck. This module-level
// flag makes the mount step fire once per JS session rather than once per
// mount, so a remount (a data import invalidating queries, say) doesn't skip
// a tip.
let advancedThisSession = false;

export interface RotatingTip {
  tip: Tip;
  /** 1-based, for display: "Подсказка 7 из 39". */
  number: number;
  total: number;
}

export function useRotatingTip(): RotatingTip | null {
  const [index, setIndex] = useState<number | null>(null);
  // The rotation is what is left after your own edits — hidden tips are gone from it, your
  // own are in it, and the order is yours. So its length is not known until this loads.
  const { data: prefs = DEFAULT_TIP_PREFS, isSuccess } = useQuery<TipPrefs>({
    queryKey: ["tipPrefs"],
    queryFn: () => api.getTipPrefs(),
  });
  const rotation = rotationFor(prefs);
  const length = rotation.length;

  useEffect(() => {
    if (!isSuccess || length === 0) return;
    let alive = true;
    const show = (i: number) => {
      if (alive) setIndex(i);
    };

    (advancedThisSession ? api.getTipCursor() : api.advanceTipCursor(length)).then(show);
    advancedThisSession = true;

    let previous = AppState.currentState;
    const sub = AppState.addEventListener("change", (state) => {
      // Only background -> active counts as reopening. A notification shade,
      // a permission dialog or the app switcher produce inactive -> active,
      // and burning a tip on those would make the number jump for no reason
      // the user can see.
      if (previous === "background" && state === "active") {
        api.advanceTipCursor(length).then(show);
      }
      previous = state;
    });

    return () => {
      alive = false;
      sub.remove();
    };
    // Only the length: re-running this on every edit to a tip's text would burn a step of
    // the rotation for a typo fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, length]);

  if (index === null || length === 0) return null;
  const safe = ((index % length) + length) % length;
  return { tip: rotation[safe], number: safe + 1, total: length };
}
