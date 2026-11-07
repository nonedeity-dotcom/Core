import { useRef } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppInfoEntry } from "../../api/client";
import type { HourDetail } from "../../integrations/usageSync";
import { colors } from "../../theme/colors";
import { formatDateShort } from "../../lib/date";
import { plural } from "../../lib/plural";
import { formatWithUnits } from "../../lib/screen/duration";
import { sliceColor } from "./UsageRing";

/** Условный пакет строки «Телефон» — своего у неё нет, она собрана из остатка. */
const PHONE = "__phone__";

/** Меньше секунды в строку не выводится: это не «пользовался», а мелькнуло. */
const MIN_ROW_MS = 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** «14:00 – 15:00». Последний час суток кончается в 00:00, а не в 24:00. */
const hourRange = (hour: number) => `${pad(hour)}:00 – ${pad((hour + 1) % 24)}:00`;

/**
 * Время для строки: в пределах часа секунды важны, а ровный ноль в конце — нет.
 * Так же сделана подпись под графиком: «57м», а не «57м 0с».
 */
function exact(ms: number): string {
  const full = formatWithUnits(ms);
  return full.endsWith(" 0с") ? full.slice(0, -3) : full;
}

interface Row {
  key: string;
  label: string;
  icon: string | null;
  millis: number;
}

/**
 * Один час на весь экран: сколько экран был включён и в каких приложениях.
 *
 * Открывается по нажатию на час в графике «Экрана». Показывает всегда целиком, а не только
 * ту часть, что выбрана переключателем над графиком: «общий», «приложения» и «телефон» — это
 * способы нарисовать график, а здесь вопрос другой — куда ушёл этот час. Поэтому строки
 * складываются в время экрана так же, как в списке дня: приложения и «Телефон» — остаток.
 *
 * Стрелки листают соседние часы, не закрывая окно: сравнить «а в соседний час что было» —
 * самое частое, что хочется сделать дальше.
 */
export default function HourSheet({
  hour,
  date,
  detail,
  icons,
  home,
  onChangeHour,
  onClose,
}: {
  /** Какой час показан. `null` — окно закрыто. */
  hour: number | null;
  date: string;
  /** `undefined` — ещё считается, `null` — про этот час ничего не известно. */
  detail: HourDetail | null | undefined;
  icons: Record<string, AppInfoEntry>;
  /** Пакеты домашнего экрана: приложением они не считаются. */
  home: Set<string>;
  onChangeHour: (hour: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  // Пока окно уезжает вниз, родитель уже обнулил час и ответ. Без запоминания последнего
  // показанного шапка на этот момент превращалась бы в «00:00 – 01:00» и «считаю».
  const last = useRef<{ hour: number; detail: HourDetail | null | undefined }>({ hour: 0, detail: undefined });
  if (hour !== null) last.current = { hour, detail };
  const shown = last.current;

  const info = shown.detail;
  const apps = info?.apps ?? [];
  const phoneMs = info ? Math.max(0, info.screenMs - info.appsMs) : 0;
  const rows: Row[] = [
    ...apps
      .filter((a) => !home.has(a.packageName))
      .map((a) => ({
        key: a.packageName,
        label: icons[a.packageName]?.label ?? a.packageName,
        icon: icons[a.packageName]?.icon ?? null,
        millis: a.millis,
      })),
    ...(phoneMs >= MIN_ROW_MS ? [{ key: PHONE, label: "Телефон", icon: null, millis: phoneMs }] : []),
  ].sort((a, b) => b.millis - a.millis);
  const rowsSum = rows.reduce((sum, r) => sum + r.millis, 0);
  const top = rows.reduce((max, r) => Math.max(max, r.millis), 0);

  const quiet = info !== null && info !== undefined && info.screenMs === 0 && info.appLaunches === 0 && info.unlocks === 0;

  return (
    <Modal
      visible={hour !== null}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
        <View style={styles.top}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <Feather name="x" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.date}>{formatDateShort(date)}</Text>
          <View style={styles.iconBtn} />
        </View>

        <View style={styles.nav}>
          <Pressable
            onPress={() => onChangeHour(shown.hour - 1)}
            disabled={shown.hour <= 0}
            accessibilityRole="button"
            accessibilityLabel="Предыдущий час"
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, shown.hour <= 0 && styles.off, pressed && styles.pressed]}
          >
            <Feather name="chevron-left" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.range}>{hourRange(shown.hour)}</Text>
          <Pressable
            onPress={() => onChangeHour(shown.hour + 1)}
            disabled={shown.hour >= 23}
            accessibilityRole="button"
            accessibilityLabel="Следующий час"
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, shown.hour >= 23 && styles.off, pressed && styles.pressed]}
          >
            <Feather name="chevron-right" size={24} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {info === undefined ? (
            <Text style={styles.hint}>Считаю…</Text>
          ) : info === null ? (
            <View style={styles.card}>
              <Text style={styles.hint}>
                За этот день по часам ничего не сохранилось: подробные события система хранит
                несколько суток, и всё, что старше начала измерений, осталось только итогом за
                сутки.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.big}>{info.screenMs > 0 ? exact(info.screenMs) : "—"}</Text>
                <Text style={styles.bigUnit}>экран был включён</Text>
                <Text style={styles.counts}>
                  {`${info.appLaunches} ${plural(info.appLaunches, ["заход", "захода", "заходов"])} в приложения · ${
                    info.unlocks
                  } ${plural(info.unlocks, ["разблокировка", "разблокировки", "разблокировок"])}`}
                </Text>
              </View>

              {quiet ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>В этот час телефон не использовали.</Text>
                </View>
              ) : info.apps === null ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>
                    По приложениям этот час не сохранился: разбивка считается из подробных
                    событий, которые система держит несколько суток, и записывается только
                    с тех пор, как у «Экрана» появилось окно часа. Общие числа выше взяты из
                    итога за день и остаются верными.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>Из чего сложился час</Text>
                  {rows.map((row, i) => {
                    const share = rowsSum > 0 ? row.millis / rowsSum : 0;
                    return (
                      <View
                        key={row.key}
                        accessible
                        accessibilityLabel={`${row.label}, ${exact(row.millis)}, ${Math.round(share * 100)} процентов`}
                        style={styles.row}
                      >
                        <View
                          style={[
                            styles.rowFill,
                            { width: `${(top > 0 ? row.millis / top : 0) * 100}%`, backgroundColor: sliceColor(i) },
                          ]}
                        />
                        {row.icon ? (
                          <Image source={{ uri: row.icon }} style={styles.icon} accessibilityIgnoresInvertColors />
                        ) : (
                          <View style={[styles.dot, { backgroundColor: sliceColor(i) }]} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowName} numberOfLines={1}>
                            {row.label}
                          </Text>
                          <Text style={styles.rowDetail} numberOfLines={1}>
                            {`${Math.round(share * 100)} % часа`}
                          </Text>
                        </View>
                        <Text style={styles.rowValue}>{exact(row.millis)}</Text>
                      </View>
                    );
                  })}
                  {rows.length === 0 && <Text style={styles.hint}>Приложений в этот час не было.</Text>}
                  {rows.some((r) => r.key === PHONE) && (
                    <Text style={styles.footnote}>
                      «Телефон» — всё, что было на включённом экране, но не в приложении: рабочий
                      стол, шторка уведомлений, «недавние» и доли секунды на переключениях.
                    </Text>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  date: { color: colors.textMuted, fontSize: 13 },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  range: { color: colors.text, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  off: { opacity: 0.25 },
  pressed: { opacity: 0.75 },
  content: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  big: {
    color: colors.accentGreen,
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: -1,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  bigUnit: { color: colors.textMuted, fontSize: 12, textAlign: "center" },
  counts: { color: colors.text, fontSize: 13, textAlign: "center", marginTop: 12 },
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
  rowName: { color: colors.text, fontSize: 14 },
  rowDetail: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
});
