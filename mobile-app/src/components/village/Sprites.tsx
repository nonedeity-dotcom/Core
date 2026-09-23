import { memo } from "react";
import Svg, { Circle, Defs, Ellipse, G, Line, Path, Polygon, RadialGradient, Rect, Stop } from "react-native-svg";
import type { NatureId, StructureId } from "../../lib/village/content";
import type { Dir } from "../../lib/village/game";
import type { Ground } from "../../lib/village/world";

/**
 * Картинки «Опушки» — простые фигуры на сетке 100×100.
 *
 * Не эмодзи: на разных телефонах они рисуются по-разному, а часть вовсе не рисуется на
 * старом Android. Свои фигуры везде одинаковые и держатся одной спокойной палитры.
 *
 * Клетка рисуется одной картинкой — земля с мелочами, то, что на ней растёт, и постройка.
 * Одна картинка на клетку вместо трёх — втрое меньше работы на каждом шаге.
 */

/** Цвет земли. Три оттенка на каждую — чтобы поляна не была ровной заливкой. */
const GROUND: Record<Ground, [string, string, string]> = {
  grass: ["#35523b", "#34503a", "#36543c"],
  forest: ["#2a4231", "#294130", "#2b4332"],
  shore: ["#62604a", "#605e48", "#64624c"],
  water: ["#2b5368", "#2a5166", "#2c556a"],
};

export const groundColor = (g: Ground, v: number): string => GROUND[g][v % 3];

/** За краем мира — тёмная чаща. */
export const OUTSIDE_COLOR = "#1b2a20";

export interface CellArtProps {
  ground: Ground;
  nature: NatureId | null;
  depleted: boolean;
  built: StructureId | null;
  /** Постоянное число клетки 0–255: вид дерева, трава, цветы. */
  v: number;
  night: boolean;
}

export const CellArt = memo(function CellArt({ ground, nature, depleted, built, v, night }: CellArtProps) {
  const empty = !nature && !built;
  return (
    <Svg viewBox="0 0 100 100" width="100%" height="100%">
      {ground === "water" && <Water v={v} />}
      {ground === "shore" && empty && <ShoreDecor v={v} />}
      {(ground === "grass" || ground === "forest") && empty && <GrassDecor v={v} forest={ground === "forest"} />}
      {nature && <Nature id={nature} depleted={depleted} v={v} />}
      {built && <Structure id={built} lit={night} />}
    </Svg>
  );
});

// --- земля --------------------------------------------------------------------------

function GrassDecor({ v, forest }: { v: number; forest: boolean }) {
  const blade = forest ? "#3a5c42" : "#46684c";
  if (v < 40) {
    // Пучок травы.
    const x = 20 + (v % 5) * 12;
    return (
      <G>
        <Path d={`M${x} 70 L${x - 5} 54 M${x} 70 L${x + 1} 50 M${x} 70 L${x + 7} 56`} stroke={blade} strokeWidth="3" strokeLinecap="round" />
      </G>
    );
  }
  if (!forest && v < 52) {
    // Цветок: белый, жёлтый или сиреневый.
    const petal = ["#e8e6e0", "#e8c96a", "#b79ad6"][v % 3];
    const x = 30 + (v % 4) * 12;
    const y = 36 + (v % 3) * 12;
    return (
      <G>
        <Line x1={x} y1={y + 4} x2={x} y2={y + 16} stroke="#46684c" strokeWidth="2.5" />
        <Circle cx={x - 4} cy={y} r="3.4" fill={petal} />
        <Circle cx={x + 4} cy={y} r="3.4" fill={petal} />
        <Circle cx={x} cy={y - 4} r="3.4" fill={petal} />
        <Circle cx={x} cy={y + 4} r="3.4" fill={petal} />
        <Circle cx={x} cy={y} r="2.4" fill="#e0a24a" />
      </G>
    );
  }
  if (forest && v < 50) {
    // Грибок в лесу.
    return (
      <G>
        <Rect x="47" y="58" width="6" height="10" rx="2" fill="#e3d6bf" />
        <Path d="M40 60 C40 50 60 50 60 60 Z" fill="#b8584a" />
        <Circle cx="46" cy="56" r="1.6" fill="#f0e2d0" />
        <Circle cx="54" cy="57" r="1.4" fill="#f0e2d0" />
      </G>
    );
  }
  if (v < 70) {
    return <Circle cx={20 + (v % 7) * 9} cy={30 + (v % 5) * 10} r="2" fill={blade} opacity="0.8" />;
  }
  return null;
}

function ShoreDecor({ v }: { v: number }) {
  if (v < 60) {
    return (
      <G>
        <Path d={`M${30 + (v % 4) * 10} 72 L${26 + (v % 4) * 10} 50`} stroke="#6f8a5a" strokeWidth="3" strokeLinecap="round" />
        <Path d={`M${36 + (v % 4) * 10} 72 L${40 + (v % 4) * 10} 46`} stroke="#6f8a5a" strokeWidth="3" strokeLinecap="round" />
        <Ellipse cx={38 + (v % 4) * 10} cy="44" rx="2.4" ry="6" fill="#7a5636" />
      </G>
    );
  }
  return <Circle cx={20 + (v % 6) * 12} cy={60} r="2" fill="#77735a" />;
}

function Water({ v }: { v: number }) {
  const dx = (v % 4) * 6;
  return (
    <G>
      <Path d={`M${14 + dx} 36 Q${24 + dx} 30 ${34 + dx} 36 T${54 + dx} 36`} stroke="#3f6f86" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <Path d={`M${34 - dx / 2} 70 Q${44 - dx / 2} 64 ${54 - dx / 2} 70 T${74 - dx / 2} 70`} stroke="#3f6f86" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {v < 22 && (
        // Кувшинка.
        <G>
          <Path d="M50 50 L66 44 A18 14 0 1 1 64 58 Z" fill="#3f7a4a" />
          {v < 8 && <Circle cx="44" cy="48" r="4" fill="#e8e6e0" />}
        </G>
      )}
    </G>
  );
}

// --- то, что растёт и лежит ---------------------------------------------------------

const Shadow = ({ w = 26 }: { w?: number }) => <Ellipse cx="50" cy="84" rx={w} ry="7" fill="#000" opacity="0.22" />;

function Nature({ id, depleted, v }: { id: NatureId; depleted: boolean; v: number }) {
  switch (id) {
    case "tree":
      if (depleted) {
        return (
          <G>
            <Shadow w={20} />
            <Path d="M32 66 L32 78 C32 84 68 84 68 78 L68 66 Z" fill="#6b4b2e" />
            <Ellipse cx="50" cy="66" rx="18" ry="8" fill="#a5845a" />
            <Ellipse cx="50" cy="66" rx="10" ry="4" fill="none" stroke="#8a6a45" strokeWidth="2" />
            <Path d="M66 70 C74 66 78 70 80 74" stroke="#4a8254" strokeWidth="3" fill="none" strokeLinecap="round" />
          </G>
        );
      }
      // Каждое третье дерево — ель: лес из одинаковых кругов выглядит как обои.
      return v % 3 === 0 ? (
        <G>
          <Shadow w={24} />
          <Rect x="45" y="70" width="10" height="16" rx="2" fill="#5e412a" />
          <Polygon points="50,6 78,44 22,44" fill="#2f5e3d" />
          <Polygon points="50,22 84,62 16,62" fill="#326843" />
          <Polygon points="50,38 88,78 12,78" fill="#377049" />
          <Polygon points="50,6 58,18 42,18" fill="#3d7a50" />
        </G>
      ) : (
        <G>
          <Shadow />
          <Rect x="44" y="58" width="12" height="28" rx="3" fill="#6b4b2e" />
          <Circle cx="50" cy="42" r="31" fill="#3a6a44" />
          <Circle cx="36" cy="38" r="19" fill="#44794e" />
          <Circle cx="62" cy="30" r="16" fill="#4f8a59" />
          <Circle cx="44" cy="24" r="10" fill="#5a9663" />
          {v % 5 === 1 && (
            <G>
              <Circle cx="34" cy="46" r="3.6" fill="#d86a4a" />
              <Circle cx="62" cy="50" r="3.6" fill="#d86a4a" />
              <Circle cx="54" cy="34" r="3.6" fill="#d86a4a" />
            </G>
          )}
        </G>
      );
    case "bush":
      return (
        <G>
          <Shadow w={28} />
          <Circle cx="34" cy="62" r="20" fill="#3b6f46" />
          <Circle cx="66" cy="60" r="22" fill="#40784b" />
          <Circle cx="50" cy="44" r="20" fill="#4a8756" />
          <Circle cx="44" cy="40" r="8" fill="#56935f" />
          {!depleted && (
            <G>
              {[
                [38, 52],
                [58, 44],
                [66, 64],
                [46, 66],
                [28, 64],
              ].map(([x, y]) => (
                <G key={`${x}:${y}`}>
                  <Circle cx={x} cy={y} r="5.2" fill="#c9566a" />
                  <Circle cx={x - 1.6} cy={y - 1.6} r="1.6" fill="#f2b8c2" />
                </G>
              ))}
            </G>
          )}
        </G>
      );
    case "rock":
      if (depleted) {
        return (
          <G>
            <Ellipse cx="40" cy="70" rx="7" ry="5" fill="#7c8188" />
            <Ellipse cx="60" cy="74" rx="5" ry="4" fill="#8f949b" />
          </G>
        );
      }
      return (
        <G>
          <Shadow w={32} />
          <Polygon points="16,78 24,42 48,24 76,32 86,70 60,84" fill="#747980" />
          <Polygon points="24,42 48,24 76,32 58,48 34,52" fill="#999ea5" />
          <Polygon points="60,84 58,48 76,32 86,70" fill="#63686f" />
          <Path d="M40 60 C46 56 52 58 54 62" stroke="#5a5f66" strokeWidth="2" fill="none" />
          <Ellipse cx="30" cy="70" rx="8" ry="3" fill="#5f8a55" opacity="0.8" />
        </G>
      );
    case "pebble":
      if (depleted) return null;
      return (
        <G>
          <Ellipse cx="38" cy="62" rx="12" ry="8" fill="#8a8f96" />
          <Ellipse cx="36" cy="59" rx="6" ry="3" fill="#a9aeb4" />
          <Ellipse cx="62" cy="68" rx="9" ry="6" fill="#9ea3aa" />
          <Ellipse cx="58" cy="50" rx="7" ry="5" fill="#7f848b" />
        </G>
      );
    case "branch":
      if (depleted) return null;
      return (
        <G>
          <Line x1="22" y1="70" x2="78" y2="50" stroke="#5a4128" strokeWidth="8" strokeLinecap="round" opacity="0.35" />
          <Line x1="22" y1="66" x2="78" y2="46" stroke="#8a6440" strokeWidth="6" strokeLinecap="round" />
          <Line x1="50" y1="56" x2="60" y2="36" stroke="#8a6440" strokeWidth="4" strokeLinecap="round" />
          <Line x1="30" y1="42" x2="64" y2="70" stroke="#7a5636" strokeWidth="5" strokeLinecap="round" />
          <Ellipse cx="62" cy="34" rx="5" ry="3" fill="#5f9a62" />
        </G>
      );
  }
}

// --- постройки ----------------------------------------------------------------------

function Structure({ id, lit }: { id: StructureId; lit: boolean }) {
  switch (id) {
    case "campfire":
      return (
        <G>
          {[
            [26, 74],
            [36, 82],
            [50, 85],
            [64, 82],
            [74, 74],
          ].map(([x, y]) => (
            <Ellipse key={x} cx={x} cy={y} rx="7" ry="5" fill="#80858c" />
          ))}
          <Line x1="30" y1="76" x2="70" y2="62" stroke="#6b4b2e" strokeWidth="8" strokeLinecap="round" />
          <Line x1="30" y1="62" x2="70" y2="76" stroke="#7a5636" strokeWidth="8" strokeLinecap="round" />
          <Path d="M50 18 C66 38 68 52 60 64 C56 70 44 70 40 64 C32 52 34 38 50 18 Z" fill="#e08a55" />
          <Path d="M50 38 C58 48 58 58 53 64 C51 66 49 66 47 64 C42 58 42 48 50 38 Z" fill="#f2c26b" />
          {lit && <Circle cx="64" cy="26" r="2" fill="#f2c26b" />}
        </G>
      );
    case "workbench":
      return (
        <G>
          <Shadow w={34} />
          <Rect x="12" y="38" width="76" height="14" rx="3" fill="#a07a4e" />
          <Rect x="18" y="52" width="9" height="32" fill="#7a5636" />
          <Rect x="73" y="52" width="9" height="32" fill="#7a5636" />
          <Rect x="18" y="68" width="64" height="5" fill="#7a5636" />
          <Rect x="26" y="29" width="18" height="9" rx="2" fill="#8f949b" />
          <Line x1="54" y1="34" x2="76" y2="28" stroke="#6b4b2e" strokeWidth="5" strokeLinecap="round" />
        </G>
      );
    case "fence":
      return (
        <G>
          <Rect x="0" y="42" width="100" height="8" rx="2" fill="#9a7a52" />
          <Rect x="0" y="62" width="100" height="8" rx="2" fill="#9a7a52" />
          {[14, 64].map((x) => (
            <G key={x}>
              <Ellipse cx={x + 11} cy="86" rx="12" ry="4" fill="#000" opacity="0.2" />
              <Polygon points={`${x},30 ${x + 11},20 ${x + 22},30 ${x + 22},86 ${x},86`} fill="#8a6a45" />
            </G>
          ))}
        </G>
      );
    case "house":
      return (
        <G>
          <Ellipse cx="50" cy="92" rx="44" ry="6" fill="#000" opacity="0.25" />
          <Rect x="14" y="46" width="72" height="46" fill="#b08a5a" />
          <Line x1="14" y1="60" x2="86" y2="60" stroke="#9a7650" strokeWidth="2" />
          <Line x1="14" y1="76" x2="86" y2="76" stroke="#9a7650" strokeWidth="2" />
          <Rect x="66" y="12" width="10" height="24" fill="#6b4b2e" />
          <Polygon points="4,50 50,8 96,50" fill="#8e4f3a" />
          <Polygon points="4,50 50,8 50,16 12,50" fill="#a55e46" />
          <Rect x="42" y="64" width="16" height="28" rx="2" fill="#5a3a24" />
          <Circle cx="54" cy="79" r="1.8" fill="#e0a24a" />
          <Rect x="21" y="62" width="14" height="12" fill={lit ? "#f2c26b" : "#3d5566"} />
          <Rect x="65" y="62" width="14" height="12" fill={lit ? "#f2c26b" : "#3d5566"} />
          <Line x1="28" y1="62" x2="28" y2="74" stroke="#6b4b2e" strokeWidth="1.6" />
          <Line x1="72" y1="62" x2="72" y2="74" stroke="#6b4b2e" strokeWidth="1.6" />
        </G>
      );
  }
}

// --- персонаж и свет ----------------------------------------------------------------

/**
 * Персонаж. Смотрит туда, куда шёл: вверх — видна спина с рюкзаком, вбок — профиль.
 * `step` чередуется на каждом шаге и переставляет ноги — так видно, что он идёт.
 */
export const PlayerSprite = memo(function PlayerSprite({ facing, color, step }: { facing: Dir; color: string; step: boolean }) {
  const side = facing === "left" ? -1 : facing === "right" ? 1 : 0;
  const back = facing === "up";
  const legA = step ? 4 : -4;
  return (
    <Svg viewBox="0 0 100 100" width="100%" height="100%">
      <Ellipse cx="50" cy="90" rx="20" ry="6" fill="#000" opacity="0.28" />
      <Rect x={40 + legA / 2} y="72" width="8" height="16" rx="3" fill="#3d4450" />
      <Rect x={52 - legA / 2} y="72" width="8" height="16" rx="3" fill="#3d4450" />
      {back && <Rect x="34" y="46" width="32" height="26" rx="8" fill="#7a5636" />}
      <Rect x="32" y="46" width="36" height="32" rx="13" fill={color} />
      {!back && side !== 0 && <Rect x={side > 0 ? 30 : 58} y="50" width="12" height="20" rx="5" fill="#7a5636" />}
      <Circle cx={50 + side * 2} cy="32" r="17" fill="#e3cdb0" />
      <Path d={`M${33 + side * 2} 30 C${35 + side * 2} 12 ${65 + side * 2} 12 ${67 + side * 2} 30 C${60 + side * 2} 24 ${40 + side * 2} 24 ${33 + side * 2} 30 Z`} fill="#5a3a24" />
      {back ? (
        <Path d="M33 32 C34 20 66 20 67 32 C60 40 40 40 33 32 Z" fill="#5a3a24" />
      ) : side === 0 ? (
        <G>
          <Circle cx="43" cy="35" r="2.6" fill="#2a2a2a" />
          <Circle cx="57" cy="35" r="2.6" fill="#2a2a2a" />
          <Path d="M45 42 Q50 45 55 42" stroke="#b0876a" strokeWidth="2" fill="none" strokeLinecap="round" />
        </G>
      ) : (
        <Circle cx={50 + side * 9} cy="35" r="2.6" fill="#2a2a2a" />
      )}
    </Svg>
  );
});

/** Тёплый свет костра и окон ночью — поверх темноты. */
export const Glow = memo(function Glow({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="glow" cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#f2c26b" stopOpacity="0.38" />
          <Stop offset="0.45" stopColor="#e08a55" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#e08a55" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill="url(#glow)" />
    </Svg>
  );
});
