import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AppInfoEntry } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { useTodayKey } from "../../lib/useTodayKey";
import { datesBetween, weekdayLabel } from "../../lib/date";
import { syncFromCreker } from "../../integrations/screenTime";
import {
  syncUsage,
  resolveAppInfo,
  hourlyFor,
  METRIC_LABELS,
  SCOPE_LABELS,
  type Metric,
  type Scope,
} from "../../integrations/usageSync";
import { hasUsageAccess, openUsageAccessSettings } from "../../../modules/creker-usage";
import { pickTextFile, saveTextFile } from "../../lib/backupFile";
import { fromCsv, toCsv } from "../../lib/screen/csv";
import { notify } from "../../lib/confirm";
import { formatCompact, formatDuration } from "../../lib/screen/duration";
import { dayCount, resolveSelection, shiftRange, type Selection } from "../../lib/screen/period";
import { describeChange, usageChange } from "../../lib/screen/compare";
import {
  daysWithoutUnlocks,
  earliestStoredDay,
  totalScreenMillis,
  totalUnlocks,
  relabel,
  totalsByApp,
  type AppDay,
  type AppTotal,
  type ScreenDay,
} from "../../lib/screen/usage";
import UsageRing, { sliceColor } from "../../components/screen/UsageRing";
import ValueChart, { type ChartKind } from "../../components/screen/ValueChart";
import PeriodBar from "../../components/screen/PeriodBar";

const SCOPES: Scope[] = ["all", "apps", "phone"];
const SORTS: Metric[] = ["time", "launches"];
/** Условный пакет строки «Телефон» — своего у неё нет, она собрана из нескольких. */
const PHONE = "__phone__";

/**
 * «Экран»: сколько времени ушло в телефон и куда именно.
 *
 * Разделено на две части и их сумму. «Приложения» — то, что человек выбирал открыть.
 * «Телефон» — всё остальное, что было на включённом экране: рабочий стол, шторка,
 * «недавние», переходы между приложениями. «Общий» — сумма, она же время включённого
 * экрана.
 *
 * Части считаются вычитанием, а не сложением кусочков: приложения известны точно, экранное
 * время известно точно, а «телефон» — это разница. Складывать пришлось бы то, чего система
 * не называет: у шторки нет своего имени в потоке событий, она просто отсутствие приложения.
 */
export default function UsageScreen({
  navigation,
}: {
  navigation: { navigate: (screen: string, params?: object) => void };
}) {
  const qc = useQueryClient();
  const today = useTodayKey();
  const [selection, setSelection] = useState<Selection>({ kind: "preset", preset: "day" });
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<Metric>("time");
  const [chart, setChart] = useState<ChartKind>("bars");

  const [access, setAccess] = useState<boolean>(() => hasUsageAccess());
  const refresh = useCallback(() => {
    const granted = hasUsageAccess();
    setAccess(granted);
    return granted;
  }, []);

  const range = resolveSelection(selection, today);
  const spanDays = dayCount(range);
  const single = spanDays === 1;
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

  /** Пакеты, про которые систему уже спрашивали: спрашивать второй раз нечего. */
  const asked = useRef(new Set<string>());

  const homeList = Object.entries(icons)
    .filter(([, info]) => info.isHome)
    .map(([packageName]) => packageName);
  const home = new Set(homeList);
  /**
   * Имена берутся из справочника, а не из строк дня.
   *
   * Иконка и так рисуется по справочнику — и раньше выходило, что у строки правильная
   * иконка и имя пакета рядом с ней. Справочник знает про приложение больше, чем строка,
   * записанная когда-то давно или пришедшая из файла, где имён не было вовсе.
   */
  const names = Object.fromEntries(Object.entries(icons).map(([pkg, info]) => [pkg, info.label]));

  const { data: hourly } = useQuery({
    queryKey: ["hourly", range.from, scope, access],
    queryFn: () => hourlyFor(range.from, scope, homeList),
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
      // В файле имён нет — только пакеты, у creker так же. Настоящие имена и иконки
      // спрашиваются у системы здесь же, иначе загруженные дни навсегда остались бы
      // списком вида `com.zhiliaoapp.musically`.
      const cache = await resolveAppInfo(parsed.apps.map((a) => a.packageName));
      const apps = relabel(
        parsed.apps,
        Object.fromEntries(Object.entries(cache).map(([pkg, info]) => [pkg, info.label])),
      );
      await api.mergeScreenData(parsed.days, apps);
      return parsed;
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
   * Дособрать справочник по уже сохранённой истории.
   *
   * Дни, загруженные из файла, приходят без имён вовсе, и спросить систему в тот момент
   * могло быть некому: доступ к статистике мог быть ещё не выдан. Здесь список уже открыт —
   * значит, самое время дособрать недостающее и один раз обновить экран.
   *
   * Спрошенное запоминается на время жизни экрана: про удалённое приложение система молчит,
   * и без этой памяти запрос уходил бы снова на каждую перерисовку.
   */
  useEffect(() => {
    const missing = [...new Set(allApps.map((r) => r.packageName))].filter(
      (p) => !icons[p] && !asked.current.has(p),
    );
    if (missing.length === 0) return;
    for (const p of missing) asked.current.add(p);
    void resolveAppInfo(missing).then(() => qc.invalidateQueries({ queryKey: ["appInfo"] }));
  }, [allApps, icons, qc]);

  /**
   * Числа одной группы за период.
   *
   * У телефона считаются не открытия рабочего стола, а разблокировки. Открытий рабочего
   * стола за день бывают сотни, и ни одного из них человек не помнит; «сколько раз я
   * сегодня брался за телефон» — вопрос, на который ответ хочется знать.
   */
  const measureOf = (dayRows: ScreenDay[], appRows: AppDay[]) => {
    const screenMs = totalScreenMillis(dayRows);
    const apps = appRows.filter((r) => !home.has(r.packageName));
    const appsMs = apps.reduce((sum, r) => sum + r.usageMillis, 0);
    const appsLaunches = apps.reduce((sum, r) => sum + r.launchCount, 0);
    const unlocks = totalUnlocks(dayRows);
    // Телефон — разница, а не сумма кусочков: у шторки нет своего имени в событиях.
    const phoneMs = Math.max(0, screenMs - appsMs);
    return {
      all: { time: screenMs, launches: appsLaunches + unlocks },
      apps: { time: appsMs, launches: appsLaunches },
      phone: { time: phoneMs, launches: unlocks },
    };
  };

  /** Как называть счётчик в этой группе: у телефона это не заходы. */
  const countWord = (n: number, forScope: Scope): string =>
    forScope === "phone"
      ? plural(n, ["разблокировка", "разблокировки", "разблокировок"])
      : plural(n, ["заход", "захода", "заходов"]);

  /**
   * Сколько сохранённых дней не знают про свои разблокировки.
   *
   * Дни, которых в истории нет вовсе, сюда не входят: у них нет и экранного времени, и это
   * другой разговор, который ведёт пустое состояние выше.
   */
  const blindDays = daysWithoutUnlocks(days);

  const now = measureOf(days, allApps);
  const before = measureOf(prevDays, allPrevApps);
  const value = now[scope];
  const change = usageChange(value.time, before[scope].time, spanDays);

  /**
   * Список под карточкой.
   *
   * В «общем» к приложениям добавляется одна строка «Телефон» — тогда сумма строк равна
   * крупному числу над ними, и ничего не надо досчитывать в уме. В «телефоне» списка нет:
   * список из одной строки — это не список.
   */
  const appTotals = totalsByApp(relabel(allApps.filter((r) => !home.has(r.packageName)), names));
  const phoneRow: AppTotal = {
    packageName: PHONE,
    label: "Телефон",
    usageMillis: now.phone.time,
    launchCount: now.phone.launches,
    daysUsed: spanDays,
    shareOfTop: 0,
    shareOfTotal: 0,
  };
  /**
   * Чем меряется строка списка — тем же, чем он отсортирован.
   *
   * Иначе выходила бы бессмыслица: список выстроен по заходам, а доля рядом посчитана от
   * времени, и первая строка оказывалась бы «20 %», а третья «40 %».
   */
  const weigh = (row: AppTotal) => (sort === "launches" ? row.launchCount : row.usageMillis);
  const rows =
    scope === "phone" ? [] : [...appTotals, ...(scope === "apps" ? [] : [phoneRow])].sort((a, b) => weigh(b) - weigh(a));
  const rowsSum = rows.reduce((sum, r) => sum + weigh(r), 0);
  const topRow = rows.reduce((m, r) => Math.max(m, weigh(r)), 0);

  const prevByPackage = new Map(
    totalsByApp(relabel(allPrevApps.filter((r) => !home.has(r.packageName)), names)).map(
      (t) => [t.packageName, t] as const,
    ),
  );

  const byDate = new Map<string, { screen: number; apps: number; launches: number; unlocks: number }>();
  for (const date of datesBetween(range.from, range.to)) {
    byDate.set(date, { screen: 0, apps: 0, launches: 0, unlocks: 0 });
  }
  for (const d of days) {
    const slot = byDate.get(d.date);
    if (slot) {
      slot.screen = d.screenMillis;
      slot.unlocks = d.unlocks ?? 0;
    }
  }
  for (const row of allApps) {
    const slot = byDate.get(row.date);
    if (!slot) continue;
    if (!home.has(row.packageName)) slot.apps += row.usageMillis;
    slot.launches += row.launchCount;
  }
  const dayPoints = datesBetween(range.from, range.to).map((date) => {
    const slot = byDate.get(date) ?? { screen: 0, apps: 0, launches: 0, unlocks: 0 };
    const time =
      scope === "all" ? slot.screen : scope === "apps" ? slot.apps : Math.max(0, slot.screen - slot.apps);
    const launches =
      scope === "apps" ? slot.launches : scope === "phone" ? slot.unlocks : slot.launches + slot.unlocks;
    return { key: date, label: weekdayLabel(date), time, launches };
  });
  const hourPoints = (hourly?.time ?? []).map((h, i) => ({
    key: `${h.hour}`,
    label: `${h.hour}`,
    time: h.value,
    launches: hourly?.launches[i]?.value ?? 0,
  }));
  /** Как называть заходы на графике: у «телефона» это разблокировки. */
  const chartWord = scope === "phone" ? "разблокировки" : "заходы";

  const earliest = earliestStoredDay(everDays, everApps);
  const incomplete = earliest !== null && earliest > range.from;
  const empty = now.all.time === 0 && appTotals.length === 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <PeriodBar selection={selection} onChange={setSelection} today={today} />

      <View style={styles.scopes}>
        {SCOPES.map((s) => (
          <Pressable
            key={s}
            onPress={() => setScope(s)}
            accessibilityRole="radio"
            accessibilityState={{ selected: scope === s }}
            accessibilityLabel={`Показать: ${SCOPE_LABELS[s]}`}
            style={({ pressed }) => [styles.scope, scope === s && styles.scopeOn, pressed && styles.pressed]}
          >
            <Text style={[styles.scopeText, scope === s && styles.scopeTextOn]}>{SCOPE_LABELS[s]}</Text>
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
          {/* Оба числа сразу: переключать группу, чтобы увидеть заходы, — это прятать
              половину ответа за лишним нажатием. */}
          <View style={styles.card}>
            {scope === "phone" ? (
              <>
                <Text style={styles.big}>{formatDuration(value.time)}</Text>
                <Text style={styles.bigUnit}>всего</Text>
              </>
            ) : (
              <UsageRing totals={rows} totalMs={value.time} />
            )}
            <Text style={styles.launches}>
              {`${value.launches} ${countWord(value.launches, scope)}`}
            </Text>
            {/* Заходы в приложения есть у всех дней, разблокировки — только у измеренных
                этой версией. Молчать об этом значит выдать неполную сумму за полную. */}
            {scope !== "apps" && blindDays > 0 && (
              <Text style={styles.perDay}>
                {blindDays === days.length
                  ? "Разблокировки за этот период не считались — их начали считать позже."
                  : `Разблокировки есть не за весь период: ${blindDays} ${plural(blindDays, [
                      "день",
                      "дня",
                      "дней",
                    ])} из ${days.length} измерены до того, как их начали считать.`}
              </Text>
            )}
            {change && <Text style={styles.change}>{describeChange(change)}</Text>}
            {spanDays > 1 && (
              <Text style={styles.perDay}>
                {`${formatCompact(Math.round(value.time / spanDays))} в день в среднем за ${spanDays} ${plural(
                  spanDays,
                  ["день", "дня", "дней"],
                )}`}
              </Text>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.chartHead}>
              <ChartToggle kind={chart} onChange={setChart} />
            </View>
            {/* У дня без почасовой картины рисуется он сам одним столбиком: пустое место
                на месте графика читается как «данных нет», хотя итог за день известен. */}
            {single && !hourly ? (
              <>
                <ValueChart points={dayPoints} kind={chart} countWord={chartWord} />
                <Text style={styles.hint}>
                  По часам этот день не сохранился: подробные события система хранит
                  несколько суток, и всё, что старше начала измерений, осталось только
                  итогом за сутки.
                </Text>
              </>
            ) : (
              <ValueChart points={single ? hourPoints : dayPoints} kind={chart} countWord={chartWord} />
            )}
          </View>

          {rows.length > 0 && (
            <>
              {/* Сортировка живёт над списком, а не над графиком: она про порядок строк,
                  и переключатель у той вещи, которой управляет. */}
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>
                  {scope === "all"
                    ? "Из чего сложилось"
                    : `Приложения · ${rows.length} ${plural(rows.length, ["штука", "штуки", "штук"])}`}
                </Text>
                <View style={styles.metrics}>
                  {SORTS.map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setSort(m)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: sort === m }}
                      accessibilityLabel={`Сортировать: ${METRIC_LABELS[m]}`}
                      style={({ pressed }) => [
                        styles.metric,
                        sort === m && styles.metricOn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.metricText, sort === m && styles.metricTextOn]}>
                        {METRIC_LABELS[m]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {rows.map((row, i) => {
                const isPhone = row.packageName === PHONE;
                const beforeRow = prevByPackage.get(row.packageName);
                const rowChange = isPhone
                  ? usageChange(
                      sort === "time" ? now.phone.time : now.phone.launches,
                      sort === "time" ? before.phone.time : before.phone.launches,
                      spanDays,
                    )
                  : usageChange(
                      sort === "time" ? row.usageMillis : row.launchCount,
                      beforeRow ? (sort === "time" ? beforeRow.usageMillis : beforeRow.launchCount) : 0,
                      spanDays,
                    );
                const share = rowsSum > 0 ? weigh(row) / rowsSum : 0;
                return (
                  <Pressable
                    key={row.packageName}
                    onPress={() =>
                      isPhone
                        ? setScope("phone")
                        : navigation.navigate("AppUsage", { packageName: row.packageName, title: row.label })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${row.label}, ${formatCompact(row.usageMillis)}, ${
                      row.launchCount
                    } ${countWord(row.launchCount, isPhone ? "phone" : "apps")}, ${Math.round(
                      share * 100,
                    )} процентов`}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <View
                      style={[
                        styles.rowFill,
                        { width: `${(topRow > 0 ? weigh(row) / topRow : 0) * 100}%`, backgroundColor: sliceColor(i) },
                      ]}
                    />
                    {isPhone ? (
                      <View style={[styles.dot, { backgroundColor: sliceColor(i) }]} />
                    ) : icons[row.packageName]?.icon ? (
                      <Image
                        source={{ uri: icons[row.packageName].icon as string }}
                        style={styles.icon}
                        accessibilityIgnoresInvertColors
                      />
                    ) : (
                      <View style={[styles.dot, { backgroundColor: sliceColor(i) }]} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {row.label}
                      </Text>
                      <Text style={styles.rowDetail} numberOfLines={1}>
                        {/* Рядом с долей стоит то число, которого нет справа: так в строке
                            всегда видно и время, и заходы, а не одно из двух дважды. */}
                        {`${Math.round(share * 100)} % · ${
                          sort === "launches"
                            ? formatCompact(row.usageMillis)
                            : `${row.launchCount} ${countWord(row.launchCount, isPhone ? "phone" : "apps")}`
                        }`}
                        {rowChange ? ` · ${rowChange.isDecrease ? "−" : "+"}${rowChange.percent} %` : ""}
                      </Text>
                    </View>
                    <Text style={styles.rowValue}>
                      {sort === "launches" ? `${row.launchCount}` : formatCompact(row.usageMillis)}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          )}

          {scope === "phone" && (
            <Text style={styles.footnote}>
              Сюда попадает всё, что было на включённом экране, но не в приложении: рабочий
              стол, шторка уведомлений, «недавние» и доли секунды на каждом переключении между
              приложениями. Вместо заходов здесь разблокировки — сколько раз телефон брали в
              руки и снимали блокировку. У дней, записанных раньше, их нет: пересчитать задним
              числом нечем, система хранит подробные события несколько суток.
            </Text>
          )}
        </>
      )}

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
  chartHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  // Три группы — крупная и заметная строка: с неё начинается всё, что показано ниже.
  scopes: { flexDirection: "row", gap: 6, marginBottom: 12 },
  scope: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  scopeOn: { backgroundColor: "rgba(143,184,154,0.14)" },
  scopeText: { color: colors.textMuted, fontSize: 13 },
  scopeTextOn: { color: colors.accentGreen, fontWeight: "600" },
  // Время или заходы — мельче: это про то, чем нарисован график, а не про то, что показано.
  metrics: { flexDirection: "row", gap: 2, backgroundColor: colors.bg, borderRadius: 16, padding: 2 },
  metric: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 },
  metricOn: { backgroundColor: colors.cardBorder },
  metricText: { color: colors.textMuted, fontSize: 11 },
  metricTextOn: { color: colors.text, fontWeight: "600" },
  launches: { color: colors.text, fontSize: 13, textAlign: "center", marginTop: 12 },
  toggle: { flexDirection: "row", gap: 2, backgroundColor: colors.bg, borderRadius: 16, padding: 2 },
  toggleBtn: { width: 30, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  toggleOn: { backgroundColor: colors.accentGreen },
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
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
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
