import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, levelInk, levelTint } from "../theme/colors";
import { plural } from "../lib/plural";
import { dayItems } from "../lib/habits";
import {
  DEFAULT_DAY_RULE,
  MAX_RULE_COUNT,
  MAX_RULE_PERCENT,
  MIN_RULE_COUNT,
  MIN_RULE_PERCENT,
  describeDayRule,
  requiredForDay,
  type DayRule,
} from "../lib/dayRule";
import { DEFAULT_LATE_RULE, type LateRule } from "../lib/habitSchedule";
import {
  DEFAULT_LEVEL_RULE,
  LEVELS,
  LEVEL_LABELS,
  MAX_QUOTA,
  capQuota,
  countLevels,
  describeQuota,
  type HabitLevel,
  type LevelQuota,
  type LevelRule,
} from "../lib/level";
import {
  DEFAULT_SKIP_RULE,
  MAX_SKIPS,
  describeSkipRule,
  type SkipBudget,
  type SkipPeriod,
  type SkipRule,
} from "../lib/skipRule";
import { dateNDaysAgo, shiftDate, todayKey } from "../lib/date";
import {
  DEFAULT_DAY_OFF,
  WEEKDAY_FULL,
  WEEKDAY_LABELS,
  dayOffReason,
  describeDayOff,
  toggleDate,
  toggleWeekday,
  type DayOffRule,
} from "../lib/dayOff";
import type { Habit } from "../types";

/**
 * The two settings that change what the numbers mean, behind one door.
 *
 * Everything else under the gear adjusts how the app behaves from now on. These two
 * re-judge the whole history the moment they move — lower the bar and days that were
 * failures become successes, widen the skips and a chain that broke stays broken but the
 * next one survives longer. That is a different kind of setting, and mixing it in with
 * reminder times invites moving it on the day it feels hardest, which is exactly the day it
 * means the most.
 *
 * Hence the door: one question before you come in. Not a lock — forgetting a code you set
 * for yourself and losing your own settings is a worse failure than a moment of weakness —
 * just a pause.
 */

/**
 * How much of the «ввожу сейчас» pile has to be closed for a day to count.
 *
 * The app's own answer is "all of it" — the pile is the bar, which is what makes keeping it
 * short the point rather than a suggestion — and that stays the default. It is still a rule
 * about your own days, so it is yours to move.
 *
 * The line under the chips is the whole reason this is not just three numbers: it says what
 * the setting comes to against the pile as it stands, and a percentage means nothing until
 * it is turned into "4 из 5".
 */
function DayRuleCard({
  rule,
  decidingCount,
  today,
  onChange,
  onPast,
}: {
  rule: DayRule;
  decidingCount: number;
  today: string;
  onChange: (rule: DayRule) => void;
  /** «Нынешнее правило действует с этого дня, а до него было вот такое». */
  onPast: (since: string, before: DayRule) => void;
}) {
  const [pastOpen, setPastOpen] = useState(false);
  const [since, setSince] = useState(() => shiftDate(today, -7));
  const [before, setBefore] = useState<DayRule>(DEFAULT_DAY_RULE);

  return (
    <View style={styles.limitCard}>
      <View>
        <Text style={styles.rowLabel}>Сколько закрыть за день</Text>
        <Text style={styles.rowHint}>{describeDayRule(rule, decidingCount)}</Text>
      </View>

      <DayRuleControls rule={rule} decidingCount={decidingCount} onChange={onChange} />

      {/* Правило помнит, когда его меняли: новое судит дни с сегодняшнего, а прошлые остаются
          под тем, что стояло в них. Иначе опущенная планка задним числом закрывала бы дни,
          которые по тогдашней были провалены, и серия росла бы на пустом месте. */}
      <Text style={styles.rowHint}>
        Новое правило действует с сегодняшнего дня. Прошлые дни остаются под тем правилом, которое стояло в них.
      </Text>

      {/* Для смены, сделанной раньше, чем приложение стало помнить смены: тогда оно не
          записало ни когда, ни с чего, и догадаться об этом ему нечем. */}
      <Pressable
        onPress={() => setPastOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: pastOpen }}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <Text style={styles.rowHint}>{`${pastOpen ? "▾" : "▸"} Правило меняли раньше? Исправить прошлое`}</Text>
      </Pressable>

      {pastOpen && (
        <>
          <Text style={styles.rowHint}>
            Скажи, с какого дня действует нынешнее правило и каким оно было до этого: дни до этой даты будут судиться
            по старому правилу, серия и календарь пересчитаются.
          </Text>

          <Text style={styles.cardLabel}>Нынешнее правило действует с</Text>
          <DateStepper value={since} today={today} onChange={setSince} />

          <Text style={styles.cardLabel}>До этого было</Text>
          <DayRuleControls rule={before} decidingCount={decidingCount} onChange={setBefore} />

          <Pressable
            onPress={() => {
              onPast(since, before);
              setPastOpen(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.chip, styles.chipOn, { alignSelf: "flex-start" }, pressed && styles.pressed]}
          >
            <Text style={[styles.chipText, styles.chipTextOn]}>Применить к прошлым дням</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

/**
 * Дата, с которой действует нынешнее правило: шаги по неделе и по дню.
 *
 * Не раньше года назад и не позже сегодня: дальше окна, по которому считаются серия и
 * календарь, смена всё равно ничего не изменит, а будущая судила бы и сегодняшний день.
 * Один и тот же для правила дня и для нормы по уровням.
 */
function DateStepper({ value, today, onChange }: { value: string; today: string; onChange: (v: string) => void }) {
  const earliest = shiftDate(today, -365);
  const move = (days: number) => {
    const next = shiftDate(value, days);
    onChange(next > today ? today : next < earliest ? earliest : next);
  };
  return (
    <View style={styles.dateStepper}>
      {([-7, -1] as const).map((d) => (
        <Pressable
          key={d}
          onPress={() => move(d)}
          accessibilityRole="button"
          accessibilityLabel={`Раньше на ${-d} ${plural(-d, ["день", "дня", "дней"])}`}
          style={({ pressed }) => [styles.stepBtnSmall, pressed && styles.pressed]}
        >
          <Text style={[styles.stepBtnText, { fontSize: 12 }]}>{`−${-d}`}</Text>
        </Pressable>
      ))}
      <Text style={[styles.limitValue, { fontSize: 15, minWidth: 90 }]}>{value.split("-").reverse().join(".")}</Text>
      {([1, 7] as const).map((d) => (
        <Pressable
          key={d}
          onPress={() => move(d)}
          accessibilityRole="button"
          accessibilityLabel={`Позже на ${d} ${plural(d, ["день", "дня", "дней"])}`}
          style={({ pressed }) => [styles.stepBtnSmall, pressed && styles.pressed]}
        >
          <Text style={[styles.stepBtnText, { fontSize: 12 }]}>{`+${d}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Выбор правила: «все», число или проценты — и сколько именно.
 *
 * Один и тот же для нынешнего правила и для того, что было раньше, поэтому вынесен из
 * карточки: два набора кнопок, написанных отдельно, разошлись бы при первой же правке.
 */
function DayRuleControls({
  rule,
  decidingCount,
  onChange,
}: {
  rule: DayRule;
  decidingCount: number;
  onChange: (rule: DayRule) => void;
}) {
  // Switching modes keeps what you were looking at rather than resetting to a default:
  // coming from "all" of five habits, the number to start editing is five, not one.
  const asCount = rule.kind === "count" ? rule.value : Math.max(MIN_RULE_COUNT, requiredForDay(rule, decidingCount) || 1);
  const asPercent =
    rule.kind === "percent"
      ? rule.value
      : decidingCount > 0
        ? Math.min(MAX_RULE_PERCENT, Math.max(MIN_RULE_PERCENT, Math.round((asCount / decidingCount) * 100)))
        : MAX_RULE_PERCENT;

  const modes: { kind: DayRule["kind"]; title: string }[] = [
    { kind: "all", title: "Все" },
    { kind: "count", title: "Число" },
    { kind: "percent", title: "Проценты" },
  ];

  const select = (kind: DayRule["kind"]) => {
    if (kind === "all") onChange({ kind: "all" });
    else if (kind === "count") onChange({ kind: "count", value: asCount });
    else onChange({ kind: "percent", value: asPercent });
  };

  const step = (delta: number) => {
    if (rule.kind === "count") {
      onChange({ kind: "count", value: Math.min(MAX_RULE_COUNT, Math.max(MIN_RULE_COUNT, rule.value + delta)) });
    } else if (rule.kind === "percent") {
      onChange({
        kind: "percent",
        value: Math.min(MAX_RULE_PERCENT, Math.max(MIN_RULE_PERCENT, rule.value + delta * 5)),
      });
    }
  };

  const value =
    rule.kind === "count"
      ? `${rule.value} ${plural(rule.value, ["привычка", "привычки", "привычек"])}`
      : rule.kind === "percent"
        ? `${rule.value}%`
        : "";

  return (
    <>
      <View style={styles.chipRow}>
        {modes.map((m) => (
          <Pressable
            key={m.kind}
            onPress={() => select(m.kind)}
            accessibilityRole="radio"
            accessibilityState={{ selected: rule.kind === m.kind }}
            style={({ pressed }) => [styles.chip, rule.kind === m.kind && styles.chipOn, pressed && styles.pressed]}
          >
            <Text style={[styles.chipText, rule.kind === m.kind && styles.chipTextOn]}>{m.title}</Text>
          </Pressable>
        ))}
      </View>

      {rule.kind !== "all" && (
        <View style={styles.stepper}>
          <Pressable
            onPress={() => step(-1)}
            accessibilityRole="button"
            accessibilityLabel="Меньше"
            style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <Text style={styles.limitValue}>{value}</Text>
          <Pressable
            onPress={() => step(1)}
            accessibilityRole="button"
            accessibilityLabel="Больше"
            style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

/**
 * Сколько привычек каждого уровня нужно закрыть — за день и за неделю.
 *
 * Стоит рядом с зачётом дня и работает вместе с ним: день закрыт, когда сошлись оба. «Пять
 * из пяти» и «одна из них сложная» — разные требования, и второе через первое не выразить.
 *
 * Зачёта вверх нет намеренно, и карточка об этом говорит: три сложные не закрывают норму по
 * лёгким. Норма по лёгким — это чаще всего быт, который проседает именно тогда, когда
 * взялся за тяжёлое, и подменять его тяжёлым значило бы отменить саму норму.
 *
 * Дневная норма входит в приговор дня, недельная — нет. По недельному числу нельзя сказать,
 * закрыт ли вторник, а на этом держится вся серия; поэтому недельная стоит отдельной целью.
 */
function LevelRuleCard({
  rule,
  available,
  today,
  onChange,
  onPast,
}: {
  rule: LevelRule;
  /** Сколько привычек каждого уровня вообще есть в «ввожу сейчас» — чтобы не просить больше. */
  available: LevelQuota;
  today: string;
  onChange: (rule: LevelRule) => void;
  /** «Нынешняя норма действует с этого дня, а до него была вот такая». */
  onPast: (since: string, before: LevelRule) => void;
}) {
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  const [pastOpen, setPastOpen] = useState(false);
  const [since, setSince] = useState(() => shiftDate(today, -7));
  const [beforeDaily, setBeforeDaily] = useState<LevelQuota>(rule.daily);
  const quota = rule[period];
  const capped = period === "daily" ? capQuota(quota, available) : quota;

  const step = (level: HabitLevel, delta: number) => {
    const next = Math.min(MAX_QUOTA, Math.max(0, quota[level] + delta));
    onChange({ ...rule, [period]: { ...quota, [level]: next } });
  };

  return (
    <View style={styles.limitCard}>
      <View>
        <Text style={styles.rowLabel}>Сколько каждого уровня</Text>
        <Text style={styles.rowHint}>
          {period === "daily"
            ? `Каждый день: ${describeQuota(capped)}`
            : `За неделю: ${describeQuota(quota)}`}
        </Text>
      </View>

      <View style={styles.chipRow}>
        {([
          ["daily", "В день"],
          ["weekly", "В неделю"],
        ] as const).map(([id, title]) => (
          <Pressable
            key={id}
            onPress={() => setPeriod(id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: period === id }}
            style={({ pressed }) => [styles.chip, period === id && styles.chipOn, pressed && styles.pressed]}
          >
            <Text style={[styles.chipText, period === id && styles.chipTextOn]}>{title}</Text>
          </Pressable>
        ))}
      </View>

      <LevelQuotaRows quota={quota} available={available} daily={period === "daily"} onStep={step} />

      <Text style={styles.rowHint}>
        {period === "daily"
          ? "Ноль — этот уровень ничего не требует. Норма урезается до того, что есть в списке: просить две сложные, когда сложная одна, значило бы завести день, который нельзя закрыть."
          : "Недельная норма день не рушит: по ней нельзя сказать, закрыт ли сегодняшний, а на этом держится серия. Это отдельная цель рядом."}
      </Text>
      <Text style={styles.rowHint}>
        Сложная за среднюю не идёт: каждый уровень закрывается своим.
      </Text>

      {/* Норма помнит, когда её меняли: новая судит дни с сегодняшнего, а прошлые остаются под
          той, что стояла в них. Иначе поставленная сегодня «сверхсложная в день» задним числом
          проваливала бы всю историю, и серия обнулялась бы. */}
      <Text style={styles.rowHint}>
        Новая норма действует с сегодняшнего дня. Прошлые дни остаются под той нормой, которая стояла в них.
      </Text>

      <Pressable
        onPress={() => setPastOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: pastOpen }}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <Text style={styles.rowHint}>{`${pastOpen ? "▾" : "▸"} Норму меняли раньше? Исправить прошлое`}</Text>
      </Pressable>

      {pastOpen && (
        <>
          <Text style={styles.rowHint}>
            Скажи, с какого дня действует нынешняя дневная норма и какой она была до этого: дни до этой даты будут
            судиться по старой, серия и календарь пересчитаются. Недельная норма прошлое не судит.
          </Text>

          <Text style={styles.cardLabel}>Нынешняя норма действует с</Text>
          <DateStepper value={since} today={today} onChange={setSince} />

          <Text style={styles.cardLabel}>До этого было (в день)</Text>
          <LevelQuotaRows
            quota={beforeDaily}
            available={available}
            daily
            onStep={(level, delta) =>
              setBeforeDaily((q) => ({ ...q, [level]: Math.min(MAX_QUOTA, Math.max(0, q[level] + delta)) }))
            }
          />

          <Pressable
            onPress={() => {
              onPast(since, { ...rule, daily: beforeDaily });
              setPastOpen(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.chip, styles.chipOn, { alignSelf: "flex-start" }, pressed && styles.pressed]}
          >
            <Text style={[styles.chipText, styles.chipTextOn]}>Применить к прошлым дням</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

/**
 * Строки «уровень — сколько нужно»: по одной на уровень, со счётчиком.
 *
 * Одни и те же для нынешней нормы и для той, что была раньше, поэтому вынесены из карточки.
 */
function LevelQuotaRows({
  quota,
  available,
  daily,
  onStep,
}: {
  quota: LevelQuota;
  available: LevelQuota;
  daily: boolean;
  onStep: (level: HabitLevel, delta: number) => void;
}) {
  return (
    <>
      {LEVELS.map((level) => (
        <View key={level} style={styles.levelRow}>
          <View style={[styles.levelTag, { backgroundColor: levelTint[level] }]}>
            <Text style={[styles.levelTagText, { color: levelInk[level] }]}>{LEVEL_LABELS[level]}</Text>
          </View>
          <Text style={styles.levelHave}>
            {daily ? `в списке ${available[level]}` : `${available[level]} в списке`}
          </Text>
          <View style={styles.levelStepper}>
            <Pressable
              onPress={() => onStep(level, -1)}
              accessibilityRole="button"
              accessibilityLabel={`Меньше: ${LEVEL_LABELS[level]}`}
              style={({ pressed }) => [styles.stepBtnSmall, pressed && styles.pressed]}
            >
              <Text style={styles.stepBtnText}>−</Text>
            </Pressable>
            <Text style={styles.levelValue}>{quota[level]}</Text>
            <Pressable
              onPress={() => onStep(level, 1)}
              accessibilityRole="button"
              accessibilityLabel={`Больше: ${LEVEL_LABELS[level]}`}
              style={({ pressed }) => [styles.stepBtnSmall, pressed && styles.pressed]}
            >
              <Text style={styles.stepBtnText}>+</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </>
  );
}

/**
 * How many skipped days a chain forgives, over what, and what they protect.
 *
 * There has always been exactly one: a single day a week the streak lets go. The number,
 * the period it refills over and whether the budget belongs to the day or to each habit are
 * all settings now. Zero turns the whole thing off, which is a real answer.
 *
 * Two rules are not settable and the card says so. A chance is only ever spent on
 * *yesterday*, at the moment yesterday closed — nothing rescues a day retroactively, so the
 * number cannot move under someone who has already read it. And two skipped days in a row
 * always break, whatever budget is left: a second day off is not a slip, and a chain that
 * survives an open-ended gap has stopped measuring anything.
 */
function BudgetRow({
  title,
  hint,
  budget,
  onChange,
}: {
  title: string;
  hint: string;
  budget: SkipBudget;
  onChange: (b: SkipBudget) => void;
}) {
  const periods: { kind: SkipPeriod; title: string }[] = [
    { kind: "week", title: "В неделю" },
    { kind: "month", title: "В месяц" },
    { kind: "streak", title: "На цепочку" },
  ];
  const step = (delta: number) =>
    onChange({ ...budget, count: Math.min(MAX_SKIPS, Math.max(0, budget.count + delta)) });

  return (
    <>
      <Text style={styles.cardLabel}>{title}</Text>
      <Text style={styles.rowHint}>{hint}</Text>

      <View style={styles.stepper}>
        <Pressable
          onPress={() => step(-1)}
          accessibilityRole="button"
          accessibilityLabel={`Меньше: ${title}`}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.limitValue}>
          {budget.count === 0
            ? "выкл"
            : `${budget.count} ${plural(budget.count, ["шанс", "шанса", "шансов"])}`}
        </Text>
        <Pressable
          onPress={() => step(1)}
          accessibilityRole="button"
          accessibilityLabel={`Больше: ${title}`}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>

      {/* Период прячется у выключенного запаса: настраивать, как пополняется ноль,
          нечего, и две мёртвые строки на экране только сбивают. */}
      {budget.count > 0 && (
        <>
          <View style={styles.chipRow}>
            {periods.map((p) => (
              <Pressable
                key={p.kind}
                onPress={() => onChange({ ...budget, period: p.kind })}
                accessibilityRole="radio"
                accessibilityState={{ selected: budget.period === p.kind }}
                accessibilityLabel={`${title}: ${p.title}`}
                style={({ pressed }) => [
                  styles.chip,
                  budget.period === p.kind && styles.chipOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, budget.period === p.kind && styles.chipTextOn]}>
                  {p.title}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.rowHint}>
            {budget.period === "week"
              ? "Обнуляется каждый понедельник. Непотраченные не копятся."
              : budget.period === "month"
                ? "Обнуляется 1-го числа. Можно истратить всё за одну плохую неделю."
                : "Не пополняется, пока цепочка идёт. Снова выдаются, когда она оборвалась и началась заново."}
          </Text>
        </>
      )}
    </>
  );
}

/**
 * Два запаса шансов, и они работают одновременно.
 *
 * Раньше это был выбор «или-или», и в нём была дыра: поставив шансы на привычки, человек
 * оставлял общий день без защиты вовсе. День, в который не сделано ничего, рвал общую серию,
 * хотя шансы каждой привычки были не тронуты. Два разных вопроса — «уцелел ли день» и
 * «уцелела ли привычка» — решались одним переключателем, и один ответ всегда терялся.
 */
function SkipRuleCard({ rule, onChange }: { rule: SkipRule; onChange: (rule: SkipRule) => void }) {
  return (
    <View style={styles.limitCard}>
      <View>
        <Text style={styles.rowLabel}>Шансы на пропуск</Text>
        <Text style={styles.rowHint}>{describeSkipRule(rule)}</Text>
      </View>

      <BudgetRow
        title="Общий — держит день"
        hint="Не сделал ничего за день — общая серия уцелела. Прощается день целиком, вместе со всеми привычками в нём."
        budget={rule.shared}
        onChange={(shared) => onChange({ ...rule, shared })}
      />

      <BudgetRow
        title="На каждую привычку — держит её"
        hint="У каждой привычки свой запас на её собственную серию. Пропустил одну, но день закрыл остальными — её серия уцелела."
        budget={rule.perHabit}
        onChange={(perHabit) => onChange({ ...rule, perHabit })}
      />

      <Text style={styles.rowHint}>
        Два пропуска подряд рвут цепочку в любом случае — сколько бы шансов ни оставалось.
        Шанс тратится только на вчерашний день и только в тот момент, когда он закрылся:
        задним числом ничего не спасается.
      </Text>
    </View>
  );
}

/**
 * Выходные — день, который не рвёт серию и не тратит шанс.
 *
 * Третья вещь после «сделал» и «пропустил». Пропуск — промах, за него платят шансом. Выходной
 * объявлен заранее, платить за него нечем, и подряд их может быть сколько угодно: отпуск не
 * обязан укладываться в один день.
 *
 * В серию он не идёт — она перешагивает его и считает дальше. Иначе постоянный выходной по
 * воскресеньям растил бы число сам по себе, ничего не измеряя.
 */
function DaysOffCard({
  rule,
  today,
  onChange,
}: {
  rule: DayOffRule;
  today: string;
  onChange: (rule: DayOffRule) => void;
}) {
  const yesterday = dateNDaysAgo(1);
  const markable: { date: string; title: string }[] = [
    { date: yesterday, title: "Вчера" },
    { date: today, title: "Сегодня" },
    { date: dateNDaysAgo(-1), title: "Завтра" },
  ];

  return (
    <View style={styles.limitCard}>
      <View>
        <Text style={styles.rowLabel}>Выходные</Text>
        <Text style={styles.rowHint}>{describeDayOff(rule)}</Text>
      </View>

      <Text style={styles.cardLabel}>Каждую неделю</Text>
      <View style={styles.chipRow}>
        {WEEKDAY_LABELS.map((label, i) => {
          const day = i + 1;
          const on = rule.weekdays.includes(day);
          return (
            <Pressable
              key={label}
              onPress={() => onChange(toggleWeekday(rule, day))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Постоянный выходной: ${WEEKDAY_FULL[i]}`}
              style={({ pressed }) => [styles.dayChip, on && styles.chipOn, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.rowHint}>
        Постоянный выходной действует всегда, без отметок. Серия его перешагивает: в счёт он
        не идёт, но и не рвёт.
      </Text>

      <Text style={styles.cardLabel}>Отдельный день</Text>
      <View style={styles.chipRow}>
        {markable.map((m) => {
          const reason = dayOffReason(m.date, rule);
          // Постоянный выходной этой кнопкой не снять — она ставит и снимает только
          // разовые. Показать «убрать» там, где нажатие ничего не уберёт, значит соврать.
          const locked = reason === "weekday";
          return (
            <Pressable
              key={m.date}
              onPress={() => !locked && onChange(toggleDate(rule, m.date))}
              disabled={locked}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: reason !== null, disabled: locked }}
              accessibilityLabel={`Выходной: ${m.title.toLowerCase()}`}
              style={({ pressed }) => [
                styles.chip,
                reason !== null && styles.chipOn,
                locked && styles.dimmed,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipText, reason !== null && styles.chipTextOn]}>{m.title}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.rowHint}>
        Дальше вчерашнего дня назад нельзя. Выходной планируют, а не подбирают задним числом
        под уже случившийся провал: иначе серию можно переписать в любой момент, и она
        перестаёт что-либо значить. Вчера оставлено потому, что отметить вечером забывают.
      </Text>
    </View>
  );
}


/**
 * What a missed window costs, for the habits that have not answered for themselves.
 *
 * The answer is not the same for every habit — an hour without the phone in the morning is a
 * promise worth losing the day over, and a glass of water at the same hour is not — so each
 * one can override this in its own editor. What lives here is the default the rest follow.
 *
 * "Ничего" is that default, and it is the honest one: a time you set to be reminded is not
 * the same promise as a time you set to be judged by, and most of them are the first kind.
 */
function LateRuleCard({ rule, onChange }: { rule: LateRule; onChange: (rule: LateRule) => void }) {
  const options: { kind: LateRule; title: string; blurb: string }[] = [
    {
      kind: "none",
      title: "Ничего",
      blurb: "Время — напоминание. Отметить можно и позже, день засчитается как обычно.",
    },
    {
      kind: "fail",
      title: "День провален",
      blurb:
        "Окно закрылось — отметить уже нельзя, и привычка идёт в этот день как невыполненная. Отказ, а не тихое игнорирование: настройка, которая принимает отметку и потом её не считает, ничего не делает.",
    },
  ];
  const current = options.find((o) => o.kind === rule) ?? options[0];

  return (
    <View style={styles.limitCard}>
      <View>
        <Text style={styles.rowLabel}>Если не выполнить в назначенное время</Text>
        <Text style={styles.rowHint}>{current.title}</Text>
      </View>

      <View style={styles.chipRow}>
        {options.map((o) => (
          <Pressable
            key={o.kind}
            onPress={() => onChange(o.kind)}
            accessibilityRole="radio"
            accessibilityState={{ selected: rule === o.kind }}
            style={({ pressed }) => [styles.chip, rule === o.kind && styles.chipOn, pressed && styles.pressed]}
          >
            <Text style={[styles.chipText, rule === o.kind && styles.chipTextOn]}>{o.title}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.rowHint}>{current.blurb}</Text>
      <Text style={styles.rowHint}>
        Это значение по умолчанию. У каждой привычки со временем можно выбрать своё — в её
        редакторе, рядом с часами. Привычек без заданного времени не касается вообще: их
        по-прежнему можно отметить когда угодно.
      </Text>
    </View>
  );
}

export default function AdminScreen() {
  const qc = useQueryClient();

  // The pile the day rule is about, so the card can say what it comes to.
  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ["habits"],
    queryFn: () => api.getHabits() as Promise<Habit[]>,
  });
  // Те же пункты, что в шапке чек-листа и в зачёте дня (dayItems): иначе «50 %» здесь и
  // «нужно N» на экране чек-листа считались бы от разных чисел.
  const decidingCount = dayItems(habits).length;

  const { data: dayRule = DEFAULT_DAY_RULE } = useQuery<DayRule>({
    queryKey: ["dayRule"],
    queryFn: () => api.getDayRule(),
  });
  const { data: daysOff = DEFAULT_DAY_OFF } = useQuery<DayOffRule>({
    queryKey: ["daysOff"],
    queryFn: () => api.getDaysOff(),
  });
  const { data: skipRule = DEFAULT_SKIP_RULE } = useQuery<SkipRule>({
    queryKey: ["skipRule"],
    queryFn: () => api.getSkipRule(),
  });
  const { data: levelRule = DEFAULT_LEVEL_RULE } = useQuery<LevelRule>({
    queryKey: ["levelRule"],
    queryFn: () => api.getLevelRule(),
  });
  const { data: lateRule = DEFAULT_LATE_RULE } = useQuery<LateRule>({
    queryKey: ["lateRule"],
    queryFn: () => api.getLateRule(),
  });

  // Both invalidate the same set: every verdict in the app is derived from these two.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["habitLog"] });
    qc.invalidateQueries({ queryKey: ["freezes"] });
    qc.invalidateQueries({ queryKey: ["habitFreezes"] });
  };

  const setDayRule = useMutation({
    mutationFn: (rule: DayRule) => api.setDayRule(rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dayRule"] });
      invalidate();
    },
  });
  const setPastDayRule = useMutation({
    mutationFn: (v: { since: string; rule: DayRule }) => api.setPastDayRule(v.since, v.rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dayRule"] });
      invalidate();
    },
  });
  const setDaysOff = useMutation({
    mutationFn: (rule: DayOffRule) => api.setDaysOff(rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daysOff"] });
      // Серия считается по выходным — её надо пересчитать сразу, а не при следующем заходе.
      qc.invalidateQueries({ queryKey: ["freezes"] });
    },
  });

  const setLevelRule = useMutation({
    mutationFn: (rule: LevelRule) => api.setLevelRule(rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levelRule"] });
      invalidate();
    },
  });
  const setPastLevelRule = useMutation({
    mutationFn: (v: { since: string; rule: LevelRule }) => api.setPastLevelRule(v.since, v.rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levelRule"] });
      invalidate();
    },
  });
  const setSkipRule = useMutation({
    mutationFn: (rule: SkipRule) => api.setSkipRule(rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skipRule"] });
      invalidate();
    },
  });
  const setLateRule = useMutation({
    mutationFn: (rule: LateRule) => api.setLateRule(rule),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lateRule"] });
      invalidate();
    },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.intro}>
        Здесь меняются правила, по которым считаются дни и серии. «Зачёт дня» и «Уровни»
        действуют с того дня, когда их сменили, а прошлые дни остаются под прежним. Остальные
        правила пересчитывают и прошлое: числа в отчёте сдвинутся сразу, а не с завтрашнего дня.
      </Text>

      <Text style={styles.sectionLabel}>Зачёт дня</Text>
      <DayRuleCard
        rule={dayRule}
        decidingCount={decidingCount}
        today={todayKey()}
        onChange={(r) => setDayRule.mutate(r)}
        onPast={(since, rule) => setPastDayRule.mutate({ since, rule })}
      />

      <Text style={[styles.sectionLabel, styles.spaced]}>Уровни</Text>
      <LevelRuleCard
        rule={levelRule}
        available={countLevels(dayItems(habits))}
        today={todayKey()}
        onChange={(r) => setLevelRule.mutate(r)}
        onPast={(since, r) => setPastLevelRule.mutate({ since, rule: r })}
      />

      <Text style={[styles.sectionLabel, styles.spaced]}>Пропуски</Text>
      <SkipRuleCard rule={skipRule} onChange={(r) => setSkipRule.mutate(r)} />

      <DaysOffCard rule={daysOff} today={todayKey()} onChange={(r) => setDaysOff.mutate(r)} />

      <Text style={[styles.sectionLabel, styles.spaced]}>Время выполнения</Text>
      <LateRuleCard rule={lateRule} onChange={(r) => setLateRule.mutate(r)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 18 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 18 },
  pressed: { opacity: 0.75 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "500" },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  cardLabel: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  limitCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    gap: 10,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  levelTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  levelTagText: { fontSize: 11, fontWeight: "600" },
  levelHave: { color: colors.textMuted, fontSize: 10, flex: 1 },
  levelStepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  levelValue: { color: colors.text, fontSize: 15, fontWeight: "700", minWidth: 18, textAlign: "center" },
  stepBtnSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  dateStepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: colors.text, fontSize: 20, fontWeight: "600" },
  dayChip: {
    minWidth: 40,
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  dimmed: { opacity: 0.45 },
  limitValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 110,
    textAlign: "center",
  },
});
