import { useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { lookupBarcode } from "../../integrations/foodFacts";
import { isBarcode, toProduct, type ScannedProduct } from "../../lib/balance/openfoodfacts";
import type { FoodProduct } from "../../lib/balance/food";

/**
 * Штрихкод с пачки вместо ввода руками.
 *
 * Числа приезжают из Open Food Facts — открытой базы, которую заполняют сами люди, снимая
 * этикетки. Поэтому найденное здесь никогда не сохраняется молча: экран показывает, что
 * нашлось, и дальше человек это подтверждает и правит. Автоматическая запись чужих чисел в
 * дневник была бы ровно тем, чего в такой базе делать нельзя.
 *
 * Три пути наружу, и все три нужны:
 * - код нашёлся и такой продукт уже есть — открыть его, а не заводить двойника;
 * - код нашёлся впервые — открыть форму с подставленными числами;
 * - камеры нет, код стёрт, интернета нет — ввести цифры под полосками руками.
 */

type Props = {
  products: FoodProduct[];
  /** Такой штрихкод уже заведён — берём готовый продукт. */
  onExisting: (product: FoodProduct) => void;
  /** Новый товар: числа подставлены, но их ещё подтверждают. */
  onFound: (draft: Omit<FoodProduct, "id">, scanned: ScannedProduct) => void;
  onCancel: () => void;
};

type Stage =
  | { kind: "idle" }
  | { kind: "looking"; barcode: string }
  | { kind: "failed"; barcode: string; text: string };

const FAILURE_TEXT: Record<string, string> = {
  "not-found": "Такого кода нет в базе. Это обычное дело для местных марок — заведи продукт руками, с упаковки.",
  "no-nutrition": "Товар в базе есть, но состав никто не заполнил. Числа придётся взять с упаковки.",
  "no-name": "У товара в базе нет названия — по такой записи его потом не узнать. Заведи руками.",
  offline: "Не вышло дозвониться до базы. Проверь интернет или введи числа с упаковки.",
};

export default function BarcodeScan({ products, onExisting, onFound, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [manual, setManual] = useState("");
  /**
   * Камера присылает один и тот же код десятки раз в секунду, пока он в кадре.
   * Без замка это десятки запросов за один поднос пачки.
   */
  const busy = useRef(false);

  const look = async (barcode: string) => {
    if (busy.current) return;
    busy.current = true;
    setStage({ kind: "looking", barcode });

    const known = products.find((p) => p.barcode === barcode);
    if (known) {
      busy.current = false;
      onExisting(known);
      return;
    }

    const res = await lookupBarcode(barcode);
    busy.current = false;
    if (res.status === "ok") {
      onFound(toProduct(res.product), res.product);
      return;
    }
    const reason = res.status === "offline" ? "offline" : res.reason;
    setStage({ kind: "failed", barcode, text: FAILURE_TEXT[reason] ?? FAILURE_TEXT.offline });
  };

  const submitManual = () => {
    const code = manual.trim();
    if (isBarcode(code)) void look(code);
  };

  if (stage.kind === "looking") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.centerText}>{`Ищу ${stage.barcode}…`}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Камера — основной путь, но не единственный: без разрешения и в вебе её нет вовсе,
          и экран обязан оставаться рабочим. */}
      {permission?.granted ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
            onBarcodeScanned={({ data }) => {
              if (isBarcode(data)) void look(data.trim());
            }}
          />
          <View pointerEvents="none" style={styles.frame} />
        </View>
      ) : (
        <View style={styles.noCamera}>
          <Feather name="camera-off" size={20} color={colors.textMuted} />
          <Text style={styles.noCameraText}>
            {permission && !permission.canAskAgain
              ? "Доступ к камере запрещён. Его можно вернуть в настройках телефона, а пока — введи цифры под полосками."
              : "Наведи камеру на штрихкод — или введи цифры под полосками руками."}
          </Text>
          {permission?.canAskAgain !== false && (
            <Pressable
              onPress={() => void requestPermission()}
              accessibilityRole="button"
              accessibilityLabel="Разрешить камеру"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Разрешить камеру</Text>
            </Pressable>
          )}
        </View>
      )}

      {stage.kind === "failed" && (
        <View style={styles.failCard}>
          <Text style={styles.failCode}>{stage.barcode}</Text>
          <Text style={styles.failText}>{stage.text}</Text>
        </View>
      )}

      <Text style={styles.sectionLabel}>Или цифрами</Text>
      <View style={styles.manualRow}>
        <TextInput
          value={manual}
          onChangeText={setManual}
          keyboardType="number-pad"
          placeholder="4600699500094"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          accessibilityLabel="Штрихкод цифрами"
        />
        <Pressable
          onPress={submitManual}
          disabled={!isBarcode(manual)}
          accessibilityRole="button"
          accessibilityLabel="Найти по штрихкоду"
          style={({ pressed }) => [
            styles.go,
            !isBarcode(manual) && styles.goOff,
            pressed && styles.pressed,
          ]}
        >
          <Feather name="search" size={16} color={colors.bg} />
        </Pressable>
      </View>

      <Text style={styles.note}>
        Числа приходят из Open Food Facts — открытой базы, куда их вносят такие же люди со
        своих упаковок. Ошибиться там может любой, поэтому найденное показывается на проверку,
        а не пишется в дневник само.
      </Text>

      <Pressable onPress={onCancel} accessibilityRole="button" style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Text style={styles.backText}>Отмена</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: 12 },
  centerText: { color: colors.textMuted, fontSize: 13 },
  cameraWrap: {
    height: 260,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#000",
    marginBottom: 16,
  },
  frame: {
    position: "absolute",
    left: "10%",
    right: "10%",
    top: "28%",
    bottom: "28%",
    borderWidth: 2,
    borderColor: colors.accentGreen,
    borderRadius: 10,
  },
  noCamera: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 16,
  },
  noCameraText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  secondary: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  secondaryText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  failCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  failCode: { color: colors.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  failText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  manualRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  go: {
    backgroundColor: colors.accentGreen,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  goOff: { opacity: 0.4 },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 16 },
  back: { alignItems: "center", paddingVertical: 14, marginTop: "auto" },
  backText: { color: colors.textMuted, fontSize: 14 },
  pressed: { opacity: 0.75 },
});
