import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, AppState, type LayoutChangeEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { GROUND_COLOR, NatureSprite, PlayerSprite, StructureSprite, WaterSprite } from "../../components/village/Sprites";
import { ITEMS, RECIPES, type ItemId } from "../../lib/village/content";
import {
  act,
  actionLabel,
  canCraft,
  cellAt,
  clockOf,
  craft,
  currentGoal,
  darkness,
  dayOf,
  eat,
  facingCell,
  isNight,
  move,
  newVillage,
  pickUp,
  place,
  type Dir,
  type Outcome,
  type VillageState,
} from "../../lib/village/game";

/** Сколько клеток видно по ширине. Нечётное — чтобы персонаж стоял ровно посередине. */
const COLS = 9;
/** Как часто делается шаг, пока кнопка зажата. */
const REPEAT_MS = 170;

/**
 * «Опушка» — спокойная игра про лес и деревню.
 *
 * Время идёт только от действий: пока ничего не нажимаешь, в мире ничего не происходит.
 * Сохраняется само, через секунду после последнего действия и при уходе с экрана.
 */
export default function VillageScreen({
  navigation,
}: {
  navigation: { goBack: () => void; setOptions: (options: { headerShown: boolean }) => void };
}) {
  const [state, setStateRaw] = useState<VillageState | null>(null);
  const stateRef = useRef<VillageState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bagOpen, setBagOpen] = useState(false);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
    return () => navigation.setOptions({ headerShown: true });
  }, [navigation]);

  // --- загрузка и сохранение ------------------------------------------------------

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (stateRef.current) void api.saveVillage(stateRef.current);
  }, []);

  useEffect(() => {
    void api.getVillage().then((saved) => {
      const s = saved ?? newVillage(Math.floor(Math.random() * 2 ** 31));
      stateRef.current = s;
      setStateRaw(s);
      if (!saved) {
        void api.saveVillage(s);
        setMessage("Утро на опушке. Ветки и камешки лежат рядом — с них и начнём");
      }
    });
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") saveNow();
    });
    return () => {
      sub.remove();
      saveNow();
    };
  }, [saveNow]);

  const apply = useCallback(
    (outcome: Outcome) => {
      stateRef.current = outcome.state;
      setStateRaw(outcome.state);
      if (outcome.message !== null) setMessage(outcome.message);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(saveNow, 1000);
    },
    [saveNow],
  );

  const run = useCallback(
    (fn: (s: VillageState) => Outcome) => {
      if (stateRef.current) apply(fn(stateRef.current));
    },
    [apply],
  );

  // --- ходьба с удержанием ---------------------------------------------------------

  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Сделан ли шаг за это нажатие — чтобы короткий тап не пропал и не сработал дважды. */
  const stepped = useRef(false);
  const stopWalk = () => {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
  };
  const startWalk = (dir: Dir) => {
    stopWalk();
    stepped.current = true;
    run((s) => move(s, dir));
    repeat.current = setInterval(() => run((s) => move(s, dir)), REPEAT_MS);
  };
  /**
   * Нажатие закончилось. Очень короткий тап иногда приходит без «нажал» — только «нажато»,
   * и тогда шаг делается здесь. Без этого быстрые тапы по стрелке терялись.
   */
  const tapWalk = (dir: Dir) => {
    stopWalk();
    if (!stepped.current) run((s) => move(s, dir));
    stepped.current = false;
  };
  useEffect(() => stopWalk, []);

  // --- размеры ---------------------------------------------------------------------

  const [area, setArea] = useState({ w: 0, h: 0 });
  const onArea = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== area.w || height !== area.h) setArea({ w: width, h: height });
  };
  const tile = area.w > 0 ? Math.floor(area.w / COLS) : 0;
  // Рядов столько, сколько влезает, но тоже нечётное число.
  const rowsFit = tile > 0 ? Math.floor(area.h / tile) : 0;
  const ROWS = rowsFit % 2 === 1 ? rowsFit : rowsFit - 1;

  if (!state) return <View style={styles.container} />;

  const label = actionLabel(state);
  const front = facingCell(state);
  const frontCell = cellAt(state, front.x, front.y);
  const goal = currentGoal(state);
  const dark = darkness(state.time);
  const night = isNight(state.time);
  const bagItems = (Object.entries(state.bag) as [ItemId, number][]).filter(([, n]) => n > 0);

  const cells: JSX.Element[] = [];
  if (tile > 0 && ROWS > 0) {
    const halfX = (COLS - 1) / 2;
    const halfY = (ROWS - 1) / 2;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = state.x - halfX + c;
        const y = state.y - halfY + r;
        const cell = cellAt(state, x, y);
        const pos = { left: c * tile, top: r * tile, width: tile, height: tile };
        if (!cell) {
          cells.push(<View key={`${r}:${c}`} style={[styles.cell, pos, { backgroundColor: "#1d2e22" }]} />);
          continue;
        }
        cells.push(
          <View key={`${r}:${c}`} style={[styles.cell, pos, { backgroundColor: GROUND_COLOR[cell.ground] }]}>
            {cell.ground === "water" && <WaterSprite />}
            {cell.nature && <NatureSprite id={cell.nature} depleted={cell.depleted} />}
            {cell.built && <StructureSprite id={cell.built} lit={night} />}
          </View>,
        );
      }
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Назад" hitSlop={12}>
          <Feather name="arrow-left" size={20} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.day}>{`День ${dayOf(state.time)} · ${clockOf(state.time)}`}</Text>
        <View style={styles.food} accessibilityLabel={`Сытость ${Math.round(state.food)} из 100`}>
          <Text style={styles.foodLabel}>Сытость</Text>
          <View style={styles.foodTrack}>
            <View
              style={[
                styles.foodFill,
                { width: `${Math.round(state.food)}%` },
                state.food < 20 && { backgroundColor: colors.accent },
              ]}
            />
          </View>
        </View>
      </View>
      {goal && (
        <Text style={styles.goal} numberOfLines={1}>
          {`Задача: ${goal.title} — ${goal.hint}`}
        </Text>
      )}

      <View style={styles.mapArea} onLayout={onArea}>
        {tile > 0 && ROWS > 0 && (
          <View style={{ width: tile * COLS, height: tile * ROWS }}>
            {cells}
            <View
              style={[
                styles.cell,
                { left: ((COLS - 1) / 2) * tile, top: ((ROWS - 1) / 2) * tile, width: tile, height: tile },
              ]}
            >
              <PlayerSprite facing={state.facing} color={colors.accent} />
            </View>
            {/* Клетка, к которой повернулся: к ней относится кнопка действия. */}
            <View
              pointerEvents="none"
              style={[
                styles.cell,
                styles.target,
                {
                  left: ((COLS - 1) / 2 + (front.x - state.x)) * tile,
                  top: ((ROWS - 1) / 2 + (front.y - state.y)) * tile,
                  width: tile,
                  height: tile,
                },
              ]}
            />
            {dark > 0 && (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(6,10,28,${0.55 * dark})` }]} />
            )}
          </View>
        )}
      </View>

      <Text style={styles.message} numberOfLines={2}>
        {message ?? " "}
      </Text>

      <View style={styles.controls}>
        <View style={styles.pad}>
          <PadButton dir="up" onStart={startWalk} onStop={stopWalk} onTap={tapWalk} style={styles.padUp} />
          <View style={styles.padRow}>
            <PadButton dir="left" onStart={startWalk} onStop={stopWalk} onTap={tapWalk} />
            <View style={styles.padGap} />
            <PadButton dir="right" onStart={startWalk} onStop={stopWalk} onTap={tapWalk} />
          </View>
          <PadButton dir="down" onStart={startWalk} onStop={stopWalk} onTap={tapWalk} style={styles.padDown} />
        </View>

        <View style={styles.side}>
          <Pressable
            onPress={() => run(act)}
            disabled={!label}
            accessibilityRole="button"
            accessibilityLabel={label ?? "Действие"}
            style={({ pressed }) => [styles.action, !label && styles.actionOff, pressed && styles.dimmed]}
          >
            <Text style={[styles.actionText, !label && styles.muted]} numberOfLines={2}>
              {label ?? "Подойди к чему-нибудь"}
            </Text>
          </Pressable>
          <View style={styles.sideRow}>
            <Pressable
              onPress={() => setBagOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Сумка"
              style={({ pressed }) => [styles.small, pressed && styles.dimmed]}
            >
              <Feather name="briefcase" size={16} color={colors.text} />
              <Text style={styles.smallText}>Сумка</Text>
            </Pressable>
            {frontCell?.built && (
              <Pressable
                onPress={() => run(pickUp)}
                accessibilityRole="button"
                accessibilityLabel="Разобрать"
                style={({ pressed }) => [styles.small, pressed && styles.dimmed]}
              >
                <Feather name="rotate-ccw" size={16} color={colors.text} />
                <Text style={styles.smallText}>Разобрать</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {bagOpen && (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Сумка</Text>
            <Pressable onPress={() => setBagOpen(false)} accessibilityRole="button" accessibilityLabel="Закрыть сумку" hitSlop={12}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
            <Text style={styles.sheetLabel}>Вещи</Text>
            {bagItems.length === 0 ? (
              <Text style={styles.note}>Пусто. Подбери ветки и камешки — они лежат на поляне.</Text>
            ) : (
              bagItems.map(([id, n]) => {
                const def = ITEMS[id];
                return (
                  <View key={id} style={styles.row}>
                    <Text style={styles.rowTitle}>{def.name}</Text>
                    <Text style={styles.count}>{`× ${n}`}</Text>
                    {def.food && (
                      <SheetButton label="Съесть" onPress={() => run((s) => eat(s, id))} />
                    )}
                    {def.places && (
                      <SheetButton
                        label="Поставить"
                        onPress={() => {
                          run((s) => place(s, id));
                          setBagOpen(false);
                        }}
                      />
                    )}
                  </View>
                );
              })
            )}
            {bagItems.some(([id]) => ITEMS[id].places) && (
              <Text style={styles.note}>Постройка встаёт на клетку, к которой ты повернулся.</Text>
            )}

            <Text style={[styles.sheetLabel, styles.spaced]}>Сделать</Text>
            {RECIPES.map((recipe) => {
              const check = canCraft(state, recipe);
              const needs = (Object.entries(recipe.needs) as [ItemId, number][])
                .map(([id, n]) => `${ITEMS[id].name.toLowerCase()} ${state.bag[id] ?? 0}/${n}`)
                .join(" · ");
              return (
                <View key={recipe.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, !check.ok && styles.muted]}>
                      {recipe.count > 1 ? `${ITEMS[recipe.makes].name} × ${recipe.count}` : ITEMS[recipe.makes].name}
                    </Text>
                    <Text style={styles.rowHint}>
                      {needs}
                      {recipe.at ? ` · у верстака` : ""}
                    </Text>
                  </View>
                  <SheetButton
                    label={check.ok === true ? "Сделать" : check.reason === "Уже есть" ? "Есть" : "Мало"}
                    disabled={!check.ok}
                    onPress={() => run((s) => craft(s, recipe.id))}
                  />
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const ARROW: Record<Dir, "chevron-up" | "chevron-down" | "chevron-left" | "chevron-right"> = {
  up: "chevron-up",
  down: "chevron-down",
  left: "chevron-left",
  right: "chevron-right",
};
const DIR_NAME: Record<Dir, string> = { up: "Вверх", down: "Вниз", left: "Влево", right: "Вправо" };

function PadButton({
  dir,
  onStart,
  onStop,
  onTap,
  style,
}: {
  dir: Dir;
  onStart: (d: Dir) => void;
  onStop: () => void;
  onTap: (d: Dir) => void;
  style?: object;
}) {
  return (
    <Pressable
      onPressIn={() => onStart(dir)}
      onPressOut={onStop}
      onPress={() => onTap(dir)}
      accessibilityRole="button"
      accessibilityLabel={DIR_NAME[dir]}
      style={({ pressed }) => [styles.padButton, style, pressed && styles.padPressed]}
    >
      <Feather name={ARROW[dir]} size={26} color={colors.text} />
    </Pressable>
  );
}

function SheetButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.sheetButton, disabled && styles.sheetButtonOff, pressed && styles.dimmed]}
    >
      <Text style={[styles.sheetButtonText, disabled && styles.muted]}>{label}</Text>
    </Pressable>
  );
}

const PAD = 52;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14 },
  dimmed: { opacity: 0.6 },
  muted: { color: colors.textMuted },

  top: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 30 },
  day: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  food: { alignItems: "flex-end", gap: 3 },
  foodLabel: { color: colors.textMuted, fontSize: 10 },
  foodTrack: { width: 80, height: 5, borderRadius: 3, backgroundColor: colors.card, overflow: "hidden" },
  foodFill: { height: 5, borderRadius: 3, backgroundColor: colors.accentGreen },
  goal: { color: colors.textMuted, fontSize: 11, marginTop: 6 },

  mapArea: { flex: 1, marginTop: 8, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  cell: { position: "absolute" },
  target: { borderWidth: 2, borderColor: "rgba(232,230,224,0.35)", borderRadius: 6 },

  message: { color: colors.text, fontSize: 12, lineHeight: 17, minHeight: 34, marginTop: 8 },

  controls: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  pad: { width: PAD * 3 + 8, alignItems: "center" },
  padRow: { flexDirection: "row", alignItems: "center" },
  padGap: { width: PAD + 8 },
  padUp: { marginBottom: 2 },
  padDown: { marginTop: 2 },
  padButton: {
    width: PAD,
    height: PAD,
    borderRadius: 14,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  padPressed: { backgroundColor: colors.cardBorder },

  side: { flex: 1, gap: 10 },
  action: {
    minHeight: 64,
    borderRadius: 16,
    backgroundColor: colors.accentGreen,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  actionOff: { backgroundColor: colors.card },
  actionText: { color: colors.bg, fontSize: 15, fontWeight: "700", textAlign: "center" },
  sideRow: { flexDirection: "row", gap: 8 },
  small: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  smallText: { color: colors.text, fontSize: 12, fontWeight: "600" },

  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: "38%",
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  sheetTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "700" },
  sheetLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 18 },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  count: { flex: 1, color: colors.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] },
  sheetButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accentGreen,
  },
  sheetButtonOff: { backgroundColor: colors.cardBorder },
  sheetButtonText: { color: colors.bg, fontSize: 12, fontWeight: "700" },
});
