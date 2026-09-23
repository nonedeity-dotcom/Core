/**
 * Самый маленький набор для проверок — без сторонних библиотек.
 *
 * Раньше проверки жили одноразовыми скриптами: написал, прогнал, удалил. Всё, что они
 * ловили, дальше ничем не было защищено — следующая правка могла сломать то же место, и
 * никто бы не узнал. Теперь они лежат здесь и гоняются одной командой: `npm test`.
 *
 * Библиотеку для тестов не тянем намеренно: проверкам нужны три функции, а зависимость в
 * сборке — это то, что однажды перестанет ставиться.
 */

let failed = 0;
let passed = 0;
let current = "";

export function test(name: string, body: () => void): void {
  current = name;
  try {
    body();
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: упало с ошибкой — ${(e as Error).message}`);
  }
}

export function eq(label: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    passed++;
    return;
  }
  failed++;
  console.log(`  ✗ ${current} → ${label}\n      получено ${a}\n      ждали   ${b}`);
}

export function ok(label: string, cond: boolean): void {
  eq(label, cond, true);
}

export function summary(): { passed: number; failed: number } {
  return { passed, failed };
}
