import { SECTIONS, TIPS, type Tip } from "../content/library";

/**
 * The reference, as it is after your own edits.
 *
 * The built-in tips stay in code — they are the app's argument, they ship with it and they
 * are what a fresh install has to say. What is stored here is the difference between that
 * and what you actually want to read: lines rewritten, ones you never want to see again,
 * ones you wrote yourself, and the order the rotation goes through them in.
 *
 * Which is also why "удалить" a built-in tip hides it rather than erasing it: there is
 * nothing on the device to erase, the tip lives in the bundle. Hidden is honest about that,
 * and it means a tip binned in a bad mood can come back.
 */

export interface TipOverride {
  short?: string;
  full?: string;
  /** null clears the built-in caveat; undefined leaves it alone. */
  caveat?: string | null;
  rotate?: boolean;
}

export interface CustomTip {
  id: string;
  section: string;
  short: string;
  full: string;
  rotate: boolean;
}

export interface TipPrefs {
  /** Ids of built-in tips taken out of the reference and the rotation. */
  hidden: string[];
  /** Edits to built-in tips, by id. */
  overrides: Record<string, TipOverride>;
  /** Tips written on the phone. */
  custom: CustomTip[];
  /**
   * The rotation order, by id. Empty means "the order they are written in"; anything in the
   * rotation but missing from this list keeps its natural place at the end, so a new tip
   * appearing does not need every stored order rewritten.
   */
  order: string[];
}

export const DEFAULT_TIP_PREFS: TipPrefs = { hidden: [], overrides: {}, custom: [], order: [] };

/** A short line is the whole point of a tip; past this it stops fitting on one row. */
export const MAX_TIP_SHORT = 120;

const BUILT_IN_IDS = new Set(TIPS.map((t) => t.id));

export function isBuiltIn(id: string): boolean {
  return BUILT_IN_IDS.has(id);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

export function normalizeTipPrefs(value: unknown): TipPrefs {
  if (typeof value !== "object" || value === null) return DEFAULT_TIP_PREFS;
  const v = value as Record<string, unknown>;

  const hidden = Array.isArray(v.hidden) ? v.hidden.filter(isStr) : [];

  const overrides: Record<string, TipOverride> = {};
  if (typeof v.overrides === "object" && v.overrides !== null) {
    for (const [id, raw] of Object.entries(v.overrides as Record<string, unknown>)) {
      if (typeof raw !== "object" || raw === null) continue;
      const o = raw as Record<string, unknown>;
      const entry: TipOverride = {};
      if (isStr(o.short)) entry.short = o.short;
      if (isStr(o.full)) entry.full = o.full;
      if (isStr(o.caveat) || o.caveat === null) entry.caveat = o.caveat as string | null;
      if (typeof o.rotate === "boolean") entry.rotate = o.rotate;
      if (Object.keys(entry).length > 0) overrides[id] = entry;
    }
  }

  const sections = new Set(SECTIONS.map((s) => s.id));
  const custom: CustomTip[] = [];
  if (Array.isArray(v.custom)) {
    for (const raw of v.custom) {
      if (typeof raw !== "object" || raw === null) continue;
      const c = raw as Record<string, unknown>;
      if (!isStr(c.id) || !isStr(c.short) || c.short.trim() === "") continue;
      custom.push({
        id: c.id,
        section: isStr(c.section) && sections.has(c.section) ? c.section : SECTIONS[0].id,
        short: c.short,
        full: isStr(c.full) ? c.full : "",
        rotate: c.rotate !== false,
      });
    }
  }

  return { hidden, overrides, custom, order: Array.isArray(v.order) ? v.order.filter(isStr) : [] };
}

function applyOverride(tip: Tip, override: TipOverride | undefined): Tip {
  if (!override) return tip;
  const next: Tip = { ...tip };
  if (override.short !== undefined) next.short = override.short;
  if (override.full !== undefined) next.full = override.full;
  if (override.rotate !== undefined) next.rotate = override.rotate;
  if (override.caveat !== undefined) {
    if (override.caveat === null) delete next.caveat;
    else next.caveat = override.caveat;
  }
  return next;
}

/** Every tip the app should show: the built-ins you kept, as you edited them, then your own. */
export function allTips(prefs: TipPrefs): Tip[] {
  const hidden = new Set(prefs.hidden);
  const built = TIPS.filter((t) => !hidden.has(t.id)).map((t) => applyOverride(t, prefs.overrides[t.id]));
  const custom: Tip[] = prefs.custom.map((c) => ({
    id: c.id,
    section: c.section,
    short: c.short,
    full: c.full,
    rotate: c.rotate,
  }));
  return [...built, ...custom];
}

export function tipsInSectionFor(prefs: TipPrefs, sectionId: string): Tip[] {
  return allTips(prefs).filter((t) => t.section === sectionId);
}

/**
 * The rotation, in the order it will actually run.
 *
 * Ids listed in `order` come first, in that order; everything else follows in the order it
 * is written. So moving one tip does not silently freeze the position of all the others.
 */
export function rotationFor(prefs: TipPrefs): Tip[] {
  const candidates = allTips(prefs).filter((t) => t.rotate);
  if (prefs.order.length === 0) return candidates;

  const byId = new Map(candidates.map((t) => [t.id, t]));
  const out: Tip[] = [];
  for (const id of prefs.order) {
    const tip = byId.get(id);
    if (tip && !out.includes(tip)) out.push(tip);
  }
  for (const tip of candidates) if (!out.includes(tip)) out.push(tip);
  return out;
}

/** 1-based position in the rotation, or null for a tip that is reference-only. */
export function rotationNumberFor(prefs: TipPrefs, tipId: string): number | null {
  const i = rotationFor(prefs).findIndex((t) => t.id === tipId);
  return i < 0 ? null : i + 1;
}

/**
 * Puts one tip at a given 1-based position and writes down the whole resulting order.
 *
 * Storing the full list rather than just the moved id is the point: "third" only means
 * anything relative to everything else, and half an order is a rule that changes whenever
 * an unrelated tip is added.
 */
export function withTipMovedTo(prefs: TipPrefs, tipId: string, position: number): TipPrefs {
  const ids = rotationFor(prefs).map((t) => t.id);
  const from = ids.indexOf(tipId);
  if (from < 0) return prefs;
  const target = Math.min(ids.length, Math.max(1, Math.round(position))) - 1;
  if (from === target) return prefs;
  ids.splice(from, 1);
  ids.splice(target, 0, tipId);
  return { ...prefs, order: ids };
}

/** Hides a built-in tip, or drops a custom one for good. */
export function withTipRemoved(prefs: TipPrefs, tipId: string): TipPrefs {
  if (!isBuiltIn(tipId)) {
    return {
      ...prefs,
      custom: prefs.custom.filter((c) => c.id !== tipId),
      order: prefs.order.filter((id) => id !== tipId),
      overrides: prefs.overrides,
    };
  }
  return prefs.hidden.includes(tipId) ? prefs : { ...prefs, hidden: [...prefs.hidden, tipId] };
}

/** How many built-in tips are currently hidden — what the "вернуть" row counts. */
export function hiddenCount(prefs: TipPrefs): number {
  return prefs.hidden.filter(isBuiltIn).length;
}
