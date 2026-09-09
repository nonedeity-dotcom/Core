/**
 * Как показать длительность.
 *
 * Перенесено из creker (`core/DurationFormatter.kt`) один в один, включая решения, которые
 * там уже приняты и обоснованы: часы не заворачиваются на 24 (месячный итог законно бывает
 * `127:45:10`, и любое другое поведение молча потеряет сутки), а секунды исчезают, как
 * только появляются минуты, — на этом масштабе они шум.
 */

/** Односимвольные подписи единиц. */
export interface DurationUnits {
  hours: string;
  minutes: string;
  seconds: string;
}

export const RU_UNITS: DurationUnits = { hours: "ч", minutes: "м", seconds: "с" };

function split(durationMs: number): [number, number, number] {
  const total = Math.floor(Math.max(0, durationMs) / 1000);
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `чч:мм:сс` — форма фиксированной ширины для большого числа. */
export function formatDuration(durationMs: number): string {
  const [h, m, s] = split(durationMs);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** `1ч 34м 36с`, без единиц, которые были бы ведущими нулями. */
export function formatWithUnits(durationMs: number, units: DurationUnits = RU_UNITS): string {
  const [h, m, s] = split(durationMs);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}${units.hours}`);
  if (h > 0 || m > 0) parts.push(`${m}${units.minutes}`);
  parts.push(`${s}${units.seconds}`);
  return parts.join(" ");
}

/** Самая короткая честная форма — для подписи под столбиком: `2ч 15м`, `41м`, `40с`. */
export function formatCompact(durationMs: number, units: DurationUnits = RU_UNITS): string {
  const [h, m, s] = split(durationMs);
  if (h > 0) return `${h}${units.hours} ${m}${units.minutes}`;
  if (m > 0) return `${m}${units.minutes}`;
  return `${s}${units.seconds}`;
}

/**
 * Одно деление оси — в той единице, которой требует её верх.
 *
 * `formatCompact` выбирает единицу под каждое значение: это правильно над столбиком и
 * неправильно вдоль оси. Ось с потолком в полчаса выходила подписанной «30м / 15м / 0с» —
 * три деления в двух единицах. Единица выбирается один раз, по потолку.
 */
export function formatAxisTick(valueMs: number, axisMaxMs: number, units: DurationUnits = RU_UNITS): string {
  const seconds = Math.floor(Math.max(0, valueMs) / 1000);
  const maxSeconds = Math.floor(Math.max(0, axisMaxMs) / 1000);
  // Порог — две единицы, а не одна. При потолке в час сорок часы давали «1ч / 0ч / 0ч»:
  // два деления из трёх читались одинаково, и ось переставала быть осью. Минуты на том же
  // потолке дают «100м / 50м / 0м» — длиннее, но это три разных числа.
  if (maxSeconds >= 2 * 3600) return `${Math.floor(seconds / 3600)}${units.hours}`;
  if (maxSeconds >= 2 * 60) return `${Math.floor(seconds / 60)}${units.minutes}`;
  return `${seconds}${units.seconds}`;
}
