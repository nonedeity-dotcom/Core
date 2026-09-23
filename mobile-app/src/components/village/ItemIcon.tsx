import { memo } from "react";
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from "react-native-svg";
import type { ActionIcon } from "../../lib/village/game";

/**
 * Значки вещей «Опушки» — для сумки, быстрой панели и кнопки действия.
 *
 * Рисуются так же, как мир (SVG, те же цвета), только крупнее и без земли под ними: вещь
 * в сумке должна узнаваться с первого взгляда, а не подписью.
 */
export const ItemIcon = memo(function ItemIcon({ id, size = 28 }: { id: ActionIcon; size?: number }) {
  if (!id) return null;
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      {art(id)}
    </Svg>
  );
});

function art(id: Exclude<ActionIcon, null>) {
  switch (id) {
    case "stick":
      return (
        <G>
          <Line x1="20" y1="80" x2="80" y2="20" stroke="#8a6440" strokeWidth="10" strokeLinecap="round" />
          <Line x1="52" y1="48" x2="72" y2="58" stroke="#8a6440" strokeWidth="7" strokeLinecap="round" />
          <Line x1="38" y1="62" x2="32" y2="42" stroke="#7a5636" strokeWidth="6" strokeLinecap="round" />
          <Ellipse cx="70" cy="60" rx="6" ry="4" fill="#5f9a62" />
        </G>
      );
    case "stone":
      return (
        <G>
          <Polygon points="16,70 26,36 52,22 80,34 86,66 58,82" fill="#7c8188" />
          <Polygon points="26,36 52,22 80,34 60,48 36,50" fill="#9ea3aa" />
          <Polygon points="58,82 60,48 80,34 86,66" fill="#6a6f76" />
        </G>
      );
    case "log":
      return (
        <G>
          <Rect x="14" y="34" width="66" height="34" rx="8" fill="#7a5636" />
          <Line x1="24" y1="44" x2="62" y2="44" stroke="#6b4b2e" strokeWidth="3" />
          <Line x1="20" y1="58" x2="56" y2="58" stroke="#6b4b2e" strokeWidth="3" />
          <Ellipse cx="78" cy="51" rx="12" ry="17" fill="#a5845a" />
          <Ellipse cx="78" cy="51" rx="6" ry="9" fill="none" stroke="#8a6a45" strokeWidth="3" />
        </G>
      );
    case "berries":
      return (
        <G>
          <Path d="M50 14 C56 26 64 30 74 30" stroke="#4d8b58" strokeWidth="5" fill="none" strokeLinecap="round" />
          <Ellipse cx="66" cy="24" rx="12" ry="6" fill="#5f9a62" />
          <Circle cx="36" cy="58" r="16" fill="#c9566a" />
          <Circle cx="62" cy="62" r="16" fill="#b44659" />
          <Circle cx="48" cy="40" r="14" fill="#d86a7c" />
          <Circle cx="44" cy="36" r="4" fill="#f2b8c2" />
          <Circle cx="30" cy="52" r="4" fill="#f2b8c2" />
        </G>
      );
    case "axe":
      return (
        <G>
          <Line x1="30" y1="86" x2="66" y2="22" stroke="#8a6440" strokeWidth="9" strokeLinecap="round" />
          <Path d="M56 14 C76 12 90 24 88 44 L70 40 L60 34 Z" fill="#b7bcc3" />
          <Path d="M88 44 C86 34 80 26 72 22" stroke="#e6e8eb" strokeWidth="3" fill="none" />
        </G>
      );
    case "pickaxe":
      return (
        <G>
          <Line x1="30" y1="86" x2="58" y2="28" stroke="#8a6440" strokeWidth="9" strokeLinecap="round" />
          <Path d="M14 34 C34 12 70 10 90 28 C70 22 38 22 14 34 Z" fill="#b7bcc3" stroke="#8f949b" strokeWidth="2" />
        </G>
      );
    case "campfire":
      return (
        <G>
          <Line x1="22" y1="80" x2="78" y2="62" stroke="#6b4b2e" strokeWidth="10" strokeLinecap="round" />
          <Line x1="22" y1="62" x2="78" y2="80" stroke="#7a5636" strokeWidth="10" strokeLinecap="round" />
          <Path d="M50 12 C68 34 70 50 60 64 C56 70 44 70 40 64 C30 50 32 34 50 12 Z" fill="#e08a55" />
          <Path d="M50 34 C59 46 59 56 54 63 C52 65 48 65 46 63 C41 56 41 46 50 34 Z" fill="#f2c26b" />
        </G>
      );
    case "workbench":
      return (
        <G>
          <Rect x="10" y="34" width="80" height="16" rx="3" fill="#a07a4e" />
          <Rect x="16" y="50" width="10" height="36" fill="#7a5636" />
          <Rect x="74" y="50" width="10" height="36" fill="#7a5636" />
          <Rect x="16" y="66" width="68" height="6" fill="#7a5636" />
          <Rect x="28" y="24" width="20" height="10" rx="2" fill="#8f949b" />
          <Line x1="58" y1="30" x2="80" y2="22" stroke="#6b4b2e" strokeWidth="5" strokeLinecap="round" />
        </G>
      );
    case "fence":
      return (
        <G>
          <Rect x="8" y="40" width="84" height="9" rx="2" fill="#9a7a52" />
          <Rect x="8" y="62" width="84" height="9" rx="2" fill="#9a7a52" />
          {[14, 44, 74].map((x) => (
            <Polygon key={x} points={`${x},28 ${x + 6},20 ${x + 12},28 ${x + 12},86 ${x},86`} fill="#8a6a45" />
          ))}
        </G>
      );
    case "house":
      return (
        <G>
          <Rect x="18" y="46" width="64" height="42" fill="#b08a5a" />
          <Polygon points="8,50 50,12 92,50" fill="#8e4f3a" />
          <Rect x="42" y="62" width="16" height="26" fill="#5a3a24" />
          <Rect x="24" y="56" width="12" height="12" fill="#f2c26b" />
          <Rect x="64" y="56" width="12" height="12" fill="#f2c26b" />
          <Rect x="64" y="20" width="10" height="18" fill="#6b4b2e" />
        </G>
      );
    case "sleep":
      return (
        <G>
          <Path d="M62 16 C38 18 22 38 24 60 C26 80 48 92 68 86 C50 82 38 66 40 48 C42 32 50 22 62 16 Z" fill="#f2c26b" />
          <Circle cx="74" cy="30" r="4" fill="#f2c26b" />
          <Circle cx="82" cy="52" r="3" fill="#f2c26b" />
        </G>
      );
    case "water":
      return (
        <G>
          <Path d="M50 12 C62 32 76 46 76 62 C76 78 64 88 50 88 C36 88 24 78 24 62 C24 46 38 32 50 12 Z" fill="#4d7d94" />
          <Path d="M38 62 C38 70 44 76 52 76" stroke="#a9cfe0" strokeWidth="5" fill="none" strokeLinecap="round" />
        </G>
      );
    default:
      return <Circle cx="50" cy="50" r="30" fill="#8b8f98" />;
  }
}
