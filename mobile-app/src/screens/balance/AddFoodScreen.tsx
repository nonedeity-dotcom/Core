import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { colors } from "../../theme/colors";
import { plural } from "../../lib/plural";
import { todayKey } from "../../lib/date";
import { confirmDestructive, notify } from "../../lib/confirm";
import {
  MEAL_LABELS,
  dishTotals,
  nutritionFor,
  portionsFromGrams,
  UNIT_FORMS,
  UNIT_IN_ONE,
  UNIT_LABELS,
  UNIT_SHORT,
  formatAmount,
  gramsFromPortions,
  recentDishes,
  recentProducts,
  searchDishes,
  searchProducts,
  stepGrams,
  unitOf,
  type Dish,
  type DishItem,
  type FoodProduct,
  type Meal,
  type Unit,
} from "../../lib/balance/food";
import { parseFoodLine } from "../../lib/balance/parse";
import BarcodeScan from "./BarcodeScan";

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
  // Без даты запись уходила в день "" — она не попадала ни в один экран и не находилась
  // никогда. Экран всегда открывают с датой, но цена промаха здесь слишком велика.
  const date = route.params?.date ?? todayKey();
  const meal = route.params?.meal ?? "snack";

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<FoodProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [buildingDish, setBuildingDish] = useState(false);
  // Правка вместо «удалить и завести заново»: опечатка в калорийности иначе тянется во все
  // будущие записи, а исправить её было нечем.
  const [editingProduct, setEditingProduct] = useState<FoodProduct | null>(null);
  const [editingDish, setEditingDish] = useState<Dish | null>(null);
  /** Открыт сканер. */
  const [scanning, setScanning] = useState(false);
  /**
   * Товар со штрихкода, ещё не сохранённый.
   *
   * Отдельно от `editingProduct`, потому что это не правка существующего, а черновик из
   * чужой базы: числа подставлены, но их подтверждают, и до подтверждения в списке
   * продуктов его нет.
   */
  const [draft, setDraft] = useState<Omit<FoodProduct, "id"> | null>(null);

  const { data: products = [] } = useQuery<FoodProduct[]>({
    queryKey: ["foodProducts"],
    queryFn: () => api.getFoodProducts(),
  });
  const { data: dishes = [] } = useQuery<Dish[]>({
    queryKey: ["dishes"],
    queryFn: () => api.getDishes(),
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
    onSuccess: (saved, sent) => {
      qc.invalidateQueries({ queryKey: ["foodProducts"] });
      // Правка блюд их не пересчитывает вручную: они хранят ссылки, а не числа.
      qc.invalidateQueries({ queryKey: ["dishes"] });
      if (sent.id) {
        // После правки возвращаемся к списку: правили продукт, а не собирались есть.
        setEditingProduct(null);
      } else {
        setCreating(false);
        setDraft(null);
        setPicked(saved);
      }
    },
  });

  const removeProduct = useMutation({
    mutationFn: (id: string) => api.removeFoodProduct(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foodProducts"] }),
  });

  const saveDish = useMutation({
    mutationFn: (d: Parameters<typeof api.saveDish>[0]) => api.saveDish(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dishes"] });
      setBuildingDish(false);
      setEditingDish(null);
    },
  });
  const addCatalog = useMutation({
    mutationFn: () => api.addStarterCatalog(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["foodProducts"] });
      qc.invalidateQueries({ queryKey: ["dishes"] });
      notify(
        r.products === 0 && r.dishes === 0 ? "Всё уже на месте" : "Базовый набор добавлен",
        r.products === 0 && r.dishes === 0
          ? "Ни одного нового продукта: они уже есть в списке."
          : `${r.products} ${plural(r.products, ["продукт", "продукта", "продуктов"])} и ${r.dishes} ${plural(
              r.dishes,
              ["блюдо", "блюда", "блюд"],
            )}. Теперь это твои продукты — правь и удаляй как обычные.`,
      );
    },
  });

  const removeDish = useMutation({
    mutationFn: (id: string) => api.removeDish(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dishes"] }),
  });

  /**
   * Набор ложится в дневник по записи на продукт.
   *
   * В отличие от блюда: блюдо — это одна съеденная вещь под своим названием, а набор —
   * просто несколько вещей за один заход, и убирать их надо порознь.
   */
  const addMany = useMutation({
    mutationFn: async (items: DishItem[]) => {
      for (const item of items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) continue;
        const own = unitOf(product);
        await api.addFoodEntry({
          date,
          meal,
          productId: product.id,
          name: product.name,
          grams: item.grams,
          ...(own !== "g" && product.portionG && product.unit
            ? { units: Math.round((item.grams / product.portionG) * 100) / 100, unit: product.unit }
            : {}),
          ...nutritionFor(product, item.grams),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["foodLog"] });
      qc.invalidateQueries({ queryKey: ["foodProducts"] });
      setBuildingDish(false);
      navigation.goBack();
    },
  });

  /** Блюдо ложится в дневник одной записью: добавляли его целиком, значит и убирать целиком. */
  const addDish = (dish: Dish) => {
    const totals = dishTotals(dish, products);
    // Все продукты блюда удалены — считать нечего. Раньше нажатие просто ничего не делало,
    // и это выглядело как сломанная кнопка, а не как объяснимое состояние.
    if (totals.grams <= 0) {
      alertEmptyDish(dish.name);
      return;
    }
    add.mutate({
      date,
      meal,
      productId: "",
      dishId: dish.id,
      name: dish.name,
      grams: totals.grams,
      kcal: totals.kcal,
      protein: totals.protein,
      fat: totals.fat,
      carb: totals.carb,
    });
  };

  if (scanning) {
    return (
      <BarcodeScan
        products={products}
        onExisting={(p) => {
          // Эта пачка уже заведена — сразу к «сколько съел», без второго такого же продукта
          // в списке.
          setScanning(false);
          setPicked(p);
        }}
        onFound={(d) => {
          setScanning(false);
          setDraft(d);
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }

  if (creating || editingProduct || draft) {
    return (
      <ProductForm
        product={editingProduct}
        draft={draft}
        onSave={(p) => saveProduct.mutate(editingProduct ? { ...p, id: editingProduct.id } : p)}
        onCancel={() => {
          setCreating(false);
          setEditingProduct(null);
          setDraft(null);
        }}
      />
    );
  }

  if (buildingDish || editingDish) {
    return (
      <DishForm
        dish={editingDish}
        products={products}
        onSaveDish={(name, items) =>
          saveDish.mutate(editingDish ? { id: editingDish.id, name, items } : { name, items })
        }
        onAddToDiary={(items) => addMany.mutate(items)}
        onCancel={() => {
          setBuildingDish(false);
          setEditingDish(null);
        }}
      />
    );
  }

  if (picked) {
    return (
      <AmountForm
        product={picked}
        meal={meal}
        onBack={() => setPicked(null)}
        onAdd={(grams, units, nutrition) =>
          add.mutate({
            date,
            meal,
            productId: picked.id,
            name: picked.name,
            grams,
            ...(units !== null && picked.unit ? { units, unit: picked.unit } : {}),
            ...nutrition,
          })
        }
      />
    );
  }

  const recent = recentProducts(products);
  const found = searchProducts(products, query);
  // Блюда ищутся наравне с продуктами. Раньше их список показывался только при пустом поле,
  // и «Курица с рисом» не находилась по слову «курица».
  const foundDishes = query.trim() === "" ? recentDishes(dishes) : searchDishes(dishes, query);

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

      {/* Три способа завести то, чего в списке нет, — сразу под поиском.
          Раньше они лежали под всеми продуктами, а их больше сотни: чтобы отсканировать
          пачку, надо было пролистать весь свой холодильник. Иконками в одну строку, а не
          тремя строками с подписями: место наверху экрана дорогое, а подпись под иконкой
          говорит то же самое. «Базовый набор» остался внизу — его нажимают один раз. */}
      <View style={styles.tools}>
        <Tool
          icon="maximize"
          label="штрихкод"
          onPress={() => setScanning(true)}
          hint="Сканировать штрихкод"
        />
        <Tool
          icon="plus"
          label="свой"
          onPress={() => setCreating(true)}
          hint="Завести свой продукт"
        />
        <Tool
          icon="layers"
          label="блюдо"
          onPress={() => setBuildingDish(true)}
          disabled={products.length === 0}
          hint={
            products.length === 0
              ? "Собрать блюдо — сначала заведи продукты"
              : "Собрать блюдо или записать строкой"
          }
        />
      </View>

      {foundDishes.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Блюда</Text>
          {foundDishes.map((d) => {
            const totals = dishTotals(d, products);
            return (
              <Pressable
                key={d.id}
                onPress={() => addDish(d)}
                onLongPress={() =>
                  confirmDestructive(
                    "Удалить блюдо?",
                    `«${d.name}» исчезнет из списка. Записи в дневнике останутся.`,
                    () => removeDish.mutate(d.id),
                    "Удалить",
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={`${d.name}, ${totals.kcal} ккал — добавить целиком`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text style={styles.rowDetail}>
                    {`${totals.grams} г · ${totals.kcal} ккал · Б ${totals.protein} · Ж ${totals.fat} · У ${totals.carb}`}
                    {/* Молча посчитать запеканку без творога — это то же самое, что соврать. */}
                    {totals.missing > 0 ? ` · ${totals.missing} продукт(ов) удалено` : ""}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setEditingDish(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`Изменить блюдо: ${d.name}`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
                >
                  <Feather name="edit-2" size={13} color={colors.textMuted} />
                </Pressable>
                <Feather name="plus" size={16} color={colors.accentGreen} />
              </Pressable>
            );
          })}
        </>
      )}

      {query.trim() === "" && recent.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Часто ем</Text>
          {recent.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              onPress={() => setPicked(p)}
              onEdit={() => setEditingProduct(p)}
              onRemove={() => askRemove(p)}
            />
          ))}
        </>
      )}

      <Text style={styles.sectionLabel}>
        {query.trim() === "" ? "Все продукты" : `Продукты: ${found.length}`}
      </Text>
      {found.length === 0 && (
        <Text style={styles.empty}>
          {products.length === 0
            ? "Пока пусто. Добавь базовый набор кнопкой ниже или заведи первый продукт руками — дальше он будет в один тап."
            : "Ничего не нашлось. Проверь название или заведи новый продукт."}
        </Text>
      )}
      {found.map((p) => (
        <ProductRow
          key={p.id}
          product={p}
          onPress={() => setPicked(p)}
          onEdit={() => setEditingProduct(p)}
          onRemove={() => askRemove(p)}
        />
      ))}


      {/* Числа справочные, и об этом сказано до нажатия, а не после: жирность творога и
          состав хлеба гуляют на десятки процентов, и набор — точка отсчёта, а не истина. */}
      <Pressable
        onPress={() =>
          confirmDestructive(
            "Добавить базовый набор?",
            "Около сорока обычных продуктов и пять блюд из них — крупы, мясо, молочное, овощи, фрукты, масла. " +
              "Числа ориентировочные, по справочникам: у пачки в руках свои, поправь их карандашом. " +
              "Уже заведённое не тронется, добавлять можно хоть каждый день.",
            () => addCatalog.mutate(),
            "Добавить",
            false,
          )
        }
        accessibilityRole="button"
        accessibilityLabel="Добавить базовый набор"
        style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
      >
        <Feather name="download" size={16} color={colors.textMuted} />
        <Text style={styles.addText}>Базовый набор продуктов и блюд</Text>
      </Pressable>

    </ScrollView>
  );

  function alertEmptyDish(name: string) {
    notify(
      "Блюдо осталось без продуктов",
      `Все продукты, из которых собрано «${name}», удалены — считать нечего. Собери его заново или удали долгим нажатием.`,
    );
  }

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
  onEdit,
  onRemove,
}: {
  product: FoodProduct;
  onPress: () => void;
  onEdit: () => void;
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
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Изменить продукт: ${product.name}`}
        hitSlop={8}
        style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
      >
        <Feather name="edit-2" size={13} color={colors.textMuted} />
      </Pressable>
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
  onAdd: (grams: number, units: number | null, nutrition: ReturnType<typeof nutritionFor>) => void;
}) {
  const own = unitOf(product);
  // Считается всё в граммах, но вводится в том, в чём человек думает. Поле держит то, что
  // он набрал; в граммы это переводится тут же и показывается рядом, а не вместо.
  const [inUnits, setInUnits] = useState(own !== "g");
  const [text, setText] = useState(own === "g" ? "100" : "1");
  const typed = Math.max(0, Number(text.replace(",", ".")) || 0);
  const value = inUnits && own !== "g" ? gramsFromPortions(product, typed) : Math.round(typed);
  const nutrition = nutritionFor(product, value);
  const portions = portionsFromGrams(product, value);

  /** Переключение единицы переносит уже набранное количество, а не сбрасывает поле. */
  const switchTo = (units: boolean) => {
    if (units === inUnits) return;
    setText(String(units ? portionsFromGrams(product, value) : value));
    setInUnits(units);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Pressable onPress={onBack} accessibilityRole="button" style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Feather name="chevron-left" size={16} color={colors.textMuted} />
        <Text style={styles.backText}>К списку</Text>
      </Pressable>

      <Text style={styles.pickedName}>{product.name}</Text>
      <Text style={styles.caption}>{`В ${MEAL_LABELS[meal].toLowerCase()}`}</Text>

      <View style={styles.amountCard}>
        <View style={styles.amountHead}>
          <Text style={styles.rowLabel}>Сколько</Text>
          {own !== "g" && (
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => switchTo(true)}
                accessibilityRole="radio"
                accessibilityState={{ selected: inUnits }}
                accessibilityLabel={`Считать в ${UNIT_SHORT[own]}`}
                style={({ pressed }) => [styles.chip, inUnits && styles.chipOn, pressed && styles.pressed]}
              >
                <Text style={[styles.chipText, inUnits && styles.chipTextOn]}>{UNIT_SHORT[own]}</Text>
              </Pressable>
              <Pressable
                onPress={() => switchTo(false)}
                accessibilityRole="radio"
                accessibilityState={{ selected: !inUnits }}
                accessibilityLabel="Считать в граммах"
                style={({ pressed }) => [styles.chip, !inUnits && styles.chipOn, pressed && styles.pressed]}
              >
                <Text style={[styles.chipText, !inUnits && styles.chipTextOn]}>г</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.amountRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="numeric"
            style={styles.amountInput}
            accessibilityLabel={inUnits && own !== "g" ? UNIT_LABELS[own] : "Граммы"}
          />
          <Text style={styles.amountUnit}>{inUnits && own !== "g" ? UNIT_SHORT[own] : "г"}</Text>
        </View>

        {own !== "g" && product.portionG ? (
          <>
            <Text style={styles.rowHint}>
              {inUnits
                ? `Это ${value} г — по ${product.portionG} г в ${UNIT_IN_ONE[own]}`
                : `Это ${portions} ${plural(portions, UNIT_FORMS[own])} по ${product.portionG} г`}
            </Text>
            <View style={styles.chipRow}>
              {(inUnits ? [1, 2, 3] : [50, 100, 150, 200]).map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setText(String(n))}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                >
                  <Text style={styles.chipText}>
                    {inUnits ? `${n} ${UNIT_SHORT[own]}` : `${n} г`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.chipRow}>
            {[50, 100, 150, 200].map((g) => (
              <Pressable
                key={g}
                onPress={() => setText(String(g))}
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
        onPress={() => value > 0 && onAdd(value, own === "g" ? null : portions, nutrition)}
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

/**
 * Набор: несколько продуктов за один заход.
 *
 * Отсюда два выхода. «Добавить в дневник» кладёт каждый продукт отдельной записью — рис и
 * яйца это две съеденные вещи, и убирать их надо порознь. «Сохранить как блюдо» превращает
 * набор в рецепт, который потом добавляется одной кнопкой и одной записью.
 *
 * Сверху — строка. Она не понимает еду вообще: встроенной базы нет, и узнаётся только то,
 * что уже заведено. Разобранное падает сюда же, в набор, где видно построчно, что понято, и
 * всё правится обычными стрелками. Записывать сразу из строки было бы быстрее ровно до
 * первого промаха, а дневник, который тихо записал не то, хуже дневника, который переспросил.
 */
function DishForm({
  dish,
  products,
  onSaveDish,
  onAddToDiary,
  onCancel,
}: {
  dish: Dish | null;
  products: FoodProduct[];
  onSaveDish: (name: string, items: DishItem[]) => void;
  onAddToDiary: (items: DishItem[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(dish?.name ?? "");
  const [items, setItems] = useState<DishItem[]>(dish ? dish.items.map((i) => ({ ...i })) : []);
  const [query, setQuery] = useState("");
  const [line, setLine] = useState("");
  const [misses, setMisses] = useState<string[]>([]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const totals = dishTotals({ id: "draft", name, items }, products);
  const canAdd = items.length > 0;
  const canSave = canAdd && name.trim() !== "";

  const parse = () => {
    const parsed = parseFoodLine(line, products);
    const found = parsed.filter((i) => i.productId !== null && i.grams !== null);
    setItems([...items, ...found.map((i) => ({ productId: i.productId as string, grams: i.grams as number }))]);
    // Непонятое остаётся на экране как есть, а не исчезает: человек должен видеть, что из
    // сказанного не дошло, и дописать это руками.
    setMisses(parsed.filter((i) => i.productId === null || i.grams === null).map((i) => i.raw));
    if (found.length > 0) setLine("");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.pickedName}>{dish ? dish.name : "Набор продуктов"}</Text>
      <Text style={styles.caption}>
        {dish
          ? "Правится рецепт. Уже записанное в дневник не изменится — там свои числа"
          : "Собери, что съел. Дальше — положить в дневник или сохранить блюдом"}
      </Text>

      {/*
        Порядок экрана — это порядок действий: сперва добавить, потом посмотреть, что вышло,
        потом решить, куда это деть.

        Раньше он был перемешан: строкой добавляли вверху, поиском — в самом низу, а между
        ними стоял набор и итог. Два способа сделать одно и то же на разных концах экрана, и
        итог посередине, хотя итог — это конец. Теперь оба способа рядом, набор под ними, а
        обе двери наружу — в самом низу и подписаны тем, что они делают.
      */}
      <Text style={styles.sectionLabel}>Что добавить</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Найти среди своих продуктов…"
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        accessibilityLabel="Поиск продукта для набора"
      />
      {/* Пустой запрос — недавние, а не весь список: восемь случайных продуктов между
          поиском и набором отодвигали набор за край экрана. Того, что ел вчера, обычно
          хватает; остальное находится по названию. */}
      {(query.trim() === "" ? recentProducts(products).slice(0, 4) : searchProducts(products, query).slice(0, 8))
        .map((p) => (
          <Pressable
            key={p.id}
            onPress={() => setItems([...items, { productId: p.id, grams: p.portionG ?? 100 }])}
            accessibilityRole="button"
            accessibilityLabel={`В набор: ${p.name}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{p.name}</Text>
              <Text style={styles.rowDetail}>{`${p.kcal} ккал на 100 г`}</Text>
            </View>
            <Feather name="plus" size={16} color={colors.accentGreen} />
          </Pressable>
        ))}

      <Text style={styles.subLabel}>Или строкой, если продуктов несколько</Text>
      <TextInput
        value={line}
        onChangeText={setLine}
        onSubmitEditing={parse}
        placeholder="400 г риса и 2 яйца"
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        accessibilityLabel="Записать строкой"
      />
      <Pressable
        onPress={parse}
        disabled={line.trim() === ""}
        accessibilityRole="button"
        accessibilityLabel="Разобрать строку"
        style={({ pressed }) => [styles.addRow, line.trim() === "" && styles.rowOff, pressed && styles.pressed]}
      >
        <Feather name="corner-down-left" size={15} color={colors.textMuted} />
        <Text style={styles.addText}>Разобрать</Text>
      </Pressable>
      <Text style={styles.hintUnder}>
        Узнаёт только свои продукты — те, что уже заведены. Единицу можно не называть: «2
        яйца» это две штуки, «400 риса» — четыреста граммов.
      </Text>

      {misses.length > 0 && (
        <View style={styles.missCard}>
          <Text style={styles.missTitle}>Не понял</Text>
          {misses.map((m, i) => (
            <Text key={`${m}-${i}`} style={styles.missLine}>
              {`«${m}»`}
            </Text>
          ))}
          <Text style={styles.rowHint}>
            Либо такого продукта ещё нет в списке, либо не назван вес. Найди его выше по
            названию или заведи отдельно.
          </Text>
        </View>
      )}

      <Text style={styles.sectionLabel}>
        {items.length === 0
          ? "В наборе"
          : `В наборе · ${items.length} ${plural(items.length, ["продукт", "продукта", "продуктов"])}`}
      </Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>Пока пусто. Найди продукт выше или запиши строкой.</Text>
      ) : (
        <>
          {items.map((item, i) => {
            const product = byId.get(item.productId);
            const step = product ? stepGrams(product) : 25;
            const unit = product ? unitOf(product) : "g";
            const amount =
              unit === "g" || !product?.portionG
                ? `${item.grams} г`
                : `${formatAmount(item.grams / product.portionG, unit)} · ${item.grams} г`;
            return (
              <View key={`${item.productId}-${i}`} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{product?.name ?? "Продукт удалён"}</Text>
                  <Text style={styles.rowDetail}>{amount}</Text>
                </View>
                <Pressable
                  onPress={() =>
                    setItems(items.map((x, j) => (j === i ? { ...x, grams: Math.max(1, x.grams - step) } : x)))
                  }
                  accessibilityLabel={`Меньше: ${product?.name ?? ""}`}
                  style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.miniBtnText}>−</Text>
                </Pressable>
                <Pressable
                  onPress={() => setItems(items.map((x, j) => (j === i ? { ...x, grams: x.grams + step } : x)))}
                  accessibilityLabel={`Больше: ${product?.name ?? ""}`}
                  style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.miniBtnText}>+</Text>
                </Pressable>
                <Pressable
                  onPress={() => setItems(items.filter((_, j) => j !== i))}
                  accessibilityLabel={`Убрать: ${product?.name ?? ""}`}
                  style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
                >
                  <Feather name="x" size={13} color={colors.textMuted} />
                </Pressable>
              </View>
            );
          })}
          <View style={styles.previewCard}>
            <Text style={styles.previewKcal}>{totals.kcal}</Text>
            <Text style={styles.previewUnit}>{`ккал · ${totals.grams} г`}</Text>
            <Text style={styles.rowHint}>{`Б ${totals.protein} · Ж ${totals.fat} · У ${totals.carb}`}</Text>
          </View>
        </>
      )}

      {/* Две двери наружу, и подписаны они тем, что делают, а не тем, как называются.
          Дневник первым: набирают чаще ради одного раза, чем ради рецепта. */}
      {!dish && (
        <>
          <Text style={styles.sectionLabel}>Куда это деть</Text>
          <Pressable
            onPress={() => canAdd && onAddToDiary(items)}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel="Добавить набор в дневник"
            style={({ pressed }) => [styles.primaryTight, !canAdd && styles.primaryOff, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>
              {canAdd ? `В дневник · ${totals.kcal} ккал` : "В дневник"}
            </Text>
          </Pressable>
          <Text style={styles.hintUnder}>Каждый продукт ляжет отдельной строкой — можно поправить по одному.</Text>
        </>
      )}

      {/* Имя и кнопка — одним блоком: поле «Название» само по себе не объясняло, зачем оно,
          и стояло в стороне от кнопки, которой оно нужно. */}
      <View style={styles.saveCard}>
        <Text style={styles.saveTitle}>{dish ? "Сохранить изменения" : "Сохранить блюдом"}</Text>
        {!dish && (
          <Text style={styles.rowHint}>Чтобы в следующий раз добавить это одним нажатием.</Text>
        )}
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Например, «Курица с рисом»"
          placeholderTextColor={colors.textMuted}
          style={styles.saveInput}
          accessibilityLabel="Название блюда"
        />
        <Pressable
          onPress={() => canSave && onSaveDish(name.trim(), items)}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Сохранить блюдо"
          style={({ pressed }) => [styles.saveBtn, !canSave && styles.rowOff, pressed && styles.pressed]}
        >
          <Feather name="layers" size={15} color={colors.accentGreen} />
          <Text style={styles.saveBtnText}>Сохранить</Text>
        </Pressable>
        {!canSave && (
          <Text style={styles.rowHint}>
            {items.length === 0 ? "Сначала добавь хотя бы один продукт." : "Осталось придумать название."}
          </Text>
        )}
      </View>

      <Pressable onPress={onCancel} accessibilityRole="button" style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Text style={styles.backText}>Отмена</Text>
      </Pressable>
    </ScrollView>
  );
}


/** Новый продукт: название и четыре числа на 100 г, плюс необязательный вес порции. */
/**
 * Одна из трёх кнопок под поиском.
 *
 * Иконка с подписью в два-три символа: подпись нужна, потому что «прямоугольник со
 * скобками» сам по себе не читается как штрихкод, а полное «Штрихкод с упаковки» в ряд из
 * трёх не влезает. Недоступная кнопка не исчезает, а гаснет и говорит почему — исчезнувшая
 * кнопка выглядит как поломка, а не как условие.
 */
function Tool({
  icon,
  label,
  hint,
  onPress,
  disabled,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.tool, disabled && styles.rowOff, pressed && styles.pressed]}
    >
      <Feather name={icon} size={17} color={colors.textMuted} />
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  );
}

/**
 * Форма продукта: и для своего, и для правки, и для подставленного со штрихкода.
 *
 * `draft` — это найденное в открытой базе, но ещё не сохранённое. Отдельно от `product`,
 * потому что разница видна человеку: правка меняет то, что уже в списке, а черновик — чужие
 * числа, которые он подтверждает своими глазами и упаковкой в руке. Поэтому у черновика
 * своя шапка, а не молчаливо заполненные поля.
 */
function ProductForm({
  product,
  draft,
  onSave,
  onCancel,
}: {
  product: FoodProduct | null;
  draft?: Omit<FoodProduct, "id"> | null;
  onSave: (p: Omit<FoodProduct, "id">) => void;
  onCancel: () => void;
}) {
  // Правка важнее черновика: одновременно их не бывает, но порядок должен быть определён.
  const base = product ?? draft ?? null;
  const show = (v: number | undefined) => (v === undefined || v === 0 ? "" : String(v));
  const [name, setName] = useState(base?.name ?? "");
  const [kcal, setKcal] = useState(show(base?.kcal));
  const [protein, setProtein] = useState(show(base?.protein));
  const [fat, setFat] = useState(show(base?.fat));
  const [carb, setCarb] = useState(show(base?.carb));
  const [portion, setPortion] = useState(show(base?.portionG));
  const [unit, setUnit] = useState<Unit>(base ? unitOf(base) : "g");

  const num = (v: string) => Math.max(0, Number(v.replace(",", ".")) || 0);
  const canSave = name.trim() !== "";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.pickedName}>
        {product ? product.name : draft ? "Нашлось по штрихкоду" : "Свой продукт"}
      </Text>
      <Text style={styles.caption}>
        {product
          ? "Значения на 100 г. Уже записанное в дневник не пересчитается — там свои числа"
          : draft
            ? "Значения на 100 г, из открытой базы. Сверь с упаковкой — там их вносят вручную, и ошибки бывают"
            : "Значения — на 100 граммов"}
      </Text>

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
      </View>

      {/* Рис считают граммами, яйца — штуками, масло — ложками. Переводить «2 яйца» в «110 г»
          должно приложение, а не человек: он знает, сколько съел, а не сколько это весит. */}
      <Text style={styles.sectionLabel}>Чем считать</Text>
      <View style={styles.formCard}>
        <View style={styles.chipRow}>
          {(["g", "piece", "spoon", "portion"] as Unit[]).map((u) => (
            <Pressable
              key={u}
              onPress={() => setUnit(u)}
              accessibilityRole="radio"
              accessibilityState={{ selected: unit === u }}
              accessibilityLabel={`Единица: ${UNIT_LABELS[u]}`}
              style={({ pressed }) => [styles.chip, unit === u && styles.chipOn, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, unit === u && styles.chipTextOn]}>{UNIT_LABELS[u]}</Text>
            </Pressable>
          ))}
        </View>
        {unit === "g" ? (
          <Text style={styles.rowHint}>
            Количество вводится только в граммах. Так считают крупы, мясо, овощи — всё, что
            взвешивают.
          </Text>
        ) : (
          <>
            <Field
              label={`Граммов в одной ${UNIT_IN_ONE[unit]}`}
              value={portion}
              onChange={setPortion}
              unit="г"
            />
            <Text style={styles.rowHint}>
              {`Без этого числа «${
                UNIT_SHORT[unit]
              }» не во что перевести, и останутся одни граммы. Яйцо — около 55 г, столовая ложка масла — около 17 г.`}
            </Text>
          </>
        )}
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
            ...(unit !== "g" && num(portion) > 0
              ? { portionG: num(portion), unit: unit as Exclude<Unit, "g"> }
              : {}),
            // Штрихкод переживает и правку, и подтверждение черновика: по нему вторая
            // такая же пачка найдёт этот продукт, а не заведёт двойника.
            ...(base?.barcode ? { barcode: base.barcode } : {}),
            ...(base?.source ? { source: base.source } : {}),
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
    // Отступ снизу — у самого поля, а не у того, что под ним.
    // Его тут не было, и это не замечалось, пока за каждым полем шла подпись раздела со
    // своим верхним отступом. Стоило поставить под поиск кнопки, а под поиск в блюде —
    // сразу найденное, и оба слиплись с полем вплотную. Поле само отвечает за воздух под
    // собой: тогда за ним можно ставить что угодно.
    marginBottom: 10,
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
  editBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardBorder,
  },
  rowName: { color: colors.text, fontSize: 14 },
  rowDetail: { color: colors.textMuted, fontSize: 11, marginTop: 2, lineHeight: 15 },
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: "500" },
  rowHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  tools: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tool: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    gap: 4,
  },
  toolText: { color: colors.textMuted, fontSize: 11 },
  // Подзаголовок внутри раздела: «или строкой» — это второй способ сделать то же самое,
  // а не новый раздел, и весит он меньше.
  subLabel: { color: colors.textMuted, fontSize: 12, marginTop: 14, marginBottom: 8 },
  // Пояснение под тем, что оно поясняет, — с воздухом сверху, чтобы не липло к кнопке.
  hintUnder: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  primaryTight: {
    backgroundColor: colors.accentGreen,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 20,
    gap: 8,
  },
  saveTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  saveInput: {
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.bg,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    paddingVertical: 12,
  },
  saveBtnText: { color: colors.accentGreen, fontSize: 14, fontWeight: "600" },
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
  rowOff: { opacity: 0.5 },
  miniBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  miniBtnText: { color: colors.text, fontSize: 15, fontWeight: "600" },
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
  missCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    gap: 3,
  },
  missTitle: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  missLine: { color: colors.text, fontSize: 13 },
  amountHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  chipText: { color: colors.textMuted, fontSize: 12 },
  // Тот же выбранный вид, что у чипов в профиле: одинаковые элементы должны выглядеть
  // одинаково в обоих разделах.
  chipOn: { backgroundColor: "rgba(143,184,154,0.12)", borderColor: colors.accentGreen },
  chipTextOn: { color: colors.accentGreen, fontWeight: "600" },
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
