import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, type LayoutChangeEvent } from "react-native";
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
  allFound,
  findMatch,
  lineBetween,
  makePuzzle,
  sameCell,
  type Cell,
  type Difficulty,
  type Puzzle,
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
   * Концы выделения живут в ссылках, а состояние — только для отрисовки.
   *
   * События движения приходят пачкой и быстрее, чем React успевает перерисовать: несколько
   * первых видели `from` ещё пустым — тем, каким он был до нажатия, — и молча ничего не
   * делали. Палец при этом уже ехал по буквам. Выглядело как «провёл слово, а оно не
   * засчиталось», и каждый раз не то же самое, потому что зависело от того, успел ли кадр.
   */
  const fromRef = useRef<Cell | null>(null);
  const toRef = useRef<Cell | null>(null);
  const [from, setFrom] = useState<Cell | null>(null);
  const [to, setTo] = useState<Cell | null>(null);
  const setEnds = (a: Cell | null, b: Cell | null) => {
    fromRef.current = a;
    toRef.current = b;
    setFrom(a);
    setTo(b);
  };
  const [seconds, setSeconds] = useState(0);
  const [won, setWon] = useState<{ record: boolean } | null>(null);

  // Секундомер идёт, пока поле не собрано. Без времени он просто не заводится — на экране
  // тогда нет ни часов, ни причины торопиться.
  useEffect(() => {
    if (!playing || !timed || won) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [playing, timed, won]);

  const start = () => {
    setSeed(Math.floor(Math.random() * 2 ** 31));
    setFound([]);
    setSeconds(0);
    setWon(null);
    setEnds(null, null);
    setPlaying(true);
  };

  const selection = from && to ? lineBetween(from, to) : null;
  const selected = new Set((selection ?? []).map((c) => `${c.row}:${c.col}`));
  const foundWords = found.map((f) => f.word);
  const foundCells = new Set(found.flatMap((f) => f.cells.map((c) => `${c.row}:${c.col}`)));

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
    const line =
      fromRef.current && toRef.current ? lineBetween(fromRef.current, toRef.current) : null;
    setEnds(null, null);
    if (!line) return;
    const hit = findMatch(puzzle, line);
    if (!hit) return;
    setFound((prev) => (prev.some((f) => f.word === hit) ? prev : [...prev, { word: hit, cells: line }]));
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
          В поле спрятаны слова по выбранной теме. Веди пальцем от первой буквы к последней —
          по строке, столбцу или диагонали. В любую сторону: справа налево тоже считается.
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
        <Text style={styles.status}>
          {won
            ? "Поле собрано"
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
          setEnds(cell, cell);
        }}
        onResponderMove={(e) => {
          const cell = cellAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
          const start = fromRef.current;
          // Держим прошлое положение, пока палец за краем или на кривой: иначе выделение
          // мигает и рвётся на каждом дрожании руки.
          if (!cell || !start) return;
          if (toRef.current && sameCell(cell, toRef.current)) return;
          if (!lineBetween(start, cell)) return;
          setEnds(start, cell);
        }}
        onResponderRelease={release}
        onResponderTerminate={release}
      >
        {puzzle.grid.map((row, r) => (
          <View key={r} style={styles.boardRow}>
            {row.map((letter, c) => {
              const key = `${r}:${c}`;
              const isFound = foundCells.has(key);
              const isSelected = selected.has(key);
              return (
                <View
                  key={key}
                  style={[
                    styles.cell,
                    { width: cellSize, height: cellSize },
                    isFound && styles.cellFound,
                    isSelected && styles.cellSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.letter,
                      cellSize > 0 && { fontSize: Math.min(20, cellSize * 0.5) },
                      (isFound || isSelected) && styles.letterOn,
                    ]}
                  >
                    {letter}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.wordList}>
        {puzzle.words.map((p) => {
          const done = foundWords.includes(p.word);
          return (
            <Text key={p.word} style={[styles.word, done && styles.wordDone]}>
              {p.word}
            </Text>
          );
        })}
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
  cellFound: { backgroundColor: "rgba(143,184,154,0.28)" },
  cellSelected: { backgroundColor: colors.accent },
  letter: { color: colors.text, fontWeight: "600" },
  letterOn: { color: colors.bg },

  wordList: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  word: { color: colors.text, fontSize: 13 },
  wordDone: { color: colors.textMuted, textDecorationLine: "line-through" },

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
