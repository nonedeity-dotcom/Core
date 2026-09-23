import { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type GestureResponderEvent } from "react-native";
import { CellArt, Glow, OUTSIDE_COLOR, PlayerSprite, groundColor } from "./Sprites";
import { cellAt, darkness, facingCell, isNight, type VillageState } from "../../lib/village/game";
import { WORLD_SIZE, variant } from "../../lib/village/world";
import type { NatureId, StructureId } from "../../lib/village/content";
import type { Ground } from "../../lib/village/world";

/**
 * Карта «Опушки».
 *
 * Клетки лежат на своих местах в мире, а сдвигается весь мир целиком — плавно, за долю
 * секунды. Персонаж стоит посередине, и под ним едет лес: так шаг выглядит шагом, а не
 * прыжком картинки. Заодно на шаге перерисовывается только новая полоска клеток по краю,
 * а не вся карта: клетка, которая не поменялась, не рисуется заново.
 */
export default function VillageMap({
  state,
  width,
  height,
  tile,
  accent,
  showTarget,
  onTap,
}: {
  state: VillageState;
  width: number;
  height: number;
  tile: number;
  accent: string;
  /** Подсветить клетку перед собой — когда с ней есть что сделать. */
  showTarget: boolean;
  onTap: (x: number, y: number) => void;
}) {
  const tx = width / 2 - (state.x + 0.5) * tile;
  const ty = height / 2 - (state.y + 0.5) * tile;
  const offset = useRef(new Animated.ValueXY({ x: tx, y: ty })).current;
  const last = useRef({ x: state.x, y: state.y, tile, width, height });

  useEffect(() => {
    const p = last.current;
    const oneStep = p.tile === tile && p.width === width && p.height === height && Math.abs(p.x - state.x) + Math.abs(p.y - state.y) === 1;
    if (oneStep) {
      Animated.timing(offset, {
        toValue: { x: tx, y: ty },
        duration: 130,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    } else {
      // Сон, поворот экрана, первая отрисовка — просто встать на место.
      offset.stopAnimation();
      offset.setValue({ x: tx, y: ty });
    }
    last.current = { x: state.x, y: state.y, tile, width, height };
  }, [tx, ty, tile, width, height, state.x, state.y, offset]);

  // Какие клетки видны — с запасом в две, чтобы край не мелькал пустотой во время сдвига.
  const spanX = Math.ceil(width / tile / 2) + 2;
  const spanY = Math.ceil(height / tile / 2) + 2;
  const x0 = Math.max(0, state.x - spanX);
  const x1 = Math.min(WORLD_SIZE - 1, state.x + spanX);
  const y0 = Math.max(0, state.y - spanY);
  const y1 = Math.min(WORLD_SIZE - 1, state.y + spanY);

  const night = isNight(state.time);
  const dark = darkness(state.time);
  const cells: JSX.Element[] = [];
  const lights: JSX.Element[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = cellAt(state, x, y)!;
      cells.push(
        <Cell
          key={`${x}:${y}`}
          x={x}
          y={y}
          tile={tile}
          ground={c.ground}
          nature={c.nature}
          depleted={c.depleted}
          built={c.built}
          v={variant(state.seed, x, y)}
          night={night}
        />,
      );
      if (dark > 0 && (c.built === "campfire" || c.built === "house")) {
        const r = c.built === "campfire" ? tile * 3.2 : tile * 2;
        lights.push(
          <View key={`l${x}:${y}`} style={{ position: "absolute", left: (x + 0.5) * tile - r, top: (y + 0.5) * tile - r, opacity: dark }}>
            <Glow size={r * 2} />
          </View>,
        );
      }
    }
  }

  // Касание: считаем клетку от положения пальца на карте, а не от того, над чьей
  // картинкой он оказался, — у картинок координаты свои.
  const box = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const measure = () => box.current?.measureInWindow((x, y) => (origin.current = { x, y }));
  const down = useRef({ x: 0, y: 0 });
  const onGrant = (e: GestureResponderEvent) => {
    measure();
    down.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  };
  const onRelease = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    // Палец уехал — это не касание, а случайный мазок.
    if (Math.abs(pageX - down.current.x) > tile * 0.6 || Math.abs(pageY - down.current.y) > tile * 0.6) return;
    const px = pageX - origin.current.x;
    const py = pageY - origin.current.y;
    onTap(Math.floor(state.x + 0.5 + (px - width / 2) / tile), Math.floor(state.y + 0.5 + (py - height / 2) / tile));
  };

  const front = facingCell(state);
  const center = { left: width / 2 - tile / 2, top: height / 2 - tile / 2 };
  const move = { transform: offset.getTranslateTransform() };

  return (
    <View
      ref={box}
      onLayout={measure}
      style={[styles.box, { width, height }]}
      onStartShouldSetResponder={() => true}
      onResponderGrant={onGrant}
      onResponderRelease={onRelease}
      accessibilityLabel="Карта"
    >
      <Animated.View pointerEvents="none" style={[styles.world, { width: WORLD_SIZE * tile, height: WORLD_SIZE * tile }, move]}>
        {cells}
      </Animated.View>

      {showTarget && (
        <View
          pointerEvents="none"
          style={[
            styles.target,
            {
              left: center.left + (front.x - state.x) * tile,
              top: center.top + (front.y - state.y) * tile,
              width: tile,
              height: tile,
              borderRadius: tile * 0.22,
            },
          ]}
        />
      )}
      <View pointerEvents="none" style={[styles.abs, center, { width: tile, height: tile }]}>
        <PlayerSprite facing={state.facing} color={accent} step={(state.x + state.y) % 2 === 0} />
      </View>

      {dark > 0 && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(8,12,34,${0.6 * dark})` }]} />}
      {lights.length > 0 && (
        <Animated.View pointerEvents="none" style={[styles.world, { width: WORLD_SIZE * tile, height: WORLD_SIZE * tile }, move]}>
          {lights}
        </Animated.View>
      )}
    </View>
  );
}

const Cell = memo(function Cell({
  x,
  y,
  tile,
  ground,
  nature,
  depleted,
  built,
  v,
  night,
}: {
  x: number;
  y: number;
  tile: number;
  ground: Ground;
  nature: NatureId | null;
  depleted: boolean;
  built: StructureId | null;
  v: number;
  night: boolean;
}) {
  return (
    <View style={[styles.abs, { left: x * tile, top: y * tile, width: tile, height: tile, backgroundColor: groundColor(ground, v) }]}>
      <CellArt ground={ground} nature={nature} depleted={depleted} built={built} v={v} night={night} />
    </View>
  );
});

const styles = StyleSheet.create({
  box: { overflow: "hidden", backgroundColor: OUTSIDE_COLOR },
  world: { position: "absolute", left: 0, top: 0 },
  abs: { position: "absolute" },
  target: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "rgba(242,194,107,0.75)",
    backgroundColor: "rgba(242,194,107,0.08)",
  },
});
