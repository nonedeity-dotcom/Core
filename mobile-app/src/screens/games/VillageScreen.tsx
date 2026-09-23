import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { lockLandscape, lockPortrait } from "../../lib/orientation";
import VillageMap from "../../components/village/VillageMap";
import BagSheet from "../../components/village/BagSheet";
import { ItemIcon } from "../../components/village/ItemIcon";
import { ActionButton, DPad, RoundButton } from "../../components/village/Controls";
import { GOALS, ITEMS, type ItemId } from "../../lib/village/content";
import {
  act,
  actionIcon,
  actionLabel,
  cellAt,
  clockOf,
  craft,
  currentGoal,
  dayOf,
  eat,
  facingCell,
  isNight,
  move,
  newVillage,
  pathTo,
  pickUp,
  place,
  type Dir,
  type Outcome,
  type VillageState,
} from "../../lib/village/game";

/** Как часто делается шаг, пока кнопка зажата или персонаж идёт по касанию. */
const STEP_MS = 150;
/** Сколько клеток видно поперёк экрана: вертикально — по ширине, горизонтально — по высоте. */
const PORTRAIT_COLS = 9;
const LANDSCAPE_ROWS = 7.5;

/**
 * «Опушка» — спокойная игра про лес и деревню.
 *
 * Время идёт только от действий: пока ничего не нажимаешь, в мире ничего не происходит.
 * Сохраняется само, через секунду после последнего действия и при уходе с экрана.
 *
 * Управлять можно двумя способами, и оба всегда под рукой: крестовиной (нажал — шаг,
 * держишь — идёт) или пальцем по карте — нажал на клетку, и персонаж сам дойдёт туда
 * самой короткой дорогой; нажал на дерево — дойдёт и встанет к нему лицом. Нажатие на
 * то, к чему уже стоишь лицом, — то же, что кнопка действия.
 *
 * Экран можно положить набок кнопкой в углу: тогда карта на весь экран, а кнопки лежат
 * поверх неё полупрозрачными. Выбор запоминается.
 */
export default function VillageScreen({
  navigation,
}: {
  navigation: { goBack: () => void; setOptions: (options: { headerShown: boolean }) => void };
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  const insets = useSafeAreaInsets();

  const [state, setStateRaw] = useState<VillageState | null>(null);
  const stateRef = useRef<VillageState | null>(null);
  const [bagOpen, setBagOpen] = useState(false);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
    return () => navigation.setOptions({ headerShown: true });
  }, [navigation]);

  // --- всплывающая строка ---------------------------------------------------------

  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const say = useCallback((text: string) => setToast((t) => ({ text, n: (t?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!toast) return;
    toastOpacity.stopAnimation();
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [toast, toastOpacity]);

  // --- загрузка, сохранение, поворот ----------------------------------------------

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
        say("Утро на опушке. Ветки и камешки лежат рядом — наступи на них");
      }
    });
    void api.getVillageLandscape().then((on) => {
      if (on) void lockLandscape();
    });
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") saveNow();
    });
    return () => {
      sub.remove();
      saveNow();
      // Остальное приложение — вертикальное.
      void lockPortrait();
    };
  }, [saveNow, say]);

  const rotate = () => {
    const next = !landscape;
    void api.setVillageLandscape(next);
    void (next ? lockLandscape() : lockPortrait());
  };

  const apply = useCallback(
    (outcome: Outcome) => {
      stateRef.current = outcome.state;
      setStateRaw(outcome.state);
      if (outcome.message !== null) say(outcome.message);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(saveNow, 1000);
    },
    [saveNow, say],
  );

  const run = useCallback(
    (fn: (s: VillageState) => Outcome) => {
      if (stateRef.current) apply(fn(stateRef.current));
    },
    [apply],
  );

  // --- ходьба: крестовиной и по касанию -------------------------------------------

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const route = useRef<Dir[]>([]);
  /** Сделан ли шаг за это нажатие — чтобы короткий тап не пропал и не сработал дважды. */
  const stepped = useRef(false);
  const stopWalk = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    route.current = [];
  }, []);
  useEffect(() => stopWalk, [stopWalk]);

  const startWalk = (dir: Dir) => {
    stopWalk();
    stepped.current = true;
    run((s) => move(s, dir));
    timer.current = setInterval(() => run((s) => move(s, dir)), STEP_MS);
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

  const follow = (steps: Dir[]) => {
    stopWalk();
    route.current = [...steps];
    const next = () => {
      const d = route.current.shift();
      if (!d) {
        stopWalk();
        return;
      }
      run((s) => move(s, d));
    };
    next();
    if (route.current.length > 0) timer.current = setInterval(next, STEP_MS);
  };

  const onMapTap = (x: number, y: number) => {
    const s = stateRef.current;
    if (!s || bagOpen) return;
    const f = facingCell(s);
    if (x === f.x && y === f.y && actionLabel(s)) {
      stopWalk();
      run(act);
      return;
    }
    if (x === s.x && y === s.y) return;
    const steps = pathTo(s, x, y);
    if (!steps) {
      say(cellAt(s, x, y)?.ground === "water" ? "Туда вплавь не добраться" : "Туда не пройти");
      return;
    }
    follow(steps);
  };

  // --- размеры карты --------------------------------------------------------------

  // Вертикально карта занимает то место, что осталось между верхом и кнопками, — его
  // меряем. Горизонтально она на весь экран, и мерить нечего: берём размер окна. Замер тут
  // подводил — после поворота последним приходил размер старой, вертикальной рамки, и карта
  // рисовалась на пол-экрана.
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const onFrame = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.round(width) !== Math.round(frame.w) || Math.round(height) !== Math.round(frame.h)) setFrame({ w: width, h: height });
  };
  const area = landscape ? { w: winW, h: winH } : frame;
  const tile = area.w > 0 && area.h > 0 ? Math.floor(landscape ? area.h / LANDSCAPE_ROWS : area.w / PORTRAIT_COLS) : 0;

  if (!state) return <View style={styles.container} />;

  const label = actionLabel(state);
  const icon = actionIcon(state);
  const front = facingCell(state);
  const frontBuilt = cellAt(state, front.x, front.y)?.built ?? null;
  const goal = currentGoal(state);
  const goalNo = GOALS.findIndex((g) => g.id === goal?.id) + 1;
  const night = isNight(state.time);
  const berries = state.bag.berries ?? 0;
  const hot = (Object.entries(state.bag) as [ItemId, number][]).filter(([, n]) => n > 0);
  const hotMax = landscape ? 6 : 7;

  const map =
    tile > 0 ? (
      <VillageMap
        state={state}
        width={area.w}
        height={area.h}
        tile={tile}
        accent={colors.accent}
        showTarget={!!label}
        onTap={onMapTap}
      />
    ) : null;

  const dayPill = (
    <View style={[styles.pill, landscape && styles.pillFloating]} accessibilityLabel={`День ${dayOf(state.time)}, ${clockOf(state.time)}`}>
      <Feather name={night ? "moon" : "sun"} size={14} color={night ? "#b9c4e8" : "#f2c26b"} />
      <Text style={styles.pillStrong}>{`День ${dayOf(state.time)}`}</Text>
      <Text style={styles.pillText}>{clockOf(state.time)}</Text>
    </View>
  );

  const foodPill = (
    <View style={[styles.pill, landscape && styles.pillFloating]} accessibilityLabel={`Сытость ${Math.round(state.food)} из 100`}>
      <ItemIcon id="berries" size={16} />
      <View style={styles.foodTrack}>
        <View
          style={[
            styles.foodFill,
            { width: `${Math.max(3, Math.round(state.food))}%` },
            state.food < 25 && { backgroundColor: colors.accent },
          ]}
        />
      </View>
    </View>
  );

  const goalCard = goal && (
    <View style={[styles.goal, landscape && styles.goalFloating]}>
      <View style={styles.goalIcon}>
        <Feather name="flag" size={13} color={colors.accentGreen} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.goalTitle} numberOfLines={1}>{`${goal.title}  ·  ${goalNo}/${GOALS.length}`}</Text>
        {!landscape && (
          <Text style={styles.goalHint} numberOfLines={1}>
            {goal.hint}
          </Text>
        )}
      </View>
    </View>
  );

  const toastView = toast && (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastOpacity }]}>
      <Text style={styles.toastText} numberOfLines={2}>
        {toast.text}
      </Text>
    </Animated.View>
  );

  const hotbar = hot.length > 0 && (
    <Pressable
      onPress={() => setBagOpen(true)}
      accessibilityRole="button"
      accessibilityLabel="Вещи в сумке"
      style={[styles.hotbar, landscape && styles.hotbarFloating]}
    >
      {hot.slice(0, hotMax).map(([id, n]) => (
        <View key={id} style={styles.hotItem}>
          <ItemIcon id={id} size={22} />
          {!ITEMS[id].tool && <Text style={styles.hotCount}>{n}</Text>}
        </View>
      ))}
      {hot.length > hotMax && <Feather name="more-horizontal" size={16} color={colors.textMuted} />}
    </Pressable>
  );

  const sideButtons = (
    <>
      <RoundButton icon="briefcase" label="Сумка" onPress={() => setBagOpen(true)} floating={landscape} />
      {berries > 0 && state.food < 90 && (
        <RoundButton label="Съесть ягоды" onPress={() => run((s) => eat(s, "berries"))} badge={String(berries)} floating={landscape}>
          <ItemIcon id="berries" size={24} />
        </RoundButton>
      )}
      {frontBuilt && <RoundButton icon="rotate-ccw" label="Разобрать" onPress={() => run(pickUp)} floating={landscape} />}
    </>
  );

  const bag = bagOpen && (
    <BagSheet
      state={state}
      side={landscape}
      onClose={() => setBagOpen(false)}
      onEat={(id) => run((s) => eat(s, id))}
      onPlace={(id) => {
        run((s) => place(s, id));
        setBagOpen(false);
      }}
      onCraft={(id) => run((s) => craft(s, id))}
    />
  );

  if (landscape) {
    const padSize = Math.min(150, winH * 0.42);
    return (
      <View style={styles.containerFull}>
        <StatusBar hidden />
        <View style={StyleSheet.absoluteFill}>{map}</View>

        <View style={[styles.topFloat, { left: insets.left + 12, right: insets.right + 12 }]} pointerEvents="box-none">
          <RoundButton icon="arrow-left" label="Назад" onPress={() => navigation.goBack()} floating size={40} />
          {dayPill}
          {foodPill}
          <View style={{ flex: 1 }} pointerEvents="none" />
          {goalCard}
          <RoundButton icon="smartphone" label="Повернуть экран" onPress={rotate} floating size={40} />
        </View>

        <View style={[styles.padFloat, { left: insets.left + 18 }]}>
          <DPad size={padSize} onStart={startWalk} onStop={stopWalk} onTap={tapWalk} floating />
        </View>

        <View style={[styles.actionFloat, { right: insets.right + 18 }]} pointerEvents="box-none">
          <View style={styles.sideCol}>{sideButtons}</View>
          <ActionButton size={84} label={label} icon={icon} onPress={() => run(act)} floating />
        </View>

        <View style={styles.bottomCenter} pointerEvents="box-none">
          {toastView}
          {hotbar}
        </View>
        {bag}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 10) + 4 }]}>
      <View style={styles.top}>
        <RoundButton icon="arrow-left" label="Назад" onPress={() => navigation.goBack()} size={40} />
        {dayPill}
        <View style={{ flex: 1 }} />
        {foodPill}
        <RoundButton icon="smartphone" label="Повернуть экран" onPress={rotate} size={40} />
      </View>
      {goalCard}

      <View style={styles.mapFrame} onLayout={onFrame}>
        {map}
        <View style={styles.toastSlot} pointerEvents="none">
          {toastView}
        </View>
      </View>

      <View style={styles.hotRow}>{hotbar}</View>

      <View style={styles.controls}>
        <DPad size={Math.min(160, winW * 0.42)} onStart={startWalk} onStop={stopWalk} onTap={tapWalk} />
        <View style={styles.rightCol}>
          <ActionButton size={86} label={label} icon={icon} onPress={() => run(act)} />
          <View style={styles.sideRow}>{sideButtons}</View>
        </View>
      </View>
      {bag}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 12, paddingBottom: 14 },
  containerFull: { flex: 1, backgroundColor: "#000" },

  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pillFloating: { backgroundColor: "rgba(18,21,26,0.62)", borderColor: "rgba(255,255,255,0.08)" },
  pillStrong: { color: colors.text, fontSize: 13, fontWeight: "700" },
  pillText: { color: colors.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] },
  foodTrack: { width: 58, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  foodFill: { height: 6, borderRadius: 3, backgroundColor: colors.accentGreen },

  goal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  goalFloating: { marginTop: 0, backgroundColor: "rgba(18,21,26,0.62)", maxWidth: 300, paddingVertical: 7 },
  goalIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(143,184,154,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  goalTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  goalHint: { color: colors.textMuted, fontSize: 11, marginTop: 1 },

  mapFrame: {
    flex: 1,
    marginTop: 10,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  toastSlot: { position: "absolute", left: 10, right: 10, bottom: 10, alignItems: "center" },
  toast: {
    maxWidth: 360,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: "rgba(18,21,26,0.86)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  toastText: { color: colors.text, fontSize: 13, lineHeight: 18, textAlign: "center" },

  hotRow: { alignItems: "center", marginTop: 10, minHeight: 40 },
  hotbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
  },
  hotbarFloating: { backgroundColor: "rgba(18,21,26,0.62)", marginTop: 8 },
  hotItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  hotCount: { color: colors.text, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  rightCol: { alignItems: "center", gap: 10, flex: 1 },
  sideRow: { flexDirection: "row", gap: 10 },

  topFloat: { position: "absolute", top: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  padFloat: { position: "absolute", bottom: 18 },
  actionFloat: { position: "absolute", bottom: 18, flexDirection: "row", alignItems: "flex-end", gap: 14 },
  sideCol: { gap: 10, marginBottom: 26 },
  bottomCenter: { position: "absolute", left: 0, right: 0, bottom: 16, alignItems: "center" },
});
