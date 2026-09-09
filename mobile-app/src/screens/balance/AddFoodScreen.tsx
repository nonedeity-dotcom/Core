import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { confirmDestructive } from "../../lib/confirm";
import {
  MEAL_LABELS,
  nutritionFor,
  portionsFromGrams,
  recentProducts,
  searchProducts,
  type FoodProduct,
  type Meal,
} from "../../lib/balance/food";

/**
 * Добавить еду: найти продукт, сказать сколько, положить в дневник.
 *
 * Встроенной базы нет — ищется по своим продуктам, и первый раз каждый из них заводится
 * руками. Поэтому «Часто ем» стоит выше поиска: со второго дня это и есть основной путь,
 * а поле поиска нужно, когда список перерос экран.
 */
export default function AddFoodScreen({
  route,
  navigation,
}: {
  route: { params?: { date?: string; meal?: Meal } };
  navigation: { goBack: () => void };
}) {
  const qc = useQueryClient();
  const date = route.params?.date ?? "";
  const meal = route.params?.meal ?? "snack";

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<FoodProduct | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: products = [] } = useQuery<FoodProduct[]>({
    queryKey: ["foodProducts"],
    queryFn: () => api.getFoodProducts(),
  });

  const add = useMutation({
    mutationFn: (entry: Parameters<typeof api.addFoodEntry>[0]) => api.addFoodEntry(entry),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["foodLog"] });
      qc.invalidateQueries({ queryKey: ["foodProducts"] });
      navigation.goBack();
    },
  });

  const saveProduct = useMutation({
    mutationFn: (p: Omit<FoodProduct, "id"> & { id?: string }) => api.saveFoodProduct(p),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["foodProducts"] });
      setCreating(false);
      setPicked(saved);
    },
  });

  const removeProduct = useMutation({
    mutationFn: (id: string) => api.removeFoodProduct(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foodProducts"] }),
  });

  if (creating) {
    return <ProductForm onSave={(p) => saveProduct.mutate(p)} onCancel={() => setCreating(false)} />;
  }

  if (picked) {
    return (
      <AmountForm
        product={picked}
        meal={meal}
        onBack={() => setPicked(null)}
        onAdd={(grams, nutrition) =>
          add.mutate({ date, meal, productId: picked.id, name: picked.name, grams, ...nutrition })
        }
      />
    );
  }

  const recent = recentProducts(products);
  const found = searchProducts(products, query);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.caption}>{`В ${MEAL_LABELS[meal].toLowerCase()}`}</Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Найти среди своих продуктов…"
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        accessibilityLabel="Поиск продукта"
      />

      {query.trim() === "" && recent.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Часто ем</Text>
          {recent.map((p) => (
            <ProductRow key={p.id} product={p} onPress={() => setPicked(p)} onRemove={() => askRemove(p)} />
          ))}
        </>
      )}

      <Text style={styles.sectionLabel}>
        {query.trim() === "" ? "Все продукты" : `Найдено: ${found.length}`}
      </Text>
      {found.length === 0 && (
        <Text style={styles.empty}>
          {products.length === 0
            ? "Пока пусто. Заведи первый продукт — дальше он будет в один тап."
            : "Ничего не нашлось. Проверь название или заведи новый продукт."}
        </Text>
      )}
      {found.map((p) => (
        <ProductRow key={p.id} product={p} onPress={() => setPicked(p)} onRemove={() => askRemove(p)} />
      ))}

      <Pressable
        onPress={() => setCreating(true)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
      >
        <Feather name="plus" size={16} color={colors.textMuted} />
        <Text style={styles.addText}>Свой продукт</Text>
      </Pressable>
    </ScrollView>
  );

  function askRemove(p: FoodProduct) {
    confirmDestructive(
      "Удалить продукт?",
      `«${p.name}» исчезнет из списка. Записи в дневнике останутся — они хранят свои числа.`,
      () => removeProduct.mutate(p.id),
      "Удалить",
    );
  }
}

function ProductRow({
  product,
  onPress,
  onRemove,
}: {
  product: FoodProduct;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onRemove}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${product.kcal} ккал на 100 г`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.rowDetail}>
          {`${product.kcal} ккал · Б ${product.protein} · Ж ${product.fat} · У ${product.carb} — на 100 г`}
          {product.portionG ? ` · порция ${product.portionG} г` : ""}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

/**
 * Сколько съедено.
 *
 * Граммы — всегда, порции — только если у продукта задан вес порции. Пересчёт живой: число
 * калорий меняется под пальцем, потому что «180 г» само по себе ничего не значит, а «204
 * ккал» значит.
 */
function AmountForm({
  product,
  meal,
  onBack,
  onAdd,
}: {
  product: FoodProduct;
  meal: Meal;
  onBack: () => void;
  onAdd: (grams: number, nutrition: ReturnType<typeof nutritionFor>) => void;
}) {
  const [grams, setGrams] = useState(String(product.portionG ?? 100));
  const value = Math.max(0, Math.round(Number(grams.replace(",", ".")) || 0));
  const nutrition = nutritionFor(product, value);
  const portions = portionsFromGrams(product, value);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Pressable onPress={onBack} accessibilityRole="button" style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Feather name="chevron-left" size={16} color={colors.textMuted} />
        <Text style={styles.backText}>К списку</Text>
      </Pressable>

      <Text style={styles.pickedName}>{product.name}</Text>
      <Text style={styles.caption}>{`В ${MEAL_LABELS[meal].toLowerCase()}`}</Text>

      <View style={styles.amountCard}>
        <Text style={styles.rowLabel}>Сколько</Text>
        <View style={styles.amountRow}>
          <TextInput
            value={grams}
            onChangeText={setGrams}
            keyboardType="numeric"
            style={styles.amountInput}
            accessibilityLabel="Граммы"
          />
          <Text style={styles.amountUnit}>г</Text>
        </View>

        {product.portionG ? (
          <>
            <Text style={styles.rowHint}>{`Это ${portions} ${portions === 1 ? "порция" : "порции"} по ${product.portionG} г`}</Text>
            <View style={styles.chipRow}>
              {[0.5, 1, 1.5, 2].map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setGrams(String(Math.round(p * (product.portionG ?? 0))))}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                >
                  <Text style={styles.chipText}>{`${p} порц.`}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.chipRow}>
            {[50, 100, 150, 200].map((g) => (
              <Pressable
                key={g}
                onPress={() => setGrams(String(g))}
                accessibilityRole="button"
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              >
                <Text style={styles.chipText}>{`${g} г`}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={styles.previewCard}>
        <Text style={styles.previewKcal}>{nutrition.kcal}</Text>
        <Text style={styles.previewUnit}>ккал</Text>
        <Text style={styles.rowHint}>{`Б ${nutrition.protein} · Ж ${nutrition.fat} · У ${nutrition.carb}`}</Text>
      </View>

      <Pressable
        onPress={() => value > 0 && onAdd(value, nutrition)}
        disabled={value <= 0}
        accessibilityRole="button"
        accessibilityLabel="Добавить в дневник"
        style={({ pressed }) => [styles.primary, value <= 0 && styles.primaryOff, pressed && styles.pressed]}
      >
        <Text style={styles.primaryText}>Добавить</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Новый продукт: название и четыре числа на 100 г, плюс необязательный вес порции. */
function ProductForm({
  onSave,
  onCancel,
}: {
  onSave: (p: Omit<FoodProduct, "id">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [carb, setCarb] = useState("");
  const [portion, setPortion] = useState("");

  const num = (v: string) => Math.max(0, Number(v.replace(",", ".")) || 0);
  const canSave = name.trim() !== "";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.pickedName}>Свой продукт</Text>
      <Text style={styles.caption}>Значения — на 100 граммов</Text>

      <View style={styles.formCard}>
        <TextInput
          value={name}
          onChangeText={setName}
          autoFocus
          placeholder="Название"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          accessibilityLabel="Название продукта"
        />
        <Field label="Калории" value={kcal} onChange={setKcal} unit="ккал" />
        <Field label="Белки" value={protein} onChange={setProtein} unit="г" />
        <Field label="Жиры" value={fat} onChange={setFat} unit="г" />
        <Field label="Углеводы" value={carb} onChange={setCarb} unit="г" />
        <Field label="Вес порции" value={portion} onChange={setPortion} unit="г" optional />
        <Text style={styles.rowHint}>
          Вес порции необязателен. Если задать — можно будет вводить «1.5 порции» вместо
          граммов.
        </Text>
      </View>

      <Pressable
        onPress={() =>
          canSave &&
          onSave({
            name: name.trim(),
            kcal: num(kcal),
            protein: num(protein),
            fat: num(fat),
            carb: num(carb),
            ...(num(portion) > 0 ? { portionG: num(portion) } : {}),
          })
        }
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityLabel="Сохранить продукт"
        style={({ pressed }) => [styles.primary, !canSave && styles.primaryOff, pressed && styles.pressed]}
      >
        <Text style={styles.primaryText}>Сохранить</Text>
      </Pressable>
      <Pressable onPress={onCancel} accessibilityRole="button" style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Text style={styles.backText}>Отмена</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  unit,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  optional?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{optional ? `${label} · необязательно` : label}</Text>
      <View style={styles.fieldInputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          style={styles.fieldInput}
          accessibilityLabel={label}
        />
        <Text style={styles.fieldUnit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  caption: { color: colors.textMuted, fontSize: 12, marginBottom: 12 },
  sectionLabel: { color: colors.textMuted, fontSize: 12, marginTop: 16, marginBottom: 8 },
  empty: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  search: {
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 6,
  },
  pressed: { opacity: 0.75 },
  rowName: { color: colors.text, fontSize: 14 },
  rowDetail: { color: colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 15 },
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: "500" },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  addText: { color: colors.textMuted, fontSize: 13 },
  back: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 8 },
  backText: { color: colors.textMuted, fontSize: 13 },
  pickedName: { color: colors.text, fontSize: 20, fontWeight: "600", marginTop: 4 },
  amountCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  amountRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  amountInput: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    minWidth: 90,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  amountUnit: { color: colors.textMuted, fontSize: 14, paddingBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  chipText: { color: colors.textMuted, fontSize: 12 },
  previewCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
    gap: 2,
  },
  previewKcal: { color: colors.accentGreen, fontSize: 34, fontWeight: "700" },
  previewUnit: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  primary: {
    backgroundColor: colors.accentGreen,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: colors.bg, fontSize: 15, fontWeight: "700" },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  input: {
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  field: { flexDirection: "row", alignItems: "center", gap: 12 },
  fieldLabel: { color: colors.textMuted, fontSize: 13, flex: 1 },
  fieldInputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldInput: {
    color: colors.text,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 78,
    textAlign: "right",
  },
  fieldUnit: { color: colors.textMuted, fontSize: 12, minWidth: 26 },
});
