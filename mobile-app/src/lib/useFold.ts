import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";

/**
 * A fold-out that never remembers being open.
 *
 * The calendar and the per-habit list used to store "open" as a preference, so one tap left
 * them unfolded for good: you came back to the report and got a screen full of detail
 * instead of the one number it exists for. Opening a section is an act, not a setting — it
 * lasts while you are looking at it and closes when you leave the screen.
 *
 * Closing happens on blur rather than on focus, so nothing flickers open-then-shut on the
 * way in, and a fresh launch starts closed because the state starts closed.
 */
export function useFold(): { open: boolean; toggle: () => void } {
  const [open, setOpen] = useState(false);

  useFocusEffect(
    useCallback(() => () => setOpen(false), []),
  );

  return { open, toggle: useCallback(() => setOpen((v) => !v), []) };
}

/**
 * The same thing for several fold-outs at once, keyed by id.
 *
 * Three groups on the checklist each hide their own "выполнено" pile, and three separate
 * useFold calls would tie the number of hooks to the number of groups. Same rule as above:
 * open is an act, and it does not survive leaving the screen.
 */
export function useFoldSet(): { isOpen: (id: string) => boolean; toggle: (id: string) => void } {
  const [open, setOpen] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => () => setOpen([]), []),
  );

  return {
    isOpen: useCallback((id: string) => open.includes(id), [open]),
    toggle: useCallback(
      (id: string) => setOpen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id])),
      [],
    ),
  };
}
