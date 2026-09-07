import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** Minutes since local midnight, right now. */
export function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The clock, to the minute, for the screens that show a habit's window.
 *
 * A minute is the finest thing any of this cares about, so it ticks once a minute rather
 * than on a timer nobody reads — a window closing at 23:00 should close on the screen you
 * are looking at, not on the next time something else happens to re-render.
 *
 * Also re-read on returning from the background: a phone left in a pocket for six hours runs
 * no timers, and the first thing it should do on waking is stop claiming it is still morning.
 */
export function useNowMinutes(): number {
  const [minutes, setMinutes] = useState(nowMinutes);

  useEffect(() => {
    const id = setInterval(() => setMinutes(nowMinutes()), 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setMinutes(nowMinutes());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  return minutes;
}
