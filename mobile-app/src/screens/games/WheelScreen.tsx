import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { todayKey } from "../../lib/date";
import {
  WHEEL_LEVELS,
  extendWheelPath,
  hintCell,
  judge,
  letterMap,
  levelAt,
  shuffled,
  solved,
  uncovered,
  visibleCells,
  wordOf,
  type Cell,
} from "../../lib/games/wheel";
import { emptyWheelProgress, type GameStats, type WheelStats } from "../../lib/games/stats";
import { spend, type Purse } from "../../lib/rewards/currency";
import { HINT_PRICES } from "../../lib/rewards/catalog";
import { SPARKS } from "../../lib/rewards/earn";
import { useSavePurse } from "../../lib/rewards/useSavePurse";

/** Что сейчас на уровне. Одним куском: слово, подсказка и конец уровня меняют его вместе. */
interface Play {
  found: string[];
  bonus: string[];
  hinted: Cell[];
}

type Flash = { text: string; tone: "good" | "bonus" | "plain" };

/**
 * «Колесо букв»: буквы по кругу, из них — слова, и слова ложатся в кроссворд над колесом.
 *
 * Уровни идут лестницей, один за другим, и выход посреди уровня его не сбрасывает: найденное
 * и купленные подсказки лежат в статистике игры. Кроме слов для сетки, из тех же букв часто
 * складываются и другие настоящие слова — они засчитываются бонусом, а не «нет такого».
 *
 * Палец ведётся от буквы к букве, без отрыва; вернуться на предыдущую — стереть последнюю.
 */
export default function WheelScreen({
  navigation,
}: {
  navigation: { goBack: () => void; setOptions: (options: { headerShown: boolean }) => void };
}) {
  const qc = useQueryClient();
  const { data: stats } = useQuery<GameStats>({ queryKey: ["gameStats"], queryFn: () => api.getGameStats() });
  const { data: purse } = useQuery<Purse>({ queryKey: ["purse"], queryFn: () => api.getPurse() });
  const pay = useSavePurse();

  // Номер уровня и найденное берутся из хранилища один раз, при входе. Дальше экран ведёт
  // их сам и только записывает: перечитывать своё же после каждой записи незачем.
  const [index, setIndex] = useState<number | null>(null);
  const [play, setPlayState] = useState<Play>({ found: [], bonus: [], hinted: [] });
  const playRef = useRef(play);
  const setPlay = (next: Play) => {
    playRef.current = next;
    setPlayState(next);
  };
  const [won, setWon] = useState(false);
  const [letters, setLetters] = useState("");
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => {
    if (!stats || index !== null) return;
    const w = stats.wheel;
    const level = levelAt(w.level);
    // Недоигранный уровень мог остаться от другой версии уровней — берём только то, что в
    // нём действительно есть.
    const words = new Set(level.words.map((e) => e[0]));
    setIndex(w.level);
    setLetters(level.letters);
    setPlay({
      found: w.progress.found.filter((x) => words.has(x)),
      bonus: w.progress.bonus.filter((x) => level.bonus.includes(x)),
      hinted: w.progress.hinted
        .map(([row, col]) => ({ row, col }))
        .filter((c) => c.row < level.rows && c.col < level.cols),
    });
  }, [stats, index]);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
    return () => navigation.setOptions({ headerShown: true });
  }, [navigation]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(id);
  }, [flash]);

  const persist = (change: (w: WheelStats) => WheelStats) =>
    api.updateGameStats((s) => ({ ...s, wheel: change(s.wheel) })).then((saved) => qc.setQueryData(["gameStats"], saved));

  const level = levelAt(index ?? 0);
  const map = letterMap(level);

  /**
   * Новое состояние уровня — дописать и проверить, не кончился ли он.
   *
   * Слова, открывшиеся целиком подсказками и пересечениями, засчитываются сразу: водить
   * пальцем по буквам, которые и так все видны, — не игра, а обряд.
   */
  const advance = (next: Play, bonusGained: number) => {
    if (index === null) return;
    const found = [...next.found, ...uncovered(level, next.found, next.hinted)];
    const state = { ...next, found };
    setPlay(state);
    const done = solved(level, found);
    if (done) setWon(true);
    void persist((w) => {
      // Уровень в хранилище уже ушёл вперёд — например, с другого экрана. Своё не навязываем.
      if (w.level !== index) return w;
      const bonus = w.bonus + bonusGained;
      if (done) return { ...w, level: index + 1, bonus, lastAt: todayKey(), progress: emptyWheelProgress() };
      return {
        ...w,
        bonus,
        lastAt: todayKey(),
        progress: {
          found: state.found,
          bonus: state.bonus,
          hinted: state.hinted.map((c) => [c.row, c.col] as [number, number]),
        },
      };
    });
  };

  const submit = (word: string) => {
    if (word.length === 0 || won) return;
    const now = playRef.current;
    const verdict = judge(level, now.found, now.bonus, word);
    if (verdict === "grid") {
      setFlash({ text: word, tone: "good" });
      advance({ ...now, found: [...now.found, word] }, 0);
    } else if (verdict === "bonus") {
      setFlash({ text: `${word} — бонус`, tone: "bonus" });
      advance({ ...now, bonus: [...now.bonus, word] }, 1);
    } else if (verdict === "again") {
      setFlash({ text: `${word} — уже есть`, tone: "plain" });
    } else if (word.length >= 3) {
      setFlash({ text: `${word} — нет такого слова`, tone: "plain" });
    } else if (word.length === 2) {
      setFlash({ text: "Слова здесь от трёх букв", tone: "plain" });
    }
  };

  const hint = () => {
    const now = playRef.current;
    const cell = hintCell(level, now.found, now.hinted);
    if (!cell || won) return;
    pay.mutate((current) => spend(current, { sparks: HINT_PRICES.letter }, "Колесо: подсказка", todayKey()), {
      onSuccess: (saved) => {
        if (!saved) return;
        const latest = playRef.current;
        advance({ ...latest, hinted: [...latest.hinted, cell] }, 0);
      },
    });
  };

  const nextLevel = () => {
    if (index === null) return;
    const n = index + 1;
    setIndex(n);
    setLetters(levelAt(n).letters);
    setPlay({ found: [], bonus: [], hinted: [] });
    setWon(false);
    setFlash(null);
  };

  // --- сетка ------------------------------------------------------------------

  const [space, setSpace] = useState({ w: 0, h: 0 });
  const onSpace = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== space.w || height !== space.h) setSpace({ w: width, h: height });
  };
  const cell = Math.floor(Math.min(space.w / level.cols, space.h / level.rows, 46));
  const seen = visibleCells(level, play.found, play.hinted);
  const foundCells = visibleCells(level, play.found, []);

  // --- колесо -----------------------------------------------------------------

  const [wheelSide, setWheelSide] = useState(0);
  const onWheelSpace = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const side = Math.floor(Math.min(width, height, 300));
    if (side > 0 && side !== wheelSide) setWheelSide(side);
    measure();
  };
  const n = letters.length;
  const button = wheelSide * (n > 6 ? 0.21 : 0.24);
  const radius = wheelSide / 2 - button / 2 - 6;
  const centers = [...letters].map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: wheelSide / 2 + radius * Math.cos(a), y: wheelSide / 2 + radius * Math.sin(a) };
  });

  // Та же история, что в «Найди слова»: координаты берутся от окна, а не от того, над чьей
  // буквой сейчас палец, — иначе попадание зависит от того, от кого пришло событие.
  const wheelRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const measure = () =>
    wheelRef.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });

  const pathRef = useRef<number[]>([]);
  const [path, setPathState] = useState<number[]>([]);
  const [finger, setFinger] = useState<{ x: number; y: number } | null>(null);
  const setPath = (next: number[]) => {
    pathRef.current = next;
    setPathState(next);
  };

  const letterAt = (pageX: number, pageY: number): number | null => {
    const x = pageX - origin.current.x;
    const y = pageY - origin.current.y;
    // Попадание — в круг чуть больше буквы, но не до соседней: на семи буквах они близко.
    const reach = button * 0.6;
    const i = centers.findIndex((c) => (c.x - x) ** 2 + (c.y - y) ** 2 <= reach * reach);
    return i >= 0 ? i : null;
  };

  const release = () => {
    const word = wordOf(letters, pathRef.current);
    setPath([]);
    setFinger(null);
    submit(word);
  };

  const current = wordOf(letters, path);
  const sparks = purse?.wallet.sparks ?? 0;
  const left = level.words.length - play.found.length;
  const canHint = sparks >= HINT_PRICES.letter && !pay.isPending && !won;

  if (index === null) return <View style={styles.container} />;

  return (
    <View style={[styles.container, styles.play]}>
      <View style={styles.statusRow}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          hitSlop={12}
          style={({ pressed }) => pressed && styles.dimmed}
        >
          <Feather name="arrow-left" size={20} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.status}>{`Уровень ${index + 1}`}</Text>
        {/* Счётчик бонусных — только там, где их есть что искать: «0/0» читается как поломка. */}
        {level.bonus.length > 0 && (
          <View style={styles.counter} accessibilityLabel={`Бонусных слов на уровне: ${play.bonus.length}`}>
            <Feather name="star" size={12} color={colors.accent} />
            <Text style={styles.counterText}>{`${play.bonus.length}/${level.bonus.length}`}</Text>
          </View>
        )}
      </View>

      {/* Сетка забирает всё, что осталось между строкой сверху и колесом. */}
      <View style={styles.gridSpace} onLayout={onSpace}>
        {cell > 0 && (
          <View style={{ width: cell * level.cols, height: cell * level.rows }} accessibilityLabel="Кроссворд">
            {[...map.entries()].map(([key, letter]) => {
              const [row, col] = key.split(":").map(Number);
              const open = seen.has(key);
              const mine = foundCells.has(key);
              return (
                <View
                  key={key}
                  style={[
                    styles.tile,
                    { left: col * cell + 1.5, top: row * cell + 1.5, width: cell - 3, height: cell - 3 },
                    mine ? styles.tileFound : open ? styles.tileHinted : null,
                  ]}
                >
                  {open && (
                    <Text style={[styles.tileLetter, { fontSize: cell * 0.52 }, mine && styles.tileLetterFound]}>
                      {letter}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Строка между сеткой и колесом: то, что сейчас набирается, или что вышло из прошлого. */}
      <View style={styles.previewRow}>
        {current.length > 0 ? (
          <Text style={styles.preview}>{current}</Text>
        ) : flash ? (
          <Text
            style={[
              styles.flash,
              flash.tone === "good" && styles.flashGood,
              flash.tone === "bonus" && styles.flashBonus,
            ]}
          >
            {flash.text}
          </Text>
        ) : (
          <Text style={styles.flash}>
            {won ? "" : `Осталось ${left} ${plural(left, ["слово", "слова", "слов"])}`}
          </Text>
        )}
      </View>

      {won ? (
        <View style={styles.wonCard}>
          <Feather name="check-circle" size={22} color={colors.accentGreen} />
          <Text style={styles.wonTitle}>{`Уровень ${index + 1} пройден`}</Text>
          <Text style={styles.wonText}>
            {`+${SPARKS.wheelLevel} ${plural(SPARKS.wheelLevel, ["искра", "искры", "искр"])}${
              play.bonus.length > 0
                ? ` · бонусных слов ${play.bonus.length} из ${level.bonus.length}`
                : level.bonus.length > 0
                  ? ` · бонусных здесь было ${level.bonus.length}`
                  : ""
            }`}
          </Text>
          {index + 1 >= WHEEL_LEVELS.length && (
            <Text style={styles.wonText}>Это был последний уровень — дальше они пойдут по второму кругу.</Text>
          )}
          <Pressable
            onPress={nextLevel}
            accessibilityRole="button"
            accessibilityLabel="Следующий уровень"
            style={({ pressed }) => [styles.primary, pressed && styles.dimmed]}
          >
            <Text style={styles.primaryText}>Дальше</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.wheelSpace} onLayout={onWheelSpace}>
            <View
              ref={wheelRef}
              onLayout={measure}
              style={[styles.wheel, { width: wheelSide, height: wheelSide, borderRadius: wheelSide / 2 }]}
              accessibilityLabel={`Колесо: ${[...letters].join(" ")}`}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              onResponderGrant={(e) => {
                measure();
                const i = letterAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
                setPath(i === null ? [] : [i]);
              }}
              onResponderMove={(e) => {
                const { pageX, pageY } = e.nativeEvent;
                setFinger({ x: pageX - origin.current.x, y: pageY - origin.current.y });
                const i = letterAt(pageX, pageY);
                if (i === null) return;
                const next = pathRef.current.length === 0 ? [i] : extendWheelPath(pathRef.current, i);
                if (next !== pathRef.current) setPath(next);
              }}
              onResponderRelease={release}
              onResponderTerminate={release}
            >
              {wheelSide > 0 && path.length > 0 && (
                <Svg width={wheelSide} height={wheelSide} style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Polyline
                    points={[...path.map((i) => centers[i]), ...(finger ? [finger] : [])]
                      .map((p) => `${p.x},${p.y}`)
                      .join(" ")}
                    stroke={colors.accent}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    opacity={0.7}
                  />
                </Svg>
              )}
              {wheelSide > 0 &&
                centers.map((c, i) => {
                  const on = path.includes(i);
                  return (
                    <View
                      key={i}
                      pointerEvents="none"
                      style={[
                        styles.letterButton,
                        {
                          left: c.x - button / 2,
                          top: c.y - button / 2,
                          width: button,
                          height: button,
                          borderRadius: button / 2,
                        },
                        on && styles.letterButtonOn,
                      ]}
                    >
                      <Text style={[styles.wheelLetter, { fontSize: button * 0.46 }, on && styles.wheelLetterOn]}>
                        {letters[i]}
                      </Text>
                    </View>
                  );
                })}
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                setPath([]);
                setLetters((l) => shuffled(l, Math.random));
              }}
              accessibilityRole="button"
              accessibilityLabel="Перемешать буквы"
              style={({ pressed }) => [styles.roundButton, pressed && styles.dimmed]}
            >
              <Feather name="shuffle" size={18} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={hint}
              disabled={!canHint}
              accessibilityRole="button"
              accessibilityLabel={`Подсказка: буква за ${HINT_PRICES.letter}`}
              style={({ pressed }) => [styles.hintButton, !canHint && styles.hintButtonOff, pressed && styles.dimmed]}
            >
              <Text style={[styles.hintButtonText, !canHint && styles.muted]}>Буква</Text>
              <Feather name="zap" size={11} color={canHint ? colors.accent : colors.textMuted} />
              <Text style={[styles.hintPrice, !canHint && styles.muted]}>{HINT_PRICES.letter}</Text>
            </Pressable>
            <View style={styles.purse}>
              <Feather name="zap" size={13} color={colors.accent} />
              <Text style={styles.purseText}>{sparks}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  play: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  dimmed: { opacity: 0.6 },
  muted: { color: colors.textMuted },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 32 },
  status: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
  counter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  counterText: { color: colors.text, fontSize: 12, fontVariant: ["tabular-nums"] },

  gridSpace: { flex: 1, alignItems: "center", justifyContent: "center", marginTop: 8 },
  tile: {
    position: "absolute",
    borderRadius: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  tileFound: { backgroundColor: "rgba(143,184,154,0.22)", borderColor: "rgba(143,184,154,0.45)" },
  tileHinted: { borderColor: colors.accent },
  tileLetter: { color: colors.text, fontWeight: "700" },
  tileLetterFound: { color: colors.text },

  previewRow: { height: 40, alignItems: "center", justifyContent: "center" },
  preview: { color: colors.text, fontSize: 24, fontWeight: "700", letterSpacing: 2 },
  flash: { color: colors.textMuted, fontSize: 13 },
  flashGood: { color: colors.accentGreen, fontSize: 15, fontWeight: "700", letterSpacing: 1 },
  flashBonus: { color: colors.accent, fontSize: 14, fontWeight: "600" },

  wheelSpace: { height: 290, alignItems: "center", justifyContent: "center" },
  wheel: { backgroundColor: colors.card },
  letterButton: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  letterButtonOn: { backgroundColor: colors.accent },
  wheelLetter: { color: colors.text, fontWeight: "700" },
  wheelLetterOn: { color: colors.bg },

  actions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  hintButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingHorizontal: 16,
    height: 44,
  },
  hintButtonOff: { opacity: 0.55 },
  hintButtonText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  hintPrice: { color: colors.text, fontSize: 12, fontVariant: ["tabular-nums"] },
  purse: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4 },
  purseText: { color: colors.text, fontSize: 13, fontVariant: ["tabular-nums"] },

  wonCard: {
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 20,
    marginTop: 8,
  },
  wonTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  wonText: { color: colors.textMuted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  primary: {
    marginTop: 8,
    alignSelf: "stretch",
    backgroundColor: colors.accentGreen,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryText: { color: colors.bg, fontSize: 15, fontWeight: "700" },
});
