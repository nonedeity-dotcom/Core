import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, Modal, ScrollView, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, DEFAULT_FOCUS_INTERVALS, type FocusIntervals } from "../api/client";
import { colors } from "../theme/colors";
import TipCard from "../components/TipCard";
import { DEFAULT_TIP_PREFS, allTips, rotationNumberFor, type TipPrefs } from "../lib/tipLibrary";
import { todayKey } from "../lib/date";
import { plural } from "../lib/plural";
import { useFold } from "../lib/useFold";
import {
  CYCLE_PHASES,
  FOCUS_PHASES,
  PHASE_CAPTIONS,
  PHASE_LABELS,
  RING_TIMEOUT_MS,
  countsAsSession,
  nextCyclePhase,
  phaseMinutes,
  type CyclePhase,
  type FocusPhase,
} from "../lib/focusPhases";
import { useCountdown } from "../lib/useCountdown";
import {
  cancelChime,
  clearPhaseSound,
  getFocusSounds,
  pickPhaseSound,
  playPhaseChime,
  scheduleChime,
  stopChime,
  type FocusSounds,
} from "../notifications/chime";
import type { RewardOption } from "../types";

const SIZE = 220;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

// The ratios the source material and its usual variants use. Anything else is
// still reachable with the steppers. Boredom is not part of a preset: it is a fixed
// wind-down, not a ratio, and a preset that quietly retuned it would be a surprise.
const PRESETS: { workMin: number; breakMin: number }[] = [
  { workMin: 25, breakMin: 5 },
  { workMin: 50, breakMin: 10 },
  { workMin: 60, breakMin: 20 },
  { workMin: 90, breakMin: 20 },
];

/**
 * The sound tip, pulled from the reference by id. Content lives in library.ts and nowhere
 * else, so the wording here and in the Подсказки screen can never drift apart.
 */
/** Pinned to this screen by id, so an edit to it in the reference shows up here too. */
const SOUND_TIP_ID = "focus-sound";

export default function FocusScreen() {
  const qc = useQueryClient();
  // The main ring only ever shows work or break. Boredom has its own clock further down —
  // it is preparation for a session, not a leg of the loop.
  const [phase, setPhase] = useState<CyclePhase>("work");
  // The lengths are a saved setting now, not constants. Until the stored value
  // arrives the defaults stand in, and the idle timer is re-seeded from it —
  // see the effect below.
  const { data: intervals = DEFAULT_FOCUS_INTERVALS } = useQuery<FocusIntervals>({
    queryKey: ["focusIntervals"],
    queryFn: () => api.getFocusIntervals(),
  });
  const workMin = intervals.workMin;
  const breakMin = intervals.breakMin;

  const [editing, setEditing] = useState(false);
  const [soundTipOpen, setSoundTipOpen] = useState(false);
  // Through the edited reference, not the bundle: a tip rewritten in «Подсказки» should read
  // the same here, and one hidden there should not reappear on this screen.
  const { data: tipPrefs = DEFAULT_TIP_PREFS } = useQuery<TipPrefs>({
    queryKey: ["tipPrefs"],
    queryFn: () => api.getTipPrefs(),
  });
  const soundTip = allTips(tipPrefs).find((t) => t.id === SOUND_TIP_ID) ?? null;
  const soundsFold = useFold();
  const [sounds, setSounds] = useState<FocusSounds>({});
  const [picking, setPicking] = useState<FocusPhase | null>(null);
  const [soundError, setSoundError] = useState<string | null>(null);
  /**
   * Whether the backup notification is actually armed for the phase now running.
   *
   * null while nothing runs. The screen says which of the two mechanisms is behind the
   * current session, because "it will ring with the phone away" and "it will ring only if
   * you are looking at it" are different promises.
   */
  const [alarmArmed, setAlarmArmed] = useState<boolean | null>(null);
  /** The same answer for the boredom clock, which arms its own alarm. */
  const [boredomArmed, setBoredomArmed] = useState<boolean | null>(null);

  useEffect(() => {
    getFocusSounds().then(setSounds);
  }, []);
  const [draft, setDraft] = useState<FocusIntervals>(DEFAULT_FOCUS_INTERVALS);

  const [showReward, setShowReward] = useState(false);
  const [editingRewards, setEditingRewards] = useState(false);
  const [customReward, setCustomReward] = useState("");
  const [newOptionLabel, setNewOptionLabel] = useState("");

  const { data: rewardOptions = [] } = useQuery<RewardOption[]>({
    queryKey: ["rewardOptions"],
    queryFn: () => api.getRewardOptions() as Promise<RewardOption[]>,
  });
  const invalidateOptions = () => qc.invalidateQueries({ queryKey: ["rewardOptions"] });

  const logSession = useMutation({
    mutationFn: (durationMin: number) => api.addSession(todayKey(), durationMin),
    // The report screen reads ["sessions", "week"]; without invalidating, a
    // finished session didn't show up there until the cache happened to expire.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
  const logReward = useMutation({
    mutationFn: (text: string) => api.addReward(todayKey(), text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rewards"] }),
  });
  const addOption = useMutation({
    mutationFn: (label: string) => api.addRewardOption(label),
    onSuccess: () => {
      setNewOptionLabel("");
      invalidateOptions();
    },
  });
  const removeOption = useMutation({
    mutationFn: (id: string) => api.removeRewardOption(id),
    onSuccess: invalidateOptions,
  });

  const saveIntervals = useMutation({
    mutationFn: (next: FocusIntervals) => api.setFocusIntervals(next),
    onSuccess: (applied) => {
      qc.setQueryData(["focusIntervals"], applied);
      setEditing(false);
    },
  });

  // --- the two clocks ---------------------------------------------------------------
  // Each end handler needs the countdown it belongs to (the break arms itself), and the
  // countdown needs the handler — so the handlers go in through refs, assigned below.
  const cycleEndRef = useRef<() => void>(() => {});
  const boredomEndRef = useRef<() => void>(() => {});
  const cycle = useCountdown(phaseMinutes(intervals, phase) * 60, () => cycleEndRef.current());
  const boredom = useCountdown(intervals.boredomMin * 60, () => boredomEndRef.current());

  // --- the ring at the end of a stretch ----------------------------------------------
  /** Which stretch just ended and is currently making noise, or null. */
  const [ringing, setRinging] = useState<FocusPhase | null>(null);
  const [ringLeft, setRingLeft] = useState(0);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearRingTimers = () => {
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    if (ringTickRef.current) clearInterval(ringTickRef.current);
    ringTimeoutRef.current = null;
    ringTickRef.current = null;
  };

  /**
   * The end of the ring, however it got there — the button or the ten seconds running out.
   * Both do the same thing, which is the point: walking away is a valid way to answer.
   */
  const finishRing = (source: FocusPhase) => {
    clearRingTimers();
    setRinging(null);
    void stopChime();
    if (source !== "work") return;
    // The break starts itself. Having to come back and press start is exactly how a
    // ten-minute break becomes forty.
    const secs = phaseMinutes(intervals, "break") * 60;
    const deadline = cycle.start(secs);
    if (deadline) scheduleChime("break", deadline).then(setAlarmArmed);
    setShowReward(true); // offline-progress step, now alongside a break already running
  };

  const beginRing = (source: FocusPhase) => {
    // We got here with the app open, so the notification armed for this deadline would only
    // duplicate the chime about to play.
    void cancelChime(source);
    void playPhaseChime(source);
    clearRingTimers();
    setRinging(source);
    setRingLeft(Math.round(RING_TIMEOUT_MS / 1000));
    ringTickRef.current = setInterval(() => setRingLeft((v) => Math.max(0, v - 1)), 1000);
    ringTimeoutRef.current = setTimeout(() => finishRing(source), RING_TIMEOUT_MS);
  };

  // Assigned every render so the handlers close over the current intervals and phase; the
  // countdown reads them through its own ref, so this costs nothing.
  useEffect(() => {
    cycleEndRef.current = () => {
      const finished = phase;
      setAlarmArmed(null);
      if (countsAsSession(finished)) logSession.mutate(phaseMinutes(intervals, finished));
      setPhase(nextCyclePhase(finished));
      beginRing(finished);
    };
    boredomEndRef.current = () => {
      setBoredomArmed(null);
      beginRing("boredom");
    };
  });

  useEffect(() => clearRingTimers, []);

  function pickReward(text: string) {
    if (!text.trim()) return;
    logReward.mutate(text.trim());
    setCustomReward("");
    setShowReward(false);
  }

  const totalSecs = phaseMinutes(intervals, phase) * 60;
  const pct = 1 - cycle.secondsLeft / totalSecs;
  const mm = String(Math.floor(cycle.secondsLeft / 60)).padStart(2, "0");
  const ss = String(cycle.secondsLeft % 60).padStart(2, "0");
  const bMm = String(Math.floor(boredom.secondsLeft / 60)).padStart(2, "0");
  const bSs = String(boredom.secondsLeft % 60).padStart(2, "0");

  const toggleRunning = () => {
    if (cycle.running) {
      cycle.pause();
      setAlarmArmed(null);
      // Otherwise a paused timer still goes off at the original deadline.
      void cancelChime(phase);
    } else {
      const deadline = cycle.start();
      if (deadline == null) return;
      void stopChime();
      // Armed here rather than at the end, because at the end this app may not be running.
      scheduleChime(phase, deadline).then(setAlarmArmed);
    }
  };

  const resetTimer = () => {
    cycle.reset(phaseMinutes(intervals, "work") * 60);
    setAlarmArmed(null);
    void cancelChime("work");
    void cancelChime("break");
    void stopChime();
    setPhase("work");
    // A reward prompt left open from the session that just ended shouldn't
    // survive an explicit reset.
    setShowReward(false);
  };

  /** Switching between work and break by hand drops whatever was running under the old one. */
  const selectPhase = (next: CyclePhase) => {
    if (next === phase && !cycle.started) return;
    setAlarmArmed(null);
    void cancelChime(phase);
    void stopChime();
    setPhase(next);
    cycle.reset(phaseMinutes(intervals, next) * 60);
  };

  const toggleBoredom = () => {
    if (boredom.running) {
      boredom.pause();
      setBoredomArmed(null);
      void cancelChime("boredom");
    } else {
      const deadline = boredom.start();
      if (deadline == null) return;
      void stopChime();
      scheduleChime("boredom", deadline).then(setBoredomArmed);
    }
  };

  const resetBoredom = () => {
    boredom.reset(intervals.boredomMin * 60);
    setBoredomArmed(null);
    void cancelChime("boredom");
  };

  const choosePhaseSound = async (target: FocusPhase) => {
    setPicking(target);
    setSoundError(null);
    const res = await pickPhaseSound(target);
    if (res.status === "picked") setSounds((prev) => ({ ...prev, [target]: res.sound }));
    else if (res.status === "unplayable")
      setSoundError("Этот файл не удалось открыть. Попробуй другой — mp3, m4a, wav или ogg.");
    setPicking(null);
  };

  const resetPhaseSound = async (target: FocusPhase) => {
    await clearPhaseSound(target);
    setSounds((prev) => {
      const next = { ...prev };
      delete next[target];
      return next;
    });
  };

  const openEditor = () => {
    setDraft(intervals);
    setEditing(true);
  };
  const bumpDraft = (field: keyof FocusIntervals, delta: number) =>
    setDraft((d) => ({ ...d, [field]: Math.min(240, Math.max(1, d[field] + delta)) }));
  const draftUnchanged =
    draft.workMin === workMin && draft.breakMin === breakMin && draft.boredomMin === intervals.boredomMin;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.subtle}>{PHASE_CAPTIONS[phase]}</Text>

      {/* Only the two that take turns. Boredom sits on its own card below. */}
      <View style={styles.phaseRow}>
        {CYCLE_PHASES.map((p) => {
          const active = p === phase;
          return (
            <Pressable
              key={p}
              onPress={() => selectPhase(p)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Фаза: ${PHASE_LABELS[p]}`}
              style={({ pressed }) => [styles.phaseChip, active && styles.phaseChipActive, pressed && styles.dimmed]}
            >
              <Text style={[styles.phaseChipText, active && styles.phaseChipTextActive]}>
                {PHASE_LABELS[p]}
              </Text>
              <Text style={[styles.phaseChipMin, active && styles.phaseChipMinActive]}>
                {phaseMinutes(intervals, p)} мин
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ height: 20 }} />
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE} style={{ transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={colors.cardBorder} strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={colors.accent}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${CIRC} ${CIRC}`}
            strokeDashoffset={CIRC * (1 - pct)}
          />
        </Svg>
        <View style={StyleSheet.absoluteFillObject}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={styles.timerText}>
              {mm}:{ss}
            </Text>
            <Text style={styles.timerLabel}>{PHASE_LABELS[phase]}</Text>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 12, marginTop: 28 }}>
        <Pressable onPress={toggleRunning} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>
            {cycle.running ? "Пауза" : cycle.secondsLeft === totalSecs ? "Старт" : "Продолжить"}
          </Text>
        </Pressable>
        <Pressable onPress={resetTimer} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>Сброс</Text>
        </Pressable>
      </View>

      {/* The OS's answer, not ours: a timer you trust enough to walk away from has to say
          whether it can actually reach you. */}
      {cycle.running && (
        <Text style={styles.footnote}>
          {alarmArmed === false
            ? "Прозвенит только пока приложение открыто — уведомления запрещены."
            : "Прозвенит и с закрытым приложением."}
        </Text>
      )}

      <Text style={styles.footnote}>
        {phase === "work"
          ? "Телефон — экраном вниз и подальше. Сигнал прозвенит сам, отдых начнётся сам."
          : "Во время перерыва — без телефона: прогулка, чай, свежий воздух."}
      </Text>

      {/* Its own clock, its own buttons, wired to nothing else. Ten to twenty minutes of
          deliberately nothing before you start — the source's entry ritual, which stopped
          being one as soon as it sat inside the work/break loop. */}
      <View style={styles.boredomCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.boredomTitle}>Скука</Text>
          <Text style={styles.boredomHint}>
            {boredom.running
              ? boredomArmed === false
                ? "Идёт. Прозвенит, только пока приложение открыто."
                : "Идёт. Ничего не делай — ни телефона, ни музыки, ни ленты."
              : "Отдельный отрезок перед работой. Ничего не запускает после себя."}
          </Text>
        </View>
        <Text style={styles.boredomTime}>
          {bMm}:{bSs}
        </Text>
        <Pressable
          onPress={toggleBoredom}
          accessibilityRole="button"
          accessibilityLabel={boredom.running ? "Пауза: скука" : "Старт: скука"}
          style={({ pressed }) => [styles.boredomBtn, pressed && styles.dimmed]}
        >
          <Feather name={boredom.running ? "pause" : "play"} size={14} color={colors.accent} />
        </Pressable>
        {boredom.started && (
          <Pressable
            onPress={resetBoredom}
            accessibilityRole="button"
            accessibilityLabel="Сброс: скука"
            style={({ pressed }) => [styles.boredomBtn, pressed && styles.dimmed]}
          >
            <Feather name="rotate-ccw" size={14} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* The lengths used to be constants in this file. Editing is folded away
          by default so the screen stays a timer rather than a settings page. */}
      {!editing ? (
        <Pressable
          onPress={openEditor}
          accessibilityRole="button"
          accessibilityLabel="Изменить длительность отрезков"
          style={({ pressed }) => [styles.intervalSummary, pressed && styles.dimmed]}
        >
          <Text style={styles.intervalSummaryText}>
            {intervals.boredomMin} · {workMin} · {breakMin} мин — скука, работа, перерыв
          </Text>
          <Feather name="edit-2" size={14} color={colors.textMuted} />
        </Pressable>
      ) : (
        <View style={styles.editorCard}>
          <Text style={styles.editorLabel}>Длительность</Text>

          <View style={styles.presetRow}>
            {PRESETS.map((p) => {
              const active = draft.workMin === p.workMin && draft.breakMin === p.breakMin;
              return (
                <Pressable
                  key={`${p.workMin}-${p.breakMin}`}
                  onPress={() => setDraft((d) => ({ ...d, ...p }))}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.preset, active && styles.presetActive, pressed && styles.dimmed]}
                >
                  <Text style={[styles.presetText, active && styles.presetTextActive]}>
                    {p.workMin}/{p.breakMin}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {([
            ["boredomMin", "Скука", 5],
            ["workMin", "Работа", 5],
            ["breakMin", "Перерыв", 5],
          ] as const).map(([field, label, step]) => (
            <View key={field} style={styles.editorRow}>
              <Text style={styles.editorRowLabel}>{label}</Text>
              <View style={styles.editorStepper}>
                <Pressable
                  onPress={() => bumpDraft(field, -step)}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}: минус ${step} минут`}
                  style={({ pressed }) => [styles.smallBtn, pressed && styles.dimmed]}
                >
                  <Text style={styles.smallBtnText}>−</Text>
                </Pressable>
                <Text style={styles.editorValue}>{draft[field]} мин</Text>
                <Pressable
                  onPress={() => bumpDraft(field, step)}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}: плюс ${step} минут`}
                  style={({ pressed }) => [styles.smallBtn, pressed && styles.dimmed]}
                >
                  <Text style={styles.smallBtnText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}

          {(cycle.started || boredom.started) && !draftUnchanged && (
            <Text style={styles.editorNote}>
              Отрезок уже идёт — новая длительность применится со следующего.
            </Text>
          )}

          <View style={styles.editorButtons}>
            <Pressable
              onPress={() => setEditing(false)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.editorCancel, pressed && styles.dimmed]}
            >
              <Text style={styles.editorCancelText}>Отмена</Text>
            </Pressable>
            <Pressable
              onPress={() => saveIntervals.mutate(draft)}
              disabled={saveIntervals.isPending}
              accessibilityRole="button"
              style={({ pressed }) => [styles.editorSave, pressed && styles.dimmed]}
            >
              <Text style={styles.editorSaveText}>Сохранить</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Folded away like the durations: this is a settings block on a screen that is
          otherwise a clock. */}
      <Pressable
        onPress={soundsFold.toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: soundsFold.open }}
        accessibilityLabel="Звук сигнала"
        style={({ pressed }) => [styles.intervalSummary, pressed && styles.dimmed]}
      >
        <Text style={styles.intervalSummaryText}>Звук сигнала</Text>
        <Feather name={soundsFold.open ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} />
      </Pressable>

      {soundsFold.open && (
        <View style={styles.editorCard}>
          {FOCUS_PHASES.map((p) => {
            const chosen = sounds[p];
            return (
              <View key={p} style={styles.soundRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editorRowLabel}>
                    {PHASE_LABELS[p][0].toUpperCase()}
                    {PHASE_LABELS[p].slice(1)}
                  </Text>
                  <Text style={styles.soundName} numberOfLines={1}>
                    {picking === p ? "выбираешь…" : chosen ? chosen.name : "только вибрация"}
                  </Text>
                </View>
                {chosen && (
                  <Pressable
                    onPress={() => void playPhaseChime(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Прослушать: ${PHASE_LABELS[p]}`}
                    style={({ pressed }) => [styles.smallBtn, pressed && styles.dimmed]}
                  >
                    <Feather name="play" size={13} color={colors.textMuted} />
                  </Pressable>
                )}
                <Pressable
                  onPress={() => void choosePhaseSound(p)}
                  disabled={picking !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Выбрать звук: ${PHASE_LABELS[p]}`}
                  style={({ pressed }) => [styles.smallBtn, pressed && styles.dimmed]}
                >
                  <Feather name="folder" size={13} color={colors.textMuted} />
                </Pressable>
                {chosen && (
                  <Pressable
                    onPress={() => void resetPhaseSound(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Убрать звук: ${PHASE_LABELS[p]}`}
                    style={({ pressed }) => [styles.smallBtn, pressed && styles.dimmed]}
                  >
                    <Feather name="x" size={13} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
            );
          })}

          {soundError && <Text style={styles.soundError}>{soundError}</Text>}

          {/* Said plainly rather than discovered later: the file you pick is played by this
              app, and only this app can play it. */}
          <Text style={styles.editorNote}>
            Свой файл звучит, пока приложение открыто. Если телефон заблокирован или ты вышел
            из приложения, звонит уведомление — у него системный звук, его файлом не заменить.
            Вибрация работает в обоих случаях.
          </Text>
        </View>
      )}

      {/* The one piece of the source that belongs on this screen rather than only in the
          reference: what to have playing, and what not to have playing before you start.
          Rendered through TipCard so it reads and behaves like every other tip. */}
      {soundTip && (
        <View style={styles.tipSlot}>
          <TipCard
            tip={soundTip}
            expanded={soundTipOpen}
            onToggle={() => setSoundTipOpen((v) => !v)}
            number={rotationNumberFor(tipPrefs, soundTip.id)}
          />
        </View>
      )}

      {/* The alarm itself. It closes on its own after ten seconds, and closing it early does
          exactly the same thing — the button is a way to stop the noise, not a gate the next
          stretch is waiting behind. */}
      <Modal
        visible={ringing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => ringing && finishRing(ringing)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {ringing ? `${PHASE_LABELS[ringing][0].toUpperCase()}${PHASE_LABELS[ringing].slice(1)}` : ""} — время
              вышло
            </Text>
            <Text style={styles.modalSubtitle}>
              {ringing === "work"
                ? `Отдых начнётся сам через ${ringLeft} ${plural(ringLeft, ["секунду", "секунды", "секунд"])}.`
                : `Звук выключится сам через ${ringLeft} ${plural(ringLeft, ["секунду", "секунды", "секунд"])}.`}
            </Text>
            <Pressable
              onPress={() => ringing && finishRing(ringing)}
              accessibilityRole="button"
              accessibilityLabel="Выключить звук"
              style={({ pressed }) => [styles.ringStop, pressed && styles.dimmed]}
            >
              <Feather name="bell-off" size={15} color={colors.bg} />
              <Text style={styles.ringStopText}>Выключить</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showReward} transparent animationType="fade" onRequestClose={() => setShowReward(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Чем себя наградишь?</Text>
              <Pressable onPress={() => setEditingRewards((e) => !e)} accessibilityLabel="Настроить варианты наград">
                <Feather name="settings" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.modalSubtitle}>
              полезное вознаграждение закрывает цикл — мозг связывает работу не с наказанием
            </Text>

            <View style={styles.chipRow}>
              {rewardOptions.map((o) => (
                <View key={o.id} style={styles.chipWrap}>
                  <Pressable
                    onPress={() => !editingRewards && pickReward(o.label)}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>{o.label}</Text>
                  </Pressable>
                  {editingRewards && (
                    <Pressable
                      onPress={() => removeOption.mutate(o.id)}
                      style={styles.chipRemove}
                      accessibilityLabel={`Удалить вариант: ${o.label}`}
                    >
                      <Feather name="x" size={11} color={colors.bg} />
                    </Pressable>
                  )}
                </View>
              ))}
            </View>

            {editingRewards && (
              <View style={styles.addOptionRow}>
                <TextInput
                  value={newOptionLabel}
                  onChangeText={setNewOptionLabel}
                  placeholder="Свой вариант…"
                  placeholderTextColor={colors.textMuted}
                  style={styles.addOptionInput}
                  onSubmitEditing={() => newOptionLabel.trim() && addOption.mutate(newOptionLabel.trim())}
                />
                <Pressable
                  onPress={() => newOptionLabel.trim() && addOption.mutate(newOptionLabel.trim())}
                  style={styles.iconBtn}
                >
                  <Feather name="plus" size={16} color={colors.accentGreen} />
                </Pressable>
              </View>
            )}

            <View style={styles.customRow}>
              <TextInput
                value={customReward}
                onChangeText={setCustomReward}
                placeholder="…или напиши, чем наградишься"
                placeholderTextColor={colors.textMuted}
                style={styles.customInput}
                onSubmitEditing={() => pickReward(customReward)}
              />
              <Pressable onPress={() => pickReward(customReward)} style={styles.iconBtn}>
                <Feather name="check" size={16} color={colors.accentGreen} />
              </Pressable>
            </View>

            <Pressable onPress={() => setShowReward(false)}>
              <Text style={styles.skipText}>Пропустить</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  phaseRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  phaseChip: {
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  phaseChipActive: { backgroundColor: "rgba(224,138,85,0.14)" },
  phaseChipText: { color: colors.textMuted, fontSize: 12 },
  phaseChipTextActive: { color: colors.accent },
  phaseChipMin: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  phaseChipMinActive: { color: colors.accent },
  soundRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  soundName: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  soundError: { color: colors.accent, fontSize: 11, marginTop: 6, lineHeight: 16 },
  boredomCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "stretch",
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 16,
  },
  boredomTitle: { color: colors.text, fontSize: 14 },
  boredomHint: { color: colors.textMuted, fontSize: 11, marginTop: 3, lineHeight: 15 },
  boredomTime: { color: colors.text, fontSize: 18, fontVariant: ["tabular-nums"] },
  boredomBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardBorder,
  },
  ringStop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.accent,
  },
  ringStopText: { color: colors.bg, fontSize: 14, fontWeight: "600" },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { alignItems: "center", paddingTop: 40, paddingHorizontal: 24, paddingBottom: 40 },
  // The tip is the one full-width thing on a screen that centres everything else.
  tipSlot: { alignSelf: "stretch", marginTop: 28 },
  subtle: { color: colors.textMuted, fontSize: 13 },
  timerText: { color: colors.text, fontSize: 40, fontWeight: "700", fontVariant: ["tabular-nums"] },
  timerLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 4 },
  primaryBtn: { backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  primaryBtnText: { color: colors.bg, fontWeight: "600", fontSize: 14 },
  secondaryBtn: { backgroundColor: colors.card, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  secondaryBtnText: { color: colors.textMuted, fontWeight: "600", fontSize: 14 },
  footnote: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 24, maxWidth: 260 },
  dimmed: { opacity: 0.65 },

  intervalSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  intervalSummaryText: { color: colors.textMuted, fontSize: 12 },
  editorCard: {
    alignSelf: "stretch",
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 24,
    gap: 12,
  },
  editorLabel: { color: colors.textMuted, fontSize: 12 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  preset: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  presetActive: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  presetText: { color: colors.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] },
  presetTextActive: { color: colors.accentGreen, fontWeight: "600" },
  editorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editorRowLabel: { color: colors.text, fontSize: 14 },
  editorStepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  smallBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: colors.text, fontSize: 17, fontWeight: "600" },
  editorValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 60,
    textAlign: "center",
  },
  editorNote: { color: colors.accent, fontSize: 11, lineHeight: 16 },
  editorButtons: { flexDirection: "row", gap: 10, marginTop: 2 },
  editorCancel: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  editorCancelText: { color: colors.textMuted, fontSize: 13, fontWeight: "500" },
  editorSave: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: "center", backgroundColor: colors.accent },
  editorSaveText: { color: colors.bg, fontSize: 13, fontWeight: "600" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: colors.card, borderRadius: 20, padding: 20 },
  modalHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  modalSubtitle: { color: colors.textMuted, fontSize: 11, marginTop: 6, marginBottom: 18, lineHeight: 15 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipWrap: { position: "relative" },
  chip: {
    backgroundColor: colors.bg,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipText: { color: colors.text, fontSize: 13 },
  chipRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  addOptionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  addOptionInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  customRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
  customInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  iconBtn: { padding: 6 },
  skipText: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 18 },
});
