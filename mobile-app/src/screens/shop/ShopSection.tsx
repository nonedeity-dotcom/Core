import { View } from "react-native";
import { colors } from "../../theme/colors";
import TabbedSection from "../../navigation/TabbedSection";
import { useRewards } from "../../lib/rewards/useRewards";
import ShopScreen from "./ShopScreen";
import WalletScreen from "./WalletScreen";

/**
 * Раздел «Магазин»: что купить и на что.
 *
 * Начисление за прошедшее считается здесь же, в useRewards, — и это единственная причина,
 * по которой хук зовётся в разделе, а не в самом магазине. Разделы взаимно исключают друг
 * друга: одновременно смонтирован только один, поэтому пересчёт никогда не идёт в двух
 * местах сразу.
 */
export default function ShopSection() {
  const { purse } = useRewards();
  if (!purse) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <TabbedSection
      tabs={[
        { title: "Магазин", render: () => <ShopScreen purse={purse} /> },
        { title: "Кошелёк", render: () => <WalletScreen purse={purse} /> },
      ]}
    />
  );
}
