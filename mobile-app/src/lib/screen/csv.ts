import { normalizeAppDay, normalizeScreenDay, type AppDay, type ScreenDay } from "./usage";

/**
 * Выгрузка и загрузка истории экранного времени.
 *
 * Перенос `core/UsageExport.kt` из creker: обычный CSV, без внешних форматов. Нужен ровно
 * для переезда на другой телефон — выгрузил там, открыл здесь. Битые строки пропускаются, а
 * не валят весь файл: наполовину восстановленная история лучше, чем никакой.
 *
 * Формат тот же, что у creker, намеренно: файл, выгруженный из creker, читается здесь без
 * перевода. Это последний мост между ними, и он не должен зависеть от того, что creker ещё
 * установлен.
 */

const HEADER = "type,package_name,date,value_millis,launch_count";

export function toCsv(days: ScreenDay[], apps: AppDay[]): string {
  const rows = [
    ...days.map((d) => `screen,,${d.date},${d.screenMillis},0`),
    ...apps.map((a) => `app,${escapeField(a.packageName)},${a.date},${a.usageMillis},${a.launchCount}`),
  ];
  return rows.length === 0 ? HEADER : `${HEADER}\n${rows.join("\n")}`;
}

/** Имя пакета запятых не содержит, но файл могли собрать не мы — на всякий случай. */
function escapeField(value: string): string {
  return value.replace(/[,\n\r]/g, "_");
}

export interface ParsedCsv {
  days: ScreenDay[];
  apps: AppDay[];
  /** Сколько строк не удалось прочитать. Ноль — файл разобран целиком. */
  skipped: number;
}

export function fromCsv(csv: string): ParsedCsv {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const body = lines[0]?.startsWith("type,") ? lines.slice(1) : lines;

  const days: ScreenDay[] = [];
  const apps: AppDay[] = [];
  let skipped = 0;

  for (const line of body) {
    const parts = line.split(",");
    if (parts.length < 5) {
      skipped++;
      continue;
    }
    const [kind, packageName, date, valueRaw, launchRaw] = parts;
    const value = Number(valueRaw);
    const launches = Number(launchRaw);
    if (!Number.isFinite(value)) {
      skipped++;
      continue;
    }

    if (kind === "screen") {
      // Досчитанность в файл не пишется: чужой файл не может поручиться за то, до какого
      // момента день был измерён здесь. Ноль — честное «неизвестно».
      const row = normalizeScreenDay({ date, screenMillis: value, updatedAt: 0 });
      if (row) days.push(row);
      else skipped++;
    } else if (kind === "app") {
      const row = normalizeAppDay({
        date,
        packageName,
        label: packageName,
        usageMillis: value,
        launchCount: Number.isFinite(launches) ? launches : 0,
      });
      if (row) apps.push(row);
      else skipped++;
    } else {
      skipped++;
    }
  }

  return { days, apps, skipped };
}
