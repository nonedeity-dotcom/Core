import { useRef } from "react";
import type { HabitLog } from "../types";

/**
 * Одинаковы ли два списка отметок по смыслу.
 *
 * `id` не сравнивается намеренно: пока запись идёт, отметка живёт в кэше под временным
 * `id: "temp"`, а когда приходит перезагрузка — под настоящим. Содержание то же самое, и
 * пересчитывать из-за этого серию и положение всех привычек незачем.
 */
export function sameLogs(a: HabitLog[], b: HabitLog[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (
      x.habitId !== y.habitId ||
      x.date !== y.date ||
      x.count !== y.count ||
      x.done !== y.done ||
      x.minimal !== y.minimal ||
      x.manual !== y.manual
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Список отметок, который не меняет ссылку, пока не изменилось его содержание.
 *
 * Каждое нажатие на задачу даёт несколько перерисовок подряд: сначала оптимистичная отметка,
 * потом перезагрузка с теми же данными, но другими `id`. Всё, что считается от списка
 * (серия, положение каждой привычки, начисление шансов), без этого пересчитывалось заново
 * на каждую из них. Возвращать нужно только для расчётов: для записи и удаления по `id`
 * берите исходный список.
 */
export function useStableLogs(next: HabitLog[]): HabitLog[] {
  const ref = useRef(next);
  if (ref.current !== next && !sameLogs(ref.current, next)) ref.current = next;
  return ref.current;
}
