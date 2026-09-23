import { useRef, useState } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import type { Dir } from "../../lib/village/game";

/**
 * Управление ходьбой: джойстик или крестовина — один и тот же круг.
 *
 * Раньше крестовина была четырьмя отдельными кнопками, и это было главной бедой: чуть
 * сдвинул палец при удержании — кнопка считала, что её отпустили, и персонаж вставал;
 * перевести палец со «вверх» на «вправо» было нельзя — надо было отпустить и нажать снова.
 *
 * Теперь касание ловит весь круг целиком, а направление считается по тому, где палец
 * относительно середины. Держишь — идёт; повёл палец — повернул, не отпуская; отпустил —
 * встал. Всё, что внутри круга, касаний не принимает — иначе координаты считались бы от
 * стрелки, а не от круга.
 *
 * Диагоналей в мире нет, поэтому направление — по той оси, куда палец ушёл дальше. Чтобы
 * на границе между «вверх» и «вправо» персонажа не дёргало туда-сюда, ось меняется только
 * с запасом.
 */
export default function MovePad({
  mode,
  size,
  floating = false,
  onDir,
}: {
  mode: "stick" | "dpad";
  size: number;
  floating?: boolean;
  /** Направление поменялось. null — палец отпущен или в середине. */
  onDir: (dir: Dir | null) => void;
}) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState<Dir | null>(null);
  const current = useRef<Dir | null>(null);
  const r = size / 2;
  const dead = size * 0.13;
  const reach = size * 0.3;

  const emit = (dir: Dir | null) => {
    if (dir === current.current) return;
    current.current = dir;
    setActive(dir);
    onDir(dir);
  };

  const track = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.locationX - r;
    const dy = e.nativeEvent.locationY - r;
    const dist = Math.hypot(dx, dy);
    const k = dist > reach ? reach / dist : 1;
    if (mode === "stick") setKnob({ x: dx * k, y: dy * k });
    if (dist < dead) {
      emit(null);
      return;
    }
    const was = current.current;
    const horizontalNow = was === "left" || was === "right";
    // Запас в 25%: чтобы сменить ось, палец должен уйти по новой оси заметно дальше.
    const bias = was ? 1.25 : 1;
    const horizontal = horizontalNow ? Math.abs(dx) * bias >= Math.abs(dy) : Math.abs(dx) > Math.abs(dy) * bias;
    emit(horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  };

  const release = () => {
    setKnob({ x: 0, y: 0 });
    emit(null);
  };

  const arrow = (d: Dir, name: "chevron-up" | "chevron-down" | "chevron-left" | "chevron-right", pos: object) => (
    <View pointerEvents="none" style={[styles.arrow, pos, active === d && styles.arrowOn]}>
      <Feather name={name} size={size * 0.16} color={active === d ? colors.bg : colors.text} />
    </View>
  );
  const a = size * 0.3;

  return (
    <View
      accessibilityLabel={mode === "stick" ? "Джойстик" : "Крестовина"}
      style={[styles.base, { width: size, height: size, borderRadius: r }, floating && styles.floating]}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={track}
      onResponderMove={track}
      onResponderRelease={release}
      onResponderTerminate={release}
    >
      {mode === "stick" ? (
        <>
          {/* Едва видные метки сторон — чтобы было понятно, куда вести. */}
          {(["up", "down", "left", "right"] as Dir[]).map((d) => (
            <View
              key={d}
              pointerEvents="none"
              style={[
                styles.tick,
                d === "up" && { top: size * 0.07, left: r - 3 },
                d === "down" && { bottom: size * 0.07, left: r - 3 },
                d === "left" && { left: size * 0.07, top: r - 3 },
                d === "right" && { right: size * 0.07, top: r - 3 },
                active === d && styles.tickOn,
              ]}
            />
          ))}
          <View
            pointerEvents="none"
            style={[
              styles.knob,
              {
                width: size * 0.42,
                height: size * 0.42,
                borderRadius: size * 0.21,
                left: r - size * 0.21,
                top: r - size * 0.21,
                transform: [{ translateX: knob.x }, { translateY: knob.y }],
              },
              active && styles.knobOn,
            ]}
          />
        </>
      ) : (
        <>
          {arrow("up", "chevron-up", { left: r - a / 2, top: size * 0.04, width: a, height: a, borderRadius: a / 2 })}
          {arrow("down", "chevron-down", { left: r - a / 2, bottom: size * 0.04, width: a, height: a, borderRadius: a / 2 })}
          {arrow("left", "chevron-left", { top: r - a / 2, left: size * 0.04, width: a, height: a, borderRadius: a / 2 })}
          {arrow("right", "chevron-right", { top: r - a / 2, right: size * 0.04, width: a, height: a, borderRadius: a / 2 })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  floating: { backgroundColor: "rgba(18,21,26,0.5)", borderColor: "rgba(255,255,255,0.1)" },
  knob: {
    position: "absolute",
    backgroundColor: "rgba(232,230,224,0.16)",
    borderWidth: 2,
    borderColor: "rgba(232,230,224,0.35)",
  },
  knobOn: { backgroundColor: "rgba(143,184,154,0.55)", borderColor: colors.accentGreen },
  tick: { position: "absolute", width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(232,230,224,0.25)" },
  tickOn: { backgroundColor: colors.accentGreen },
  arrow: { position: "absolute", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)" },
  arrowOn: { backgroundColor: colors.accentGreen },
});
