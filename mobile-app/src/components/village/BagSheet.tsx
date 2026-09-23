import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { ItemIcon } from "./ItemIcon";
import { ITEMS, RECIPES, STRUCTURES, type ItemId } from "../../lib/village/content";
import { canCraft, near, type VillageState } from "../../lib/village/game";

type Tab = "items" | "craft";

/**
 * Сумка: что есть и что из этого сделать.
 *
 * Две вкладки, а не один длинный список: вещи смотрят часто и мельком, а ремесло — когда
 * уже решил что-то делать. Вещи — плитками со значками, как в любой игре: по картинке
 * находишь быстрее, чем по слову. В рецепте у каждого ингредиента своя цифра «есть / нужно»
 * и цвет — видно, чего именно не хватает, а не просто «мало».
 */
export default function BagSheet({
  state,
  side,
  onClose,
  onEat,
  onPlace,
  onCraft,
}: {
  state: VillageState;
  /** Горизонтально — панель справа, вертикально — снизу. */
  side: boolean;
  onClose: () => void;
  onEat: (id: ItemId) => void;
  onPlace: (id: ItemId) => void;
  onCraft: (recipeId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("items");
  const [picked, setPicked] = useState<ItemId | null>(null);
  const items = (Object.entries(state.bag) as [ItemId, number][]).filter(([, n]) => n > 0);
  const chosen = picked && (state.bag[picked] ?? 0) > 0 ? picked : null;
  const craftable = RECIPES.filter((r) => canCraft(state, r).ok).length;

  return (
    <>
    {/* Затемнение позади: видно, что игра под сумкой стоит, и нажатие мимо закрывает её. */}
    <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть сумку" />
    <View style={[styles.sheet, side ? styles.sheetSide : styles.sheetBottom]}>
      <View style={styles.head}>
        <View style={styles.tabs}>
          <TabButton on={tab === "items"} label="Вещи" icon="briefcase" onPress={() => setTab("items")} />
          <TabButton
            on={tab === "craft"}
            label="Ремесло"
            icon="tool"
            badge={craftable > 0 ? String(craftable) : undefined}
            onPress={() => setTab("craft")}
          />
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть" hitSlop={12} style={styles.close}>
          <Feather name="x" size={20} color={colors.text} />
        </Pressable>
      </View>

      {tab === "items" ? (
        <>
          <ScrollView contentContainerStyle={styles.grid}>
            {items.length === 0 ? (
              <Text style={styles.empty}>Пусто. Наступи на ветки и камешки на поляне — они сами лягут в сумку.</Text>
            ) : (
              items.map(([id, n]) => (
                <Pressable
                  key={id}
                  onPress={() => setPicked(id === chosen ? null : id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${ITEMS[id].name}: ${n}`}
                  style={({ pressed }) => [styles.tile, id === chosen && styles.tileOn, pressed && styles.pressed]}
                >
                  <ItemIcon id={id} size={36} />
                  <Text style={styles.tileName} numberOfLines={1}>
                    {ITEMS[id].name}
                  </Text>
                  {!ITEMS[id].tool && (
                    <View style={styles.count}>
                      <Text style={styles.countText}>{n}</Text>
                    </View>
                  )}
                </Pressable>
              ))
            )}
          </ScrollView>
          {chosen ? (
            <View style={styles.detail}>
              <ItemIcon id={chosen} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.detailName}>{ITEMS[chosen].name}</Text>
                <Text style={styles.detailHint}>{ITEMS[chosen].hint}</Text>
              </View>
              {ITEMS[chosen].food !== undefined && <SheetButton label="Съесть" onPress={() => onEat(chosen)} />}
              {ITEMS[chosen].places && <SheetButton label="Поставить" onPress={() => onPlace(chosen)} />}
            </View>
          ) : (
            items.length > 0 && <Text style={styles.footnote}>Нажми на вещь — там можно съесть или поставить.</Text>
          )}
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {RECIPES.map((recipe) => {
            const check = canCraft(state, recipe);
            const owned = ITEMS[recipe.makes].tool && (state.bag[recipe.makes] ?? 0) > 0;
            return (
              <View key={recipe.id} style={[styles.recipe, check.ok && styles.recipeReady]}>
                <View style={styles.recipeIcon}>
                  <ItemIcon id={recipe.makes} size={38} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[styles.recipeName, owned && styles.muted]}>
                    {recipe.count > 1 ? `${ITEMS[recipe.makes].name} × ${recipe.count}` : ITEMS[recipe.makes].name}
                  </Text>
                  <View style={styles.needs}>
                    {(Object.entries(recipe.needs) as [ItemId, number][]).map(([id, need]) => {
                      const have = state.bag[id] ?? 0;
                      const enough = have >= need;
                      return (
                        <View key={id} style={styles.need}>
                          <ItemIcon id={id} size={16} />
                          <Text style={[styles.needText, enough ? styles.enough : styles.short]}>{`${Math.min(have, 99)}/${need}`}</Text>
                        </View>
                      );
                    })}
                    {recipe.at && (
                      <View style={[styles.need, near(state, recipe.at) ? styles.stationOn : styles.stationOff]}>
                        <Feather name="map-pin" size={11} color={near(state, recipe.at) ? colors.accentGreen : colors.textMuted} />
                        <Text style={[styles.needText, near(state, recipe.at) ? styles.enough : styles.muted]}>
                          {STRUCTURES[recipe.at].near}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                {owned ? (
                  <Feather name="check" size={18} color={colors.accentGreen} />
                ) : (
                  <SheetButton label="Сделать" disabled={!check.ok} onPress={() => onCraft(recipe.id)} />
                )}
              </View>
            );
          })}
          <Text style={styles.footnote}>Постройку ставят из «Вещей» — на клетку, к которой ты повернулся.</Text>
        </ScrollView>
      )}
    </View>
    </>
  );
}

function TabButton({
  on,
  label,
  icon,
  badge,
  onPress,
}: {
  on: boolean;
  label: string;
  icon: "briefcase" | "tool";
  badge?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      style={[styles.tab, on && styles.tabOn]}
    >
      <Feather name={icon} size={14} color={on ? colors.bg : colors.textMuted} />
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
      {badge && (
        <View style={[styles.tabBadge, on && styles.tabBadgeOn]}>
          <Text style={styles.tabBadgeText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

function SheetButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, disabled && styles.buttonOff, pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, disabled && styles.muted]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute",
    backgroundColor: colors.bg,
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  sheetBottom: { left: 0, right: 0, bottom: 0, top: "36%", borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1 },
  sheetSide: { right: 0, top: 0, bottom: 0, width: "46%", borderLeftWidth: 1, borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  pressed: { opacity: 0.7 },
  muted: { color: colors.textMuted },

  head: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  tabs: { flex: 1, flexDirection: "row", gap: 8 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.card,
  },
  tabOn: { backgroundColor: colors.accentGreen },
  tabText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  tabTextOn: { color: colors.bg },
  tabBadge: { backgroundColor: colors.accent, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tabBadgeOn: { backgroundColor: colors.bg },
  tabBadgeText: { color: colors.text, fontSize: 10, fontWeight: "800" },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 12 },
  empty: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  tile: {
    width: 76,
    height: 80,
    borderRadius: 14,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  tileOn: { borderColor: colors.accentGreen },
  tileName: { color: colors.textMuted, fontSize: 10, maxWidth: 70 },
  count: {
    position: "absolute",
    top: 5,
    right: 5,
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: colors.text, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },

  detail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
  },
  detailName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  detailHint: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },

  list: { gap: 8, paddingBottom: 20 },
  recipe: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  recipeReady: { borderColor: "rgba(143,184,154,0.4)" },
  recipeIcon: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  recipeName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  needs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  need: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  needText: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  enough: { color: colors.accentGreen },
  short: { color: colors.accent },
  stationOn: { borderWidth: 1, borderColor: "rgba(143,184,154,0.4)" },
  stationOff: { borderWidth: 1, borderColor: colors.cardBorder },

  button: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.accentGreen },
  buttonOff: { backgroundColor: colors.cardBorder },
  buttonText: { color: colors.bg, fontSize: 13, fontWeight: "700" },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4, marginBottom: 12 },
});
