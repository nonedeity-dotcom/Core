import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StatusBar, StyleSheet, type LayoutChangeEvent } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { todayKey } from "../../lib/date";
import { WORD_THEMES, themeOpen, type WordTheme } from "../../content/wordThemes";
import {
  CROSSINGS,
  DIFFICULTY_HINTS,
  DIFFICULTY_LABELS,
  allFound,
  extendPath,
  findMatch,
  makePuzzle,
  type Cell,
  type Difficulty,
} from "../../lib/games/wordsearch";
import { emptyWordSearch, formatSeconds, recordKey, withSolved, type GameStats } from "../../lib/games/stats";
import { spend, type Purse } from "../../lib/rewards/currency";
import { HINT_PRICES, paletteColors } from "../../lib/rewards/catalog";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

/**
 * «Найди слова»: поле из букв, в котором спрятаны слова по теме.
 *
 * Поле собирается на месте и каждый раз новое — уровни здесь не кончаются и не заготовлены.
 * Секундомер по выбору: он показывает, за сколько справился, и хранит рекорд, но ничего не
 * отнимает и ничем не грозит. Игра на перерыв не должна ставить условий.
 *
 * Палец ведётся по буквам, клетка за клеткой. По двум концам обойтись не выйдет: слово
 * умеет поворачивать и складываться в «П» или зигзаг, а у такой фигуры концы ничего не
 * говорят о середине. Диагоналей нет ни у слов, ни у пути — только по сторонам клеток.
 */
export default function WordSearchScreen({
  navigation,
}: {
  navigation: { goBack: () => void; setOptions: (options: { headerShown: boolean }) => void };
}) {
  const qc = useQueryClient();
  const [theme, setTheme] = useState<WordTheme>(WORD_THEMES[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [timed, setTimed] = useState(true);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [playing, setPlaying] = useState(false);

  const { data: stats } = useQuery<GameStats>({ queryKey: ["gameStats"], queryFn: () => api.getGameStats() });
  /*
   * Кошелёк читается здесь же, а не через useRewards.
   *
   * Тот пересчитывает начисления по всей истории — четыреста дней привычек, сессий и целей.
   * Игре нужно ровно два числа и возможность списать, и тащить ради них весь пересчёт в
   * экран, который и так считает поле, незачем.
   */
  const { data: purse } = useQuery<Purse>({ queryKey: ["purse"], queryFn: () => api.getPurse() });
  const pay = useMutation({
    mutationFn: (next: Purse) => api.setPurse(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purse"] }),
  });
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
  /**
   * Открытые подсказкой буквы и то, что подсказка вообще была.
   *
   * Второе живёт отдельно от первого, потому что «открыть слово» букв не открывает, а
   * рекорд отменяет так же. Забыть про это значило бы продавать лучшее время за искры.
   */
  const [hints, setHints] = useState<Cell[]>([]);
  const [hinted, setHinted] = useState(false);

  // Секундомер идёт, пока поле не собрано. Без времени он просто не заводится — на экране
  // тогда нет ни часов, ни причины торопиться.
  useEffect(() => {
    if (!playing || !timed || won) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [playing, timed, won]);

  /*
   * Во время партии шапка навигации убирается.
   *
   * Поле — квадрат, и всё, что забирает высоту, забирает его сторону: шапка в полсотни
   * точек на телефоне превращается в заметно более мелкие буквы. Своя строка сверху уже, и
   * стрелка «назад» в ней та же самая.
   */
  useEffect(() => {
    navigation.setOptions({ headerShown: !playing });
    return () => navigation.setOptions({ headerShown: true });
  }, [navigation, playing]);

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
    setHints([]);
    setHinted(false);
    setPlaying(true);
  };

  // Набор цветов — тот, что надет в «Наградах». Снятый или неизвестный даёт обычный.
  const palette = paletteColors(purse?.equipped.palette ?? "");

  const foundWords = found.map((f) => f.word);
  /*
   * Клетки, через которые палец не пройдёт.
   *
   * Только там, где слова не делят буквы. На сложном делят, и закрывать найденное нельзя:
   * через его букву проходит ещё не найденное слово, и запрет сделал бы его недостижимым.
   */
  const closed = CROSSINGS[difficulty]
    ? null
    : new Set(found.flatMap((f) => f.cells.map((c) => `${c.row}:${c.col}`)));
  const isClosed = (c: Cell) => closed !== null && closed.has(`${c.row}:${c.col}`);

  // Ширина поля меряется по факту: клетка — это ширина, делённая на размер, и считать её из
  // ширины экрана значило бы гадать про отступы.
  const [board, setBoard] = useState(0);
  const cellSize = board > 0 ? board / puzzle.size : 0;

  /**
   * Сторона поля — меньшая из сторон свободного места.
   *
   * Поле квадратное, и раньше оно считалось по ширине: на высоком экране под ним оставалась
   * пустая треть, а на низком не помещались кнопки. Теперь берётся то, что меньше, и поле
   * занимает всё, что ему оставили, не больше и не меньше.
   */
  const onSpaceLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const side = Math.floor(Math.min(width, height));
    if (side > 0 && side !== board) setBoard(side);
    measure();
  };

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
    const base = stats ?? { wordsearch: emptyWordSearch() };
    // Подсказка снимает время с зачёта, но не само поле: собранное собрано.
    const result = withSolved(base, theme.id, difficulty, timed && !hinted ? seconds : null, todayKey());
    setWon({ record: result.record });
    save.mutate(result.stats);
  };

  /**
   * Подсказки за искры.
   *
   * Слова, которые ещё не нашли, известны экрану с самого начала — поле собиралось здесь
   * же. Поэтому подсказка не «вычисляется», а выбирается: её вся работа — списать искры и
   * показать то, что и так лежит в памяти.
   *
   * Списание идёт первым и через `spend`: он возвращает `null`, когда не хватает, и
   * показать букву, не заплатив за неё, отсюда невозможно.
   */
  const unfound = puzzle.words.filter((w) => !foundWords.includes(w.word));
  const sparks = purse?.wallet.sparks ?? 0;

  const hintLetter = () => {
    if (!purse || unfound.length === 0) return;
    const shown = new Set(hints.map((c) => `${c.row}:${c.col}`));
    const target = unfound[Math.floor(Math.random() * unfound.length)];
    const rest = target.cells.filter((c) => !shown.has(`${c.row}:${c.col}`));
    if (rest.length === 0) return;
    const next = spend(purse, { sparks: HINT_PRICES.letter });
    if (!next) return;
    pay.mutate(next);
    setHints((prev) => [...prev, rest[Math.floor(Math.random() * rest.length)]]);
    setHinted(true);
  };

  const hintWord = () => {
    if (!purse || unfound.length === 0) return;
    const next = spend(purse, { sparks: HINT_PRICES.word });
    if (!next) return;
    pay.mutate(next);
    const target = unfound[Math.floor(Math.random() * unfound.length)];
    setFound((prev) => (prev.some((f) => f.word === target.word) ? prev : [...prev, target]));
    setJust(target.word);
    setHinted(true);
  };

  const isHinted = (c: Cell) => hints.some((h) => h.row === c.row && h.col === c.col);

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
          {WORD_THEMES.map((t) => {
            const open = themeOpen(t, purse?.owned ?? []);
            return (
              <Chip key={t.id} on={t.id === theme.id} locked={!open} onPress={() => open && setTheme(t)}>
                {t.title}
              </Chip>
            );
          })}
        </View>
        <Text style={styles.hint}>{theme.hint}</Text>
        {WORD_THEMES.some((t) => !themeOpen(t, purse?.owned ?? [])) && (
          <Text style={styles.hint}>Темы с замком открываются за ядра — в разделе «Награды».</Text>
        )}

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
    <View style={[styles.container, styles.play]}>
      {/* Своя строка вместо шапки: стрелка та же, а высоты забирает вдвое меньше. */}
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
        <Text style={[styles.status, just && styles.statusFound]}>
          {won
            ? "Поле собрано"
            : just
              ? just
              : `Осталось ${left} ${plural(left, ["слово", "слова", "слов"])}`}
        </Text>
        {timed && <Text style={styles.clock}>{formatSeconds(seconds)}</Text>}
      </View>

      {/* Всё, что осталось между строкой сверху и кнопками снизу, отдаётся полю. */}
      <View style={styles.space} onLayout={onSpaceLayout}>
      <View
        style={[styles.board, { width: board, height: board }]}
        accessibilityLabel="Поле"
        /* Меряется тогда, когда поле уже получило свой размер и место. Раньше замер шёл из
           раскладки внешнего блока — то есть до того, как поле внутри него встало, — и
           палец попадал не в те клетки: путь строился, а слова не находились. */
        onLayout={measure}
        onStartShouldSetResponder={() => !won}
        onMoveShouldSetResponder={() => !won}
        /* Поле не отдаёт жест никому.
           Осталось с тех пор, когда под полем был прокручиваемый список: палец шёл вниз по
           столбцу, список ехал, прокрутка забирала жест себе — а поле получало «прервано» и
           честно засчитывало те две буквы, которые успело. Списка больше нет, но строка
           остаётся: отдавать жест посреди слова не за чем и некому. */
        onResponderTerminationRequest={() => false}
        ref={boardRef}
        onResponderGrant={(e) => {
          const cell = cellAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
          setPath(cell ? extendPath([], cell, isClosed) : []);
        }}
        onResponderMove={(e) => {
          const cell = cellAt(e.nativeEvent.pageX, e.nativeEvent.pageY);
          // Палец за краем поля — путь просто замирает и ждёт, а не рвётся.
          if (!cell) return;
          const next = extendPath(pathRef.current, cell, isClosed);
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
                stroke={palette[i % palette.length]}
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
              <View
                key={`${r}:${c}`}
                style={[
                  styles.cell,
                  { width: cellSize, height: cellSize },
                  isHinted({ row: r, col: c }) && styles.cellHint,
                ]}
              >
                <Text style={[styles.letter, cellSize > 0 && { fontSize: Math.min(30, cellSize * 0.5) }]}>
                  {letter}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      </View>

      {won && (
        <View style={styles.wonCard}>
          <Feather name="check-circle" size={18} color={colors.accentGreen} />
          <Text style={styles.wonText}>
            {!timed
              ? "Все слова найдены."
              : hinted
                ? `За ${formatSeconds(seconds)} — но с подсказкой, и в рекорд это не пошло.`
                : won.record
                  ? `Новый рекорд — ${formatSeconds(seconds)}!`
                  : `За ${formatSeconds(seconds)}${best !== undefined ? `, рекорд ${formatSeconds(best)}` : ""}`}
          </Text>
        </View>
      )}

      {/* Подсказки только пока поле не собрано: платить за букву в собранном поле не за что. */}
      {!won && (
        <View style={styles.hintRow}>
          <HintButton
            label="Буква"
            price={HINT_PRICES.letter}
            enough={sparks >= HINT_PRICES.letter}
            onPress={hintLetter}
          />
          <HintButton
            label="Слово"
            price={HINT_PRICES.word}
            enough={sparks >= HINT_PRICES.word}
            onPress={hintWord}
          />
          <View style={styles.purse}>
            <Feather name="zap" size={13} color={colors.accent} />
            <Text style={styles.purseText}>{sparks}</Text>
          </View>
        </View>
      )}
      {hinted && !won && <Text style={styles.hintNote}>С подсказкой время в рекорд не пойдёт.</Text>}

      <View style={styles.actions}>
        <Pressable
          onPress={start}
          accessibilityRole="button"
          accessibilityLabel="Новое поле"
          style={({ pressed }) => [styles.primary, styles.primaryFlat, styles.flex, pressed && styles.dimmed]}
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
    </View>
  );
}

/** Кнопка подсказки: что даёт и сколько стоит — обе надписи на ней, а не в другом месте. */
function HintButton({
  label,
  price,
  enough,
  onPress,
}: {
  label: string;
  price: number;
  enough: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enough}
      accessibilityRole="button"
      accessibilityLabel={`Подсказка: ${label.toLowerCase()} за ${price}`}
      style={({ pressed }) => [styles.hintButton, !enough && styles.hintButtonOff, pressed && styles.dimmed]}
    >
      <Text style={[styles.hintButtonText, !enough && styles.hintButtonTextOff]}>{label}</Text>
      <Feather name="zap" size={11} color={enough ? colors.accent : colors.textMuted} />
      <Text style={[styles.hintPrice, !enough && styles.hintButtonTextOff]}>{price}</Text>
    </Pressable>
  );
}

function Chip({
  on,
  onPress,
  children,
  locked = false,
}: {
  on: boolean;
  onPress: () => void;
  children: string;
  /** Запертая тема видна и не выбирается: скрыть её — значит не сказать, что она есть. */
  locked?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled: locked }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, locked && styles.chipOff, pressed && styles.dimmed]}
    >
      {locked && <Feather name="lock" size={10} color={colors.textMuted} />}
      <Text style={[styles.chipText, on && styles.chipTextOn, locked && styles.chipTextOff]}>{children}</Text>
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
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipOff: { backgroundColor: colors.bg, borderStyle: "dashed" },
  chipText: { color: colors.textMuted, fontSize: 13 },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },
  chipTextOff: { opacity: 0.6 },

  /*
   * Отступ сверху — под строку состояния Android.
   *
   * Шапки навигации на время игры нет, а значит, нет и того, кто отодвигал содержимое от
   * часов и значка батареи. `StatusBar.currentHeight` берётся напрямую: провайдера
   * безопасных зон в приложении нет, а на Android это ровно то же число.
   */
  play: { paddingTop: (StatusBar.currentHeight ?? 0) + 8, paddingHorizontal: 12, paddingBottom: 12 },
  space: { flex: 1, alignItems: "center", justifyContent: "center", marginVertical: 10 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  status: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1 },
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
  // Рамка, а не заливка: заливка спорила бы с полосами найденных слов за ту же клетку.
  cellHint: { borderWidth: 2, borderColor: colors.accent, borderRadius: 8 },
  letter: { color: colors.text, fontWeight: "600" },

  wonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(143,184,154,0.14)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  wonText: { color: colors.text, fontSize: 13, flex: 1 },

  hintRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  hintButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  hintButtonOff: { opacity: 0.5 },
  hintButtonText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  hintButtonTextOff: { color: colors.textMuted },
  hintPrice: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  purse: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" },
  purseText: { color: colors.textMuted, fontSize: 12 },
  hintNote: { color: colors.textMuted, fontSize: 11, marginBottom: 8 },

  actions: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  primary: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 18 },
  primaryFlat: { marginTop: 0 },
  primaryText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  secondary: {
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  secondaryText: { color: colors.textMuted, fontSize: 14 },
  dimmed: { opacity: 0.6 },
});
