import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  Vibration,
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
import SettingsSheet from "../../components/village/SettingsSheet";
import MovePad from "../../components/village/MovePad";
import { ItemIcon } from "../../components/village/ItemIcon";
import { ActionButton, RoundButton } from "../../components/village/Controls";
import { GOALS, ITEMS, type ItemId } from "../../lib/village/content";
import { VillageSound } from "../../lib/village/sound";
import {
  BUTTON_SCALE,
  DEFAULT_SETTINGS,
  STEP_MS,
  VOLUME,
  canTapWalk,
  type VillageSettings,
} from "../../lib/village/settings";
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
  type SoundId,
  type VillageState,
} from "../../lib/village/game";

/** Сколько клеток видно поперёк экрана: вертикально — по ширине, горизонтально — по высоте. */
const PORTRAIT_COLS = 9;
const LANDSCAPE_ROWS = 7.5;
/** На что отзывается вибрация: на дело, а не на каждый шаг. */
const BUZZ: Partial<Record<SoundId, number>> = { chop: 18, stone: 22, craft: 14, place: 20, pickup: 10, twig: 6, pebble: 6, berries: 8 };

/**
 * «Опушка» — спокойная игра про лес и деревню.
 *
 * Время идёт только от действий: пока ничего не нажимаешь, в мире ничего не происходит.
 * Сохраняется само, через секунду после последнего действия и при уходе с экрана.
 *
 * Ходить можно джойстиком, крестовиной или касанием по карте — что выбрано в настройках.
 * Нажал на клетку — персонаж сам дойдёт туда самой короткой дорогой; нажал на дерево —
 * дойдёт и встанет к нему лицом; нажал на то, к чему уже стоишь лицом, — то же, что
 * кнопка действия.
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
  const [sheet, setSheet] = useState<"bag" | "settings" | null>(null);
  const [settings, setSettingsRaw] = useState<VillageSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<VillageSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
    return () => navigation.setOptions({ headerShown: true });
  }, [navigation]);

  // --- звук ------------------------------------------------------------------------

  const sound = useRef<VillageSound | null>(null);
  if (sound.current === null) sound.current = new VillageSound();
  const applySoundSettings = (s: VillageSettings) =>
    sound.current?.configure({
      effects: s.sound,
      volume: VOLUME[s.volume].effects,
      ambience: s.ambience,
      ambienceVolume: VOLUME[s.volume].ambience,
    });
  const play = useCallback((id: SoundId) => sound.current?.play(id), []);

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
    const bank = sound.current!;
    void api.getVillageSettings().then((s) => {
      settingsRef.current = s;
      setSettingsRaw(s);
      applySoundSettings(s);
      if (s.landscape) void lockLandscape();
      void bank.load();
    });
    void api.getVillage().then((saved) => {
      const s = saved ?? newVillage(Math.floor(Math.random() * 2 ** 31));
      stateRef.current = s;
      setStateRaw(s);
      if (!saved) {
        void api.saveVillage(s);
        say("Утро на опушке. Ветки и камешки лежат рядом — наступи на них");
      }
    });
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") bank.resume();
      else {
        saveNow();
        bank.pause();
      }
    });
    return () => {
      sub.remove();
      saveNow();
      bank.unload();
      // Остальное приложение — вертикальное.
      void lockPortrait();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveNow, say]);

  const changeSettings = (next: VillageSettings) => {
    const prev = settingsRef.current;
    settingsRef.current = next;
    setSettingsRaw(next);
    applySoundSettings(next);
    void api.setVillageSettings(next);
    if (next.landscape !== prev.landscape) void (next.landscape ? lockLandscape() : lockPortrait());
  };

  const night = state ? isNight(state.time) : false;
  useEffect(() => {
    if (state) sound.current?.setAmbience(night ? "night" : "day");
  }, [night, state === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback(
    (outcome: Outcome) => {
      stateRef.current = outcome.state;
      setStateRaw(outcome.state);
      if (outcome.message !== null) say(outcome.message);
      if (outcome.sound) {
        play(outcome.sound);
        const buzz = BUZZ[outcome.sound];
        if (buzz && settingsRef.current.vibration) {
          try {
            Vibration.vibrate(buzz);
          } catch {
            // вибрации нет — и ладно
          }
        }
      }
      if (outcome.goal) setTimeout(() => play("goal"), 260);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(saveNow, 1000);
    },
    [saveNow, say, play],
  );

  const run = useCallback(
    (fn: (s: VillageState) => Outcome) => {
      if (stateRef.current) apply(fn(stateRef.current));
    },
    [apply],
  );

  // --- ходьба ---------------------------------------------------------------------

  /**
   * Одна очередь шагов на всё: и на удержание джойстика, и на дорогу по касанию.
   *
   * Следующий шаг ставится только после того, как сделан предыдущий, — таймером на один раз,
   * а не повторяющимся. Повторяющийся на медленном телефоне копил шаги, пока карта
   * рисовалась, и персонаж проезжал дальше, чем держали палец.
   */
  const held = useRef<Dir | null>(null);
  const route = useRef<Dir[]>([]);
  const loop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStep = useRef(0);
  const stopLoop = useCallback(() => {
    if (loop.current) clearTimeout(loop.current);
    loop.current = null;
  }, []);

  const tick = useCallback(() => {
    loop.current = null;
    const d = held.current ?? route.current.shift() ?? null;
    if (!d) return;
    lastStep.current = Date.now();
    run((s) => move(s, d));
    if (held.current || route.current.length > 0) loop.current = setTimeout(tick, STEP_MS[settingsRef.current.speed]);
  }, [run]);

  useEffect(() => () => stopLoop(), [stopLoop]);

  const onDir = (d: Dir | null) => {
    const was = held.current;
    held.current = d;
    if (!d) {
      stopLoop();
      return;
    }
    route.current = [];
    if (d === was && loop.current) return;
    // Новое направление — шаг сразу, но не чаще обычного темпа: иначе, покачивая пальцем,
    // можно было бы бежать вдвое быстрее.
    stopLoop();
    const wait = STEP_MS[settingsRef.current.speed] * 0.7 - (Date.now() - lastStep.current);
    if (wait > 0) loop.current = setTimeout(tick, wait);
    else tick();
  };

  const follow = (steps: Dir[]) => {
    held.current = null;
    stopLoop();
    route.current = [...steps];
    tick();
  };

  const onMapTap = (x: number, y: number) => {
    const s = stateRef.current;
    if (!s || sheet) return;
    const f = facingCell(s);
    if (x === f.x && y === f.y && actionLabel(s)) {
      route.current = [];
      stopLoop();
      run(act);
      return;
    }
    if (!canTapWalk(settingsRef.current) || (x === s.x && y === s.y)) return;
    const steps = pathTo(s, x, y);
    if (!steps) {
      play("nope");
      say(cellAt(s, x, y)?.ground === "water" ? "Туда вплавь не добраться" : "Туда не пройти");
      return;
    }
    follow(steps);
  };

  const openSheet = (which: "bag" | "settings") => {
    held.current = null;
    route.current = [];
    stopLoop();
    play(which === "bag" ? "bag" : "ui");
    setSheet(which);
  };

  const newWorld = () => {
    const fresh = newVillage(Math.floor(Math.random() * 2 ** 31));
    setSheet(null);
    apply({ state: fresh, message: "Новый мир. Утро на опушке — ветки и камешки рядом", sound: "sleep" });
    saveNow();
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

  const scale = BUTTON_SCALE[settings.buttons];
  const label = actionLabel(state);
  const icon = actionIcon(state);
  const front = facingCell(state);
  const frontBuilt = cellAt(state, front.x, front.y)?.built ?? null;
  const goal = settings.showGoal ? currentGoal(state) : null;
  const goalNo = GOALS.findIndex((g) => g.id === goal?.id) + 1;
  const berries = state.bag.berries ?? 0;
  const hot = (Object.entries(state.bag) as [ItemId, number][]).filter(([, n]) => n > 0);
  const hotMax = landscape ? 6 : 7;
  const padOn = settings.control !== "tap";
  const padRight = settings.padSide === "right";

  const map =
    tile > 0 ? (
      <VillageMap
        state={state}
        width={area.w}
        height={area.h}
        tile={tile}
        accent={colors.accent}
        showTarget={settings.showTarget && !!label}
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
    <View style={[styles.pill, styles.pillTight, landscape && styles.pillFloating]} accessibilityLabel={`Сытость ${Math.round(state.food)} из 100`}>
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

  const hudButtons = (
    <>
      <RoundButton icon="smartphone" label="Повернуть экран" onPress={() => changeSettings({ ...settings, landscape: !landscape })} floating={landscape} size={40} />
      <RoundButton icon="settings" label="Настройки игры" onPress={() => openSheet("settings")} floating={landscape} size={40} />
    </>
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
      onPress={() => openSheet("bag")}
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

  const small = Math.round(46 * scale);
  const sideButtons = (
    <>
      <RoundButton icon="briefcase" label="Сумка" onPress={() => openSheet("bag")} floating={landscape} size={small} />
      {berries > 0 && state.food < 90 && (
        <RoundButton label="Съесть ягоды" onPress={() => run((s) => eat(s, "berries"))} badge={String(berries)} floating={landscape} size={small}>
          <ItemIcon id="berries" size={24 * scale} />
        </RoundButton>
      )}
      {frontBuilt && <RoundButton icon="rotate-ccw" label="Разобрать" onPress={() => run(pickUp)} floating={landscape} size={small} />}
    </>
  );

  const sheetView =
    sheet === "bag" ? (
      <BagSheet
        state={state}
        side={landscape}
        onClose={() => setSheet(null)}
        onEat={(id) => run((s) => eat(s, id))}
        onPlace={(id) => {
          run((s) => place(s, id));
          setSheet(null);
        }}
        onCraft={(id) => run((s) => craft(s, id))}
      />
    ) : sheet === "settings" ? (
      <SettingsSheet
        settings={settings}
        state={state}
        side={landscape}
        onChange={changeSettings}
        onClose={() => setSheet(null)}
        onNewWorld={newWorld}
      />
    ) : null;

  if (landscape) {
    const padSize = Math.min(160, winH * 0.44) * scale;
    const actionSize = Math.round(84 * scale);
    const padSlot = padRight ? { right: insets.right + 20 } : { left: insets.left + 20 };
    const actionSlot = padRight ? { left: insets.left + 20, flexDirection: "row-reverse" as const } : { right: insets.right + 20 };
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
          {hudButtons}
        </View>

        {padOn && (
          <View style={[styles.padFloat, padSlot]}>
            <MovePad mode={settings.control === "dpad" ? "dpad" : "stick"} size={padSize} onDir={onDir} floating />
          </View>
        )}

        <View style={[styles.actionFloat, actionSlot]} pointerEvents="box-none">
          <View style={styles.sideCol}>{sideButtons}</View>
          <ActionButton size={actionSize} label={label} icon={icon} onPress={() => run(act)} floating />
        </View>

        <View style={styles.bottomCenter} pointerEvents="box-none">
          {toastView}
          {hotbar}
        </View>
        {sheetView}
      </View>
    );
  }

  const padSize = Math.min(160, winW * 0.42) * scale;
  const actionCol = (
    <View style={styles.rightCol}>
      <ActionButton size={Math.round(86 * scale)} label={label} icon={icon} onPress={() => run(act)} />
      <View style={styles.sideRow}>{sideButtons}</View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 10) + 4 }]}>
      <View style={styles.top}>
        <RoundButton icon="arrow-left" label="Назад" onPress={() => navigation.goBack()} size={40} />
        {dayPill}
        <View style={{ flex: 1 }} />
        {foodPill}
        {hudButtons}
      </View>
      {goalCard}

      <View style={styles.mapFrame} onLayout={onFrame}>
        {map}
        <View style={styles.toastSlot} pointerEvents="none">
          {toastView}
        </View>
      </View>

      <View style={styles.hotRow}>{hotbar}</View>

      <View style={[styles.controls, padRight && styles.controlsFlip, !padOn && styles.controlsCenter]}>
        {padOn && <MovePad mode={settings.control === "dpad" ? "dpad" : "stick"} size={padSize} onDir={onDir} />}
        {actionCol}
      </View>
      {sheetView}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 12, paddingBottom: 14 },
  containerFull: { flex: 1, backgroundColor: "#000" },

  top: { flexDirection: "row", alignItems: "center", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pillTight: { paddingHorizontal: 9 },
  pillFloating: { backgroundColor: "rgba(18,21,26,0.62)", borderColor: "rgba(255,255,255,0.08)" },
  pillStrong: { color: colors.text, fontSize: 13, fontWeight: "700" },
  pillText: { color: colors.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] },
  foodTrack: { width: 40, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
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
  goalFloating: { marginTop: 0, backgroundColor: "rgba(18,21,26,0.62)", maxWidth: 280, paddingVertical: 7 },
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
  controlsFlip: { flexDirection: "row-reverse" },
  controlsCenter: { justifyContent: "center" },
  rightCol: { alignItems: "center", gap: 10, flex: 1 },
  sideRow: { flexDirection: "row", gap: 10 },

  topFloat: { position: "absolute", top: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  padFloat: { position: "absolute", bottom: 18 },
  actionFloat: { position: "absolute", bottom: 18, flexDirection: "row", alignItems: "flex-end", gap: 14 },
  sideCol: { gap: 10, marginBottom: 26 },
  bottomCenter: { position: "absolute", left: 0, right: 0, bottom: 16, alignItems: "center" },
});
