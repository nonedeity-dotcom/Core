import { memo } from "react";
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from "react-native-svg";
import type { NatureId, StructureId } from "../../lib/village/content";
import type { Dir } from "../../lib/village/game";
import type { Ground } from "../../lib/village/world";

/**
 * Картинки «Опушки» — простые фигуры на сетке 100×100.
 *
 * Не эмодзи: на разных телефонах они рисуются по-разному, а часть вовсе не рисуется на
 * старом Android. Свои фигуры везде одинаковые и держатся одной спокойной палитры.
 * Новая вещь в мире — новый случай здесь.
 */

export const GROUND_COLOR: Record<Ground, string> = {
  grass: "#34503a",
  forest: "#2a4231",
  shore: "#5f5a42",
  water: "#2b5368",
};

const size = { width: "100%", height: "100%" } as const;

export const NatureSprite = memo(function NatureSprite({ id, depleted }: { id: NatureId; depleted: boolean }) {
  return (
    <Svg viewBox="0 0 100 100" {...size}>
      {id === "tree" &&
        (depleted ? (
          <G>
            <Ellipse cx="50" cy="66" rx="18" ry="9" fill="#5a4128" />
            <Ellipse cx="50" cy="61" rx="18" ry="9" fill="#8a6a45" />
            <Ellipse cx="50" cy="61" rx="10" ry="4.5" fill="#a5845a" />
          </G>
        ) : (
          <G>
            <Rect x="44" y="58" width="12" height="30" rx="3" fill="#6b4b2e" />
            <Circle cx="50" cy="42" r="30" fill="#3d6e47" />
            <Circle cx="38" cy="36" r="18" fill="#4a8254" />
            <Circle cx="60" cy="30" r="14" fill="#56905f" />
          </G>
        ))}
      {id === "bush" && (
        <G>
          <Circle cx="36" cy="58" r="20" fill="#3b6f46" />
          <Circle cx="62" cy="56" r="22" fill="#44804f" />
          <Circle cx="50" cy="42" r="18" fill="#4d8b58" />
          {!depleted && (
            <G>
              <Circle cx="40" cy="50" r="5" fill="#c9566a" />
              <Circle cx="58" cy="44" r="5" fill="#c9566a" />
              <Circle cx="64" cy="62" r="5" fill="#c9566a" />
              <Circle cx="46" cy="64" r="5" fill="#c9566a" />
            </G>
          )}
        </G>
      )}
      {id === "rock" && !depleted && (
        <G>
          <Polygon points="18,76 26,40 50,24 76,34 84,70 60,82" fill="#7c8188" />
          <Polygon points="26,40 50,24 76,34 58,46 36,50" fill="#979ca3" />
        </G>
      )}
      {id === "pebble" && !depleted && (
        <G>
          <Ellipse cx="38" cy="60" rx="11" ry="8" fill="#8f949b" />
          <Ellipse cx="60" cy="66" rx="8" ry="6" fill="#a3a8ae" />
          <Ellipse cx="56" cy="50" rx="6" ry="5" fill="#80858c" />
        </G>
      )}
      {id === "branch" && !depleted && (
        <G>
          <Line x1="24" y1="68" x2="76" y2="48" stroke="#8a6440" strokeWidth="6" strokeLinecap="round" />
          <Line x1="48" y1="59" x2="58" y2="40" stroke="#8a6440" strokeWidth="4" strokeLinecap="round" />
          <Line x1="30" y1="44" x2="62" y2="70" stroke="#7a5636" strokeWidth="5" strokeLinecap="round" />
        </G>
      )}
    </Svg>
  );
});

export const StructureSprite = memo(function StructureSprite({ id, lit }: { id: StructureId; lit: boolean }) {
  return (
    <Svg viewBox="0 0 100 100" {...size}>
      {id === "campfire" && (
        <G>
          {lit && <Circle cx="50" cy="56" r="44" fill="#e08a55" opacity="0.18" />}
          <Line x1="28" y1="76" x2="72" y2="62" stroke="#6b4b2e" strokeWidth="8" strokeLinecap="round" />
          <Line x1="28" y1="62" x2="72" y2="76" stroke="#7a5636" strokeWidth="8" strokeLinecap="round" />
          <Path d="M50 22 C64 40 66 52 58 64 C54 70 46 70 42 64 C34 52 38 40 50 22 Z" fill="#e08a55" />
          <Path d="M50 40 C57 50 57 58 53 64 C51 66 49 66 47 64 C43 58 43 50 50 40 Z" fill="#f2c26b" />
        </G>
      )}
      {id === "workbench" && (
        <G>
          <Rect x="14" y="36" width="72" height="14" rx="3" fill="#a07a4e" />
          <Rect x="20" y="50" width="8" height="34" fill="#7a5636" />
          <Rect x="72" y="50" width="8" height="34" fill="#7a5636" />
          <Rect x="30" y="28" width="16" height="8" rx="2" fill="#8f949b" />
        </G>
      )}
      {id === "fence" && (
        <G>
          <Rect x="12" y="40" width="76" height="8" rx="2" fill="#9a7a52" />
          <Rect x="12" y="60" width="76" height="8" rx="2" fill="#9a7a52" />
          <Rect x="18" y="28" width="10" height="56" rx="2" fill="#8a6a45" />
          <Rect x="72" y="28" width="10" height="56" rx="2" fill="#8a6a45" />
        </G>
      )}
      {id === "house" && (
        <G>
          <Rect x="16" y="46" width="68" height="44" fill="#b08a5a" />
          <Polygon points="8,50 50,10 92,50" fill="#8e4f3a" />
          <Rect x="42" y="62" width="16" height="28" fill="#5a3a24" />
          <Rect x="24" y="58" width="12" height="12" fill={lit ? "#f2c26b" : "#3d5566"} />
          <Rect x="64" y="58" width="12" height="12" fill={lit ? "#f2c26b" : "#3d5566"} />
        </G>
      )}
    </Svg>
  );
});

/** Персонаж. Смотрит туда, куда шёл, — глазами: по ним видно, к чему он повернулся. */
export const PlayerSprite = memo(function PlayerSprite({ facing, color }: { facing: Dir; color: string }) {
  const eye = { up: [0, -6], down: [0, 3], left: [-5, 0], right: [5, 0] }[facing];
  const back = facing === "up";
  return (
    <Svg viewBox="0 0 100 100" {...size}>
      <Ellipse cx="50" cy="88" rx="20" ry="6" fill="#000" opacity="0.25" />
      <Rect x="32" y="48" width="36" height="38" rx="14" fill={color} />
      <Circle cx="50" cy="34" r="18" fill="#e3cdb0" />
      <Path d="M32 30 C34 14 66 14 68 30 C60 24 40 24 32 30 Z" fill="#5a3a24" />
      {!back && (
        <G>
          <Circle cx={43 + eye[0]} cy={36 + eye[1]} r="2.6" fill="#2a2a2a" />
          <Circle cx={57 + eye[0]} cy={36 + eye[1]} r="2.6" fill="#2a2a2a" />
        </G>
      )}
    </Svg>
  );
});

export const WaterSprite = memo(function WaterSprite() {
  return (
    <Svg viewBox="0 0 100 100" {...size}>
      <Path d="M20 40 Q30 34 40 40 T60 40" stroke="#4d7d94" strokeWidth="4" fill="none" strokeLinecap="round" />
      <Path d="M44 66 Q54 60 64 66 T84 66" stroke="#4d7d94" strokeWidth="4" fill="none" strokeLinecap="round" />
    </Svg>
  );
});
