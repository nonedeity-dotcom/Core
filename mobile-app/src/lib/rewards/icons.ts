import type { Feather } from "@expo/vector-icons";

/**
 * Иконки привычек и наборы, которыми они продаются.
 *
 * Всё купленное до сих пор жило либо в игре, либо в одном акцентном цвете. Иконка у
 * привычки — первое, что видно каждый день на том экране, ради которого приложение вообще
 * открывают, и это единственная причина, по которой она здесь: косметика, которая
 * попадается на глаза, стоит своих ядер, а та, что лежит в разделе «Награды», — нет.
 *
 * Иконки берутся из Feather, того же набора, что и все остальные значки приложения. Свои
 * картинки означали бы чужой стиль внутри своего и десяток файлов в сборке ради того, чего
 * уже полтысячи штук.
 */

export type IconName = React.ComponentProps<typeof Feather>["name"];

export interface IconPack {
  id: string;
  title: string;
  hint: string;
  cores: number;
  icons: IconName[];
}

/**
 * Первый набор бесплатный и нейтральный.
 *
 * Привычка без иконки ничем не хуже, но выбор из пустоты — это не выбор. Шесть общих
 * значков есть у всех с самого начала, и за них никто не платит.
 */
export const ICON_PACKS: IconPack[] = [
  {
    id: "icons-basic",
    title: "Простые",
    hint: "Нейтральные значки на что угодно",
    cores: 0,
    icons: ["check", "circle", "star", "sun", "moon", "feather"],
  },
  {
    id: "icons-body",
    title: "Тело",
    hint: "Спорт, сон, вода и всё телесное",
    cores: 6,
    icons: ["activity", "heart", "zap", "wind", "droplet", "thermometer"],
  },
  {
    id: "icons-home",
    title: "Дом",
    hint: "Быт и всё, что по хозяйству",
    cores: 6,
    icons: ["home", "coffee", "shopping-bag", "trash-2", "tool", "umbrella"],
  },
  {
    id: "icons-work",
    title: "Работа",
    hint: "Учёба, дела и сосредоточенность",
    cores: 6,
    icons: ["book-open", "edit-3", "briefcase", "monitor", "clock", "target"],
  },
];

export const iconPackById = (id: string): IconPack | null => ICON_PACKS.find((p) => p.id === id) ?? null;

/** Набор свой, если он бесплатный или куплен. */
export const packOpen = (pack: IconPack, owned: string[]): boolean =>
  pack.cores === 0 || owned.includes(pack.id);

/** Все иконки, которыми человек может пользоваться прямо сейчас. */
export const openIcons = (owned: string[]): IconName[] =>
  ICON_PACKS.filter((p) => packOpen(p, owned)).flatMap((p) => p.icons);

/**
 * Годится ли иконка привычке.
 *
 * Проверяется не только при выборе: набор мог приехать из резервной копии, снятой там, где
 * он был куплен. Чужая иконка при этом не отбирается — за неё заплачено, и отнимать
 * купленное из-за переноса на другой телефон было бы странно; проверка нужна там, где
 * выбирают новую.
 */
export const isKnownIcon = (name: string): boolean =>
  ICON_PACKS.some((p) => (p.icons as string[]).includes(name));
