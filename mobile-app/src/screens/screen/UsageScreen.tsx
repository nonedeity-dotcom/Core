import { useCallback, useEffect, useState } from "react";
import { AppState, Image, View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AppInfoEntry } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { useTodayKey } from "../../lib/useTodayKey";
import { datesBetween, weekdayLabel } from "../../lib/date";
import { syncFromCreker } from "../../integrations/screenTime";
import { syncUsage, hourlyFor, METRIC_LABELS, type Metric } from "../../integrations/usageSync";
import { hasUsageAccess, openUsageAccessSettings } from "../../../modules/creker-usage";
import { pickTextFile, saveTextFile } from "../../lib/backupFile";
import { fromCsv, toCsv } from "../../lib/screen/csv";
import { notify } from "../../lib/confirm";
import { formatCompact } from "../../lib/screen/duration";
import { dayCount, resolveSelection, shiftRange, type Selection } from "../../lib/screen/period";
import { describeChange, usageChange } from "../../lib/screen/compare";
import {
  earliestStoredDay,
  totalScreenMillis,
  totalsByApp,
  type AppDay,
  type ScreenDay,
} from "../../lib/screen/usage";
import UsageRing, { sliceColor } from "../../components/screen/UsageRing";
import ValueChart, { type ChartKind } from "../../components/screen/ValueChart";
import PeriodBar from "../../components/screen/PeriodBar";

const METRICS: Metric[] = ["usage", "sessions", "screen"];

/**
 * «Экран»: сколько времени ушло в телефон и куда именно.
 *
 * Приложение считает само по системным событиям. creker остаётся ровно для одного — отдать
 * историю за дни до установки, которых система уже не помнит.
 */
export default function UsageScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: object) => void };
}) {
  const qc = useQueryClient();
  const today = useTodayKey();
  const [selection, setSelection] = useState<Selection>({ kind: "preset", preset: "day" });
  const [metric, setMetric] = useState<Metric>("usage");
  const [chart, setChart] = useState<ChartKind>("bars");

  // Доступ выдаётся переключателем на системном экране, а не диалогом, — значит вернуться
  // оттуда можно с любым исходом, и спрашивать надо каждый раз при возвращении.
  const [access, setAccess] = useState<boolean>(() => hasUsageAccess());
  const refresh = useCallback(() => {
    const granted = hasUsageAccess();
    setAccess(granted);
    return granted;
  }, []);

  const range = resolveSelection(selection, today);
  const spanDays = dayCount(range);
  const single = spanDays === 1;
  // Предыдущий такой же период — то, с чем сравнивается текущий.
  const prev = shiftRange(range, -spanDays);

  const { data: days = [] } = useQuery<ScreenDay[]>({
    queryKey: ["screenDays", range.from, range.to],
    queryFn: () => api.getScreenDays(range.from, range.to),
  });
  const { data: allApps = [] } = useQuery<AppDay[]>({
    queryKey: ["screenApps", range.from, range.to],
    queryFn: () => api.getScreenApps(range.from, range.to),
  });
  const { data: prevDays = [] } = useQuery<ScreenDay[]>({
    queryKey: ["screenDays", prev.from, prev.to],
    queryFn: () => api.getScreenDays(prev.from, prev.to),
  });
  const { data: allPrevApps = [] } = useQuery<AppDay[]>({
    queryKey: ["screenApps", prev.from, prev.to],
    queryFn: () => api.getScreenApps(prev.from, prev.to),
  });
  const { data: everDays = [] } = useQuery<ScreenDay[]>({
    queryKey: ["screenDays", "all"],
    queryFn: () => api.getScreenDays("0000-01-01", "9999-12-31"),
  });
  const { data: everApps = [] } = useQuery<AppDay[]>({
    queryKey: ["screenApps", "all"],
    queryFn: () => api.getScreenApps("0000-01-01", "9999-12-31"),
  });
  const { data: icons = {} } = useQuery<Record<string, AppInfoEntry>>({
    queryKey: ["appInfo"],
    queryFn: () => api.getAppInfoCache(),
  });
  const { data: importedThrough } = useQuery<string | null>({
    queryKey: ["screenImported"],
    queryFn: () => api.getScreenImportedThrough(),
  });
  // Почасовая картина есть только у свежих дней: подробные события система хранит недолго.
  const { data: hourly } = useQuery({
    queryKey: ["hourly", range.from, metric, access],
    queryFn: () => hourlyFor(range.from, metric),
    enabled: single,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["screenDays"] });
    qc.invalidateQueries({ queryKey: ["screenApps"] });
    qc.invalidateQueries({ queryKey: ["appInfo"] });
    qc.invalidateQueries({ queryKey: ["hourly"] });
  };
  const measure = useMutation({ mutationFn: () => syncUsage(), onSuccess: invalidate });
  const importCreker = useMutation({
    mutationFn: () => syncFromCreker(),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["screenImported"] });
    },
  });

  /**
   * Выгрузка истории в файл и загрузка обратно.
   *
   * Тот же CSV, что пишет creker, — намеренно: файл, выгруженный там, читается здесь без
   * перевода. Это последний мост между приложениями, и он не требует, чтобы creker был
   * установлен, — достаточно файла с него.
   */
  const exportCsv = useMutation({
    mutationFn: async () => {
      const [d, a] = await Promise.all([
        api.getScreenDays("0000-01-01", "9999-12-31"),
        api.getScreenApps("0000-01-01", "9999-12-31"),
      ]);
      return saveTextFile(`screen-time-${today}.csv`, toCsv(d, a));
    },
    onSuccess: (r) =>
      notify(
        r.status === "cancelled" ? "Не сохранено" : "Файл готов",
        r.status === "cancelled"
          ? "Сохранение отменено — история осталась в приложении."
          : "История экранного времени выгружена. Тот же формат, что у creker.",
      ),
  });

  const importCsv = useMutation({
    mutationFn: async () => {
      const text = await pickTextFile();
      if (text === null) return null;
      const parsed = fromCsv(text);
      const written = await api.mergeScreenData(parsed.days, parsed.apps);
      return { ...parsed, written };
    },
    onSuccess: (r) => {
      if (r === null) return;
      invalidate();
      notify(
        "Загружено",
        `${r.days.length} ${plural(r.days.length, ["день", "дня", "дней"])} и ${r.apps.length} ${plural(
          r.apps.length,
          ["строка", "строки", "строк"],
        )} по приложениям.` +
          (r.skipped > 0
            ? ` ${r.skipped} ${plural(r.skipped, ["строку", "строки", "строк"])} прочитать не вышло — остальное загружено.`
            : ""),
      );
    },
  });

  // Пересчёт при открытии и при каждом возвращении: пропущенная неделя — это неделя,
  // которой уже не будет, система столько подробностей не хранит.
  useEffect(() => {
    if (refresh()) measure.mutate();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && refresh()) measure.mutate();
    });
    return () => sub.remove();
    // measure пересоздаётся на каждый рендер: подписка должна встать один раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  /**
   * Домашний экран — не приложение, но и не ничто.
   *
   * Он мелькает между всем остальным: каждый переход, каждая разблокировка. Отсюда и его
   * числа — часы времени и тысячи заходов, среди которых нет ни одного намеренного. В
   * «приложениях» и «заходах» ему поэтому не место: он забивал бы список тем, что человек
   * не выбирал.
   *
   * А в «экране» — место ровно его: это метрика про сам телефон, и оболочка телефона —
   * его часть, а не чужая. Там он идёт обычной строкой, со своим временем и заходами.
   */
  const home = new Set(
    Object.entries(icons)
      .filter(([, info]) => info.isHome)
      .map(([packageName]) => packageName),
  );
  const showHome = metric === "screen";
  const apps = showHome ? allApps : allApps.filter((r) => !home.has(r.packageName));
  const prevApps = showHome ? allPrevApps : allPrevApps.filter((r) => !home.has(r.packageName));
  const homeMs = allApps
    .filter((r) => home.has(r.packageName))
    .reduce((sum, r) => sum + r.usageMillis, 0);

  const screenMs = totalScreenMillis(days);
  const totals = totalsByApp(apps);
  const prevTotals = totalsByApp(prevApps);
  const prevByPackage = new Map(prevTotals.map((t) => [t.packageName, t] as const));
  const appsMs = totals.reduce((sum, t) => sum + t.usageMillis, 0);
  const launches = totals.reduce((sum, t) => sum + t.launchCount, 0);

  // Крупное число зависит от метрики, а кольцо — всегда про приложения: доли времени в
  // приложениях от экранного времени не считаются, экран бывает включён и без них.
  const headline =
    metric === "screen" ? screenMs : metric === "sessions" ? launches : appsMs;
  const prevHeadline =
    metric === "screen"
      ? totalScreenMillis(prevDays)
      : metric === "sessions"
        ? prevTotals.reduce((s, t) => s + t.launchCount, 0)
        : prevTotals.reduce((s, t) => s + t.usageMillis, 0);
  const change = usageChange(headline, prevHeadline, spanDays);

  const byDate = new Map(
    days.map((d) => [d.date, metric === "screen" ? d.screenMillis : 0] as const),
  );
  if (metric !== "screen") {
    for (const row of apps) {
      const add = metric === "sessions" ? row.launchCount : row.usageMillis;
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + add);
    }
  }
  const dayPoints = datesBetween(range.from, range.to).map((date) => ({
    key: date,
    label: weekdayLabel(date),
    value: byDate.get(date) ?? 0,
  }));
  // Часы подписаны все двадцать четыре — график прокручивается, места хватает.
  const hourPoints = (hourly ?? []).map((h) => ({
    key: `${h.hour}`,
    label: `${h.hour}`,
    value: h.value,
  }));

  const earliest = earliestStoredDay(everDays, everApps);
  // Период уходит глубже, чем мы помним: это не ноль, а незнание, и сказать надо прямо.
  const incomplete = earliest !== null && earliest > range.from;
  const empty = screenMs === 0 && totals.length === 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <PeriodBar selection={selection} onChange={setSelection} today={today} />

      <View style={styles.metrics}>
        {METRICS.map((m) => (
          <Pressable
            key={m}
            onPress={() => setMetric(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: metric === m }}
            accessibilityLabel={`Метрика: ${METRIC_LABELS[m]}`}
            style={({ pressed }) => [styles.metric, metric === m && styles.metricOn, pressed && styles.pressed]}
          >
            <Text style={[styles.metricText, metric === m && styles.metricTextOn]}>{METRIC_LABELS[m]}</Text>
          </Pressable>
        ))}
      </View>

      {!access && (
        <View style={styles.accessCard}>
          <Text style={styles.accessTitle}>Нет доступа к статистике</Text>
          <Text style={styles.hint}>
            Считать экранное время может только приложение, которому Android это разрешил.
            Разрешение выдаётся переключателем на системном экране — диалогом его не
            запросить. Ничего никуда не уходит: числа остаются на телефоне.
          </Text>
          <Pressable
            onPress={() => openUsageAccessSettings()}
            accessibilityRole="button"
            accessibilityLabel="Открыть настройки доступа"
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Открыть настройки</Text>
          </Pressable>
          <Text style={styles.footnote}>
            Найди «Стержень (тест)» в списке и включи переключатель. Вернувшись сюда,
            приложение пересчитает само.
          </Text>
        </View>
      )}

      {incomplete && (
        <View style={styles.warnCard}>
          <Text style={styles.warnText}>
            {`История начинается с ${earliest}. Всё, что раньше, здесь не ноль, а неизвестность — период показан не целиком.`}
          </Text>
        </View>
      )}

      {empty ? (
        <View style={styles.card}>
          <Text style={styles.hint}>
            {importedThrough === null
              ? access
                ? "Пока пусто: приложение только начало считать. Сегодняшний день появится в течение дня, а прошлое можно один раз забрать у creker кнопкой внизу."
                : "Считать пока нечем — нужен доступ к статистике использования."
              : "За этот период данных нет."}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            {metric === "sessions" ? (
              <>
                <Text style={styles.big}>{headline}</Text>
                <Text style={styles.bigUnit}>
                  {plural(headline, ["запуск", "запуска", "запусков"])}
                </Text>
              </>
            ) : (
              <UsageRing totals={totals} totalMs={headline} />
            )}
            {change && <Text style={styles.change}>{describeChange(change)}</Text>}
            {spanDays > 1 && metric !== "sessions" && (
              <Text style={styles.perDay}>
                {`${formatCompact(Math.round(headline / spanDays))} в день в среднем за ${spanDays} ${plural(
                  spanDays,
                  ["день", "дня", "дней"],
                )}`}
              </Text>
            )}

          </View>

          <View style={styles.card}>
            {/* Заголовка нет: подписи под графиком уже говорят, часы это или дни, а
                строка над ними только съедала высоту. */}
            <View style={styles.chartHead}>
              <ChartToggle kind={chart} onChange={setChart} />
            </View>
            {single ? (
              hourly ? (
                <ValueChart points={hourPoints} kind={chart} counts={metric === "sessions"} />
              ) : (
                <Text style={styles.hint}>
                  Почасовая картина есть только у последних дней: подробные события система
                  хранит недолго, а итог за день сохраняется навсегда.
                </Text>
              )
            ) : (
              <ValueChart points={dayPoints} kind={chart} counts={metric === "sessions"} />
            )}
          </View>

          <Text style={styles.sectionLabel}>
            {`Приложения · ${totals.length} ${plural(totals.length, ["штука", "штуки", "штук"])}`}
            {/* Приписка — только там, где его нет, и только когда он правда набрал время:
                иначе это объяснение того, чего человек не видел. */}
            {!showHome && homeMs > 0 ? ` · домашний экран (${formatCompact(homeMs)}) — в «Экране»` : ""}
          </Text>
          {totals.map((total, i) => {
            const before = prevByPackage.get(total.packageName);
            const appChange = usageChange(
              metric === "sessions" ? total.launchCount : total.usageMillis,
              before ? (metric === "sessions" ? before.launchCount : before.usageMillis) : 0,
              spanDays,
            );
            return (
              <Pressable
                key={total.packageName}
                onPress={() =>
                  navigation.navigate("AppUsage", { packageName: total.packageName, title: total.label })
                }
                accessibilityRole="button"
                accessibilityLabel={`${total.label}, ${formatCompact(total.usageMillis)}, ${Math.round(
                  total.shareOfTotal * 100,
                )} процентов`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                {/* Полоска за строкой — доля от самого большого приложения. Список
                    отсортирован по времени, и полоска делает разрыв между первым и пятым
                    видимым, не заставляя вычитать числа. */}
                <View
                  style={[styles.rowFill, { width: `${total.shareOfTop * 100}%`, backgroundColor: sliceColor(i) }]}
                />
                {icons[total.packageName]?.icon ? (
                  <Image
                    source={{ uri: icons[total.packageName].icon as string }}
                    style={styles.icon}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[styles.dot, { backgroundColor: sliceColor(i) }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {total.label}
                  </Text>
                  <Text style={styles.rowDetail} numberOfLines={1}>
                    {`${Math.round(total.shareOfTotal * 100)} % · ${total.launchCount} ${plural(
                      total.launchCount,
                      ["запуск", "запуска", "запусков"],
                    )}`}
                    {appChange ? ` · ${appChange.isDecrease ? "−" : "+"}${appChange.percent} %` : ""}
                  </Text>
                </View>
                <Text style={styles.rowValue}>
                  {metric === "sessions" ? `${total.launchCount}` : formatCompact(total.usageMillis)}
                </Text>
              </Pressable>
            );
          })}
        </>
      )}

      {/* Разовое действие, а не способ жить: приложение считает само, а у creker остаётся
          только то, что он намерил до этого. Забрал — и creker больше не нужен. */}
      <Pressable
        onPress={() => importCreker.mutate()}
        disabled={importCreker.isPending}
        accessibilityRole="button"
        accessibilityLabel="Перенести историю из creker"
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
      >
        <Feather name="download" size={15} color={colors.textMuted} />
        <Text style={styles.addText}>
          {importCreker.isPending ? "Забираю…" : "Перенести историю из creker"}
        </Text>
      </Pressable>
      {importCreker.isSuccess && (
        <Text style={styles.syncNote}>
          {importCreker.data.days === 0 && importCreker.data.apps === 0
            ? "creker ничего не ответил: он не установлен, не пускает это приложение или слишком старой сборки. Разреши доступ в настройках creker."
            : `Перенесено: ${importCreker.data.days} ${plural(importCreker.data.days, [
                "день",
                "дня",
                "дней",
              ])}, ${importCreker.data.apps} ${plural(importCreker.data.apps, [
                "строка",
                "строки",
                "строк",
              ])} по приложениям${importCreker.data.earliest ? `, начиная с ${importCreker.data.earliest}` : ""}.`}
        </Text>
      )}

      <View style={styles.fileRow}>
        <Pressable
          onPress={() => exportCsv.mutate()}
          accessibilityRole="button"
          accessibilityLabel="Сохранить историю в файл"
          style={({ pressed }) => [styles.addRow, styles.half, pressed && styles.pressed]}
        >
          <Feather name="upload" size={15} color={colors.textMuted} />
          <Text style={styles.addText}>В файл</Text>
        </Pressable>
        <Pressable
          onPress={() => importCsv.mutate()}
          accessibilityRole="button"
          accessibilityLabel="Загрузить историю из файла"
          style={({ pressed }) => [styles.addRow, styles.half, pressed && styles.pressed]}
        >
          <Feather name="file-text" size={15} color={colors.textMuted} />
          <Text style={styles.addText}>Из файла</Text>
        </Pressable>
      </View>

      <Text style={styles.footnote}>
        {access
          ? "Приложение считает само — creker для этого больше не нужен. Он пригодится один раз, чтобы забрать историю за дни до установки: система хранит подробные события всего несколько суток, и всё, что старше, есть только у него."
          : "Пока нет доступа, считать нечем. Историю из creker забрать всё равно можно — она уже сохранена внутри него."}
      </Text>
    </ScrollView>
  );
}

/**
 * Столбики или линия.
 *
 * Пара иконок, а не слова: подпись «столбчатая диаграмма» занимает больше места, чем сама
 * кнопка, и объясняет то, что видно по значку.
 */
export function ChartToggle({ kind, onChange }: { kind: ChartKind; onChange: (kind: ChartKind) => void }) {
  return (
    <View style={styles.toggle}>
      {(["bars", "line"] as ChartKind[]).map((k) => (
        <Pressable
          key={k}
          onPress={() => onChange(k)}
          accessibilityRole="radio"
          accessibilityState={{ selected: kind === k }}
          accessibilityLabel={k === "bars" ? "График столбиками" : "График линией"}
          style={({ pressed }) => [styles.toggleBtn, kind === k && styles.toggleOn, pressed && styles.pressed]}
        >
          <Feather
            name={k === "bars" ? "bar-chart-2" : "trending-up"}
            size={14}
            color={kind === k ? colors.bg : colors.textMuted}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  chartHead: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 10 },
  toggle: { flexDirection: "row", gap: 2, backgroundColor: colors.bg, borderRadius: 16, padding: 2 },
  toggleBtn: { width: 30, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  toggleOn: { backgroundColor: colors.accentGreen },
  metrics: { flexDirection: "row", gap: 6, marginBottom: 12 },
  metric: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  metricOn: { backgroundColor: "rgba(143,184,154,0.14)" },
  metricText: { color: colors.textMuted, fontSize: 12 },
  metricTextOn: { color: colors.accentGreen, fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  big: {
    color: colors.accentGreen,
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: -1,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  bigUnit: { color: colors.textMuted, fontSize: 12, textAlign: "center" },
  change: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 12 },
  perDay: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 6 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginTop: 6, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 6,
    overflow: "hidden",
  },
  rowFill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  icon: { width: 22, height: 22, borderRadius: 5 },
  pressed: { opacity: 0.75 },
  rowName: { color: colors.text, fontSize: 14 },
  rowDetail: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  warnCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  warnText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  accessCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  accessTitle: { color: colors.accent, fontSize: 14, fontWeight: "600", marginBottom: 6 },
  primary: {
    marginTop: 14,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.accentGreenDark,
  },
  primaryText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginTop: 10,
  },
  addText: { color: colors.textMuted, fontSize: 13 },
  fileRow: { flexDirection: "row", gap: 8 },
  half: { flex: 1, justifyContent: "center" },
  syncNote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
});
