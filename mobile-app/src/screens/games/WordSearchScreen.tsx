import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, type LayoutChangeEvent } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { todayKey } from "../../lib/date";
import { WORD_THEMES, type WordTheme } from "../../content/wordThemes";
import {
  DIFFICULTY_HINTS,
  DIFFICULTY_LABELS,
  WORD_COLORS,
  allFound,
  extendPath,
  findMatch,
  makePuzzle,
  type Cell,
  type Difficulty,
} from "../../lib/games/wordsearch";
import { formatSeconds, recordKey, withSolved, type GameStats } from "../../lib/games/stats";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

/**
 * «Найди слова»: поле из букв, в котором спрятаны слова по теме.
 *
 * Поле собирается на месте и каждый раз новое — уровни здесь не кончаются и не заготовлены.
 * Секундомер по выбору: он показывает, за сколько справился, и хранит рекорд, но ничего не
 * отнимает и ничем не грозит. Игра на перерыв не должна ставить условий.
 *
 * Палец ведётся по прямой, и этого достаточно: слово всегда лежит по строке, столбцу или
 * диагонали, поэтому важно только, с какой клетки начал и над какой сейчас. Возить пальцем
 * ровно по буквам не нужно — это и точнее, и спокойнее.
 */
export default function WordSearchScreen() {
  const qc = useQueryClient();
  const [theme, setTheme] = useState<WordTheme>(WORD_THEMES[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [timed, setTimed] = useState(true);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [playing, setPlaying] = useState(false);

  const { data: stats } = useQuery<GameStats>({ queryKey: ["gameStats"], queryFn: () => api.getGameStats() });
  const save = useMutation({
    mutationFn: (next: GameStats) => api.setGameStats(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gameStats"] }),
  });

  const puzzle = useMemo(() => makePuzzle(theme.words, difficulty, seedRnd(seed)), [theme, difficulty, seed]);
  // Клетки хранятся рядом со словом: подсвечивается то, что человек провёл, а не то, куда
  // слово положили, — а это, как выяснилось, не всегда одно и то же.
  const [found, setFound] = useState<{ word: string; cells: Cell[] }[]>([]);
  /**
   * Путь пальца живёт в ссылке, а состояние — только для отрисовки.
   *
   * События движения приходят пачкой и быстрее, чем React успевает перерисовать: несколько
   * первых видели путь ещё пустым — таким, каким он был до нажатия, — и молча ничего не
   * делали. Палец при этом уже ехал по буквам. Выглядело как «провёл слово, а оно не
   * засчиталось», и каждый раз не то же самое, потому что зависело от того, успел ли кадр.
   */
  const pathRef = useRef<Cell[]>([]);
  const [path, setPathState] = useState<Cell[]>([]);
  const setPath = (next: Cell[]) => {
    pathRef.current = next;
    setPathState(next);
  };
  const [seconds, setSeconds] = useState(0);
  /**
   * Последнее найденное слово, на пару секунд.
   *
   * Список под полем убран, и без него нечем сказать, что именно засчиталось: полоса
   * появилась, а какое слово — догадывайся. Одна строка вместо списка из десяти.
   */
  const [just, setJust] = useState<string | null>(null);
  const [won, setWon] = useState<{ record: boolean } | null>(null);

  // Секундомер идёт, пока поле не собрано. Без времени он просто не заводится — на экране
  // тогда нет ни часов, ни причины торопиться.
  useEffect(() => {
    if (!playing || !timed || won) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [playing, timed, won]);

  useEffect(() => {
    if (!just) return;
    const id = setTimeout(() => setJust(null), 2200);
    return () => clearTimeout(id);
  }, [just]);

  const start = () => {
    setSeed(Math.floor(Math.random() * 2 ** 31));
    setFound([]);
    setSeconds(0);
    setWon(null);
    setJust(null);
    setPath([]);
    setPlaying(true);
  };

  const foundWords = found.map((f) => f.word);

  // Ширина поля меряется по факту: клетка — это ширина, делённая на размер, и считать её из
  // ширины экрана значило бы гадать про отступы.
  const [board, setBoard] = useState(0);
  const cellSize = board > 0 ? board / puzzle.size : 0;

  /**
   * Где поле лежит на экране — в координатах окна.
   *
   * Считать клетку из `locationX` нельзя, и это выяснилось на проверке: как только палец
   * оказывается над буквой, событие приходит от неё, и координата меряется от её угла, а не
   * от угла поля. Выделение при этом не ломается заметно — оно просто иногда попадает не в ту
   * клетку, и слово «не находится» без всякого объяснения.
   *
   * Поэтому берётся pageX/pageY и вычитается положение поля. Оно меряется при раскладке и
   * заново при прокрутке: экран прокручивается, и вчерашнее положение дало бы тот же сдвиг.
   */
  const boardRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const measure = () => boardRef.current?.measureInWindow((x, y) => {
    origin.current = { x, y };
  });
  const onBoardLayout = (e: LayoutChangeEvent) => {
    setBoard(e.nativeEvent.layout.width);
    measure();
  };

  const cellAt = (pageX: number, pageY: number): Cell | null => {
    if (cellSize <= 0) return null;
    const col = Math.floor((pageX - origin.current.x) / cellSize);
    const row = Math.floor((pageY - origin.current.y) / cellSize);
    return row >= 0 && col >= 0 && row < puzzle.size && col < puzzle.size ? { row, col } : null;
  };

  /**
   * Палец отпущен.
   *
   * Список найденного обновляется функцией от прежнего, а не от того, что было видно на
   * отрисовке. Разница не теоретическая: два слова, найденные подряд быстрее, чем экран
   * успевает перерисоваться, считали от одного и того же прежнего списка — и второе
   * затирало первое. На проверке это выглядело как «провёл все шесть слов, осталось одно»,
   * причём каждый раз разное.
   */
  const release = () => {
    const line = pathRef.current;
    setPath([]);
    if (line.length < 2) return;
    const hit = findMatch(puzzle, line);
    if (!hit) return;
    setFound((prev) => (prev.some((f) => f.word === hit) ? prev : [...prev, { word: hit, cells: line }]));
    setJust(hit);
  };

  // Конец поля проверяется отдельно, а не внутри обновления списка: внутри пришлось бы
  // писать в хранилище прямо из него, а это то самое место, которое React может вызвать
  // дважды.
  useEffect(() => {
    if (!playing || won) return;
    if (allFound(puzzle, found.map((f) => f.word))) finish();
  }, [found, playing, won, puzzle]);

  const finish = () => {
    const base = stats ?? { wordsearch: { solved: 0, best: {}, lastAt: "" } };
    const result = withSolved(base, theme.id, difficulty, timed ? seconds : null, todayKey());
    setWon({ record: result.record });
    save.mutate(result.stats);
  };

  const best = stats?.wordsearch.best[recordKey(theme.id, difficulty)];
  const left = puzzle.words.length - found.length;

  if (!playing) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          В поле спрятаны слова по выбранной теме — какие именно, не сказано, тема и есть
          подсказка. Веди пальцем по буквам: слово может идти прямо, а может повернуть по
          дороге. В любую сторону — справа налево и снизу вверх тоже считается.
        </Text>

        <Text style={styles.label}>Тема</Text>
        <View style={styles.chipRow}>
          {WORD_THEMES.map((t) => (
            <Chip key={t.id} on={t.id === theme.id} onPress={() => setTheme(t)}>
              {t.title}
            </Chip>
          ))}
        </View>
        <Text style={styles.hint}>{theme.hint}</Text>

        <Text style={[styles.label, styles.spaced]}>Сложность</Text>
        <View style={styles.chipRow}>
          {DIFFICULTIES.map((d) => (
            <Chip key={d} on={d === difficulty} onPress={() => setDifficulty(d)}>
              {DIFFICULTY_LABELS[d]}
            </Chip>
          ))}
        </View>
        <Text style={styles.hint}>{DIFFICULTY_HINTS[difficulty]}</Text>

        <Text style={[styles.label, styles.spaced]}>Время</Text>
        <View style={styles.chipRow}>
          <Chip on={timed} onPress={() => setTimed(true)}>
            С секундомером
          </Chip>
          <Chip on={!timed} onPress={() => setTimed(false)}>
            Без времени
          </Chip>
        </View>
        <Text style={styles.hint}>
          {timed
            ? "Часы идут и запоминают лучшее время. Ничего не сгорает — это счёт, а не срок."
            : "Никаких часов. Сидишь сколько хочешь."}
        </Text>

        {best !== undefined && (
          <Text style={styles.record}>
            {`Лучшее время: ${formatSeconds(best)} — ${theme.title.toLowerCase()}, ${DIFFICULTY_LABELS[
              difficulty
            ].toLowerCase()}`}
          </Text>
        )}
        {stats && stats.wordsearch.solved > 0 && (
          <Text style={styles.record}>
            {`Собрано ${stats.wordsearch.solved} ${plural(stats.wordsearch.solved, ["поле", "поля", "полей"])}`}
          </Text>
        )}

        <Pressable
          onPress={start}
          accessibilityRole="button"
          accessibilityLabel="Начать игру"
          style={({ pressed }) => [styles.primary, pressed && styles.dimmed]}
        >
          <Text style={styles.primaryText}>Начать</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      onScroll={measure}
      scrollEventThrottle={16}
    >
      <View style={styles.statusRow}>
        <Text style={[styles.status, just && styles.statusFound]}>
          {won
            ? "Поле собрано"
            : just
              ? just
              : `Осталось ${left} ${plural(left, ["слово", "слова", "слов"])}`}
        </Text>
        {timed && <Text style={styles.clock}>{formatSeconds(seconds)}</Text>}
      </View>

      <View
        style={styles.board}
        accessibilityLabel="Поле"
        onLayout={onBoardLayout}
        onStartShouldSetResponder={() => !won}
        onMoveShouldSetResponder={() => !won}
        /* Поле не отдаёт жест прокрутке.
           Без этого выделение обрывалось на второй клетке: палец идёт вниз по столбцу, список
           под полем прокручивается, и ScrollView забирает жест себе — а поле получает
           «прервано» и честно засчитывает те две буквы, которые успело. Выглядело как «слово
           не находится», причём через раз. */
        onResponderTerminationRequest={() => false}
        ref={boardRef}
        onResponderGrant={(e) => {
          const cell = cellAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
          setPath(cell ? [cell] : []);
        }}
        onResponderMove={(e) => {
          const cell = cellAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
          // Палец за краем поля — путь просто замирает и ждёт, а не рвётся.
          if (!cell) return;
          const next = extendPath(pathRef.current, cell);
          if (next !== pathRef.current) setPath(next);
        }}
        onResponderRelease={release}
        onResponderTerminate={release}
      >
        {/* Полосы рисуются под буквами: каждое найденное слово — своя, своего цвета, и
            повороты видно вместе с ней. Заливка клеток, которая была раньше, сливала два
            соседних слова в одно пятно. */}
        {cellSize > 0 && (
          <Svg width={board} height={board} style={StyleSheet.absoluteFill} pointerEvents="none">
            {found.map((f, i) => (
              <Polyline
                key={f.word}
                points={points(f.cells, cellSize)}
                stroke={WORD_COLORS[i % WORD_COLORS.length]}
                strokeWidth={cellSize * 0.74}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={0.45}
              />
            ))}
            {path.length > 1 && (
              <Polyline
                points={points(path, cellSize)}
                stroke={colors.text}
                strokeWidth={cellSize * 0.74}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={0.22}
              />
            )}
          </Svg>
        )}

        {puzzle.grid.map((row, r) => (
          <View key={r} style={styles.boardRow}>
            {row.map((letter, c) => (
              <View key={`${r}:${c}`} style={[styles.cell, { width: cellSize, height: cellSize }]}>
                <Text style={[styles.letter, cellSize > 0 && { fontSize: Math.min(20, cellSize * 0.5) }]}>
                  {letter}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      {won && (
        <View style={styles.wonCard}>
          <Feather name="check-circle" size={18} color={colors.accentGreen} />
          <Text style={styles.wonText}>
            {timed
              ? won.record
                ? `Новый рекорд — ${formatSeconds(seconds)}!`
                : `За ${formatSeconds(seconds)}${best !== undefined ? `, рекорд ${formatSeconds(best)}` : ""}`
              : "Все слова найдены."}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={start}
          accessibilityRole="button"
          accessibilityLabel="Новое поле"
          style={({ pressed }) => [styles.primary, styles.flex, pressed && styles.dimmed]}
        >
          <Text style={styles.primaryText}>Новое поле</Text>
        </Pressable>
        <Pressable
          onPress={() => setPlaying(false)}
          accessibilityRole="button"
          accessibilityLabel="Настройки игры"
          style={({ pressed }) => [styles.secondary, pressed && styles.dimmed]}
        >
          <Text style={styles.secondaryText}>Сменить</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Chip({ on, onPress, children }: { on: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.dimmed]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{children}</Text>
    </Pressable>
  );
}

/** Центры клеток пути — в том виде, в каком их ждёт Polyline. */
function points(cells: Cell[], cellSize: number): string {
  return cells.map((c) => `${c.col * cellSize + cellSize / 2},${c.row * cellSize + cellSize / 2}`).join(" ");
}

/** Тот же генератор, что и в модуле, — завёрнут здесь, чтобы экран не знал про его внутренности. */
function seedRnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 18 },
  label: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  spaced: { marginTop: 20 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  record: { color: colors.accentGreen, fontSize: 12, marginTop: 14 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipText: { color: colors.textMuted, fontSize: 13 },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },

  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  status: { color: colors.text, fontSize: 14, fontWeight: "600" },
  statusFound: { color: colors.accentGreen },
  clock: { color: colors.textMuted, fontSize: 14, fontVariant: ["tabular-nums"] },

  board: {
    backgroundColor: colors.card,
    borderRadius: 14,
    overflow: "hidden",
    // Ведение пальцем по буквам на вебе выделяет их как текст — синей полосой поверх игры.
    // На телефоне этого нет, но веб-сборкой всё проверяется, и смотреть на это мешает.
    ...({ userSelect: "none" } as object),
  },
  boardRow: { flexDirection: "row" },
  cell: { alignItems: "center", justifyContent: "center" },
  letter: { color: colors.text, fontWeight: "600" },

  wonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(143,184,154,0.14)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 18,
  },
  wonText: { color: colors.text, fontSize: 13, flex: 1 },

  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  flex: { flex: 1 },
  primary: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 18 },
  primaryText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  secondary: {
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  secondaryText: { color: colors.textMuted, fontSize: 14 },
  dimmed: { opacity: 0.6 },
});
