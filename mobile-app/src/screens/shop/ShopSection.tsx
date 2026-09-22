import { useState } from "react";
import { View } from "react-native";
import { colors } from "../../theme/colors";
import TabChips from "../../navigation/TabChips";
import { useRewards } from "../../lib/rewards/useRewards";
import ShopScreen from "./ShopScreen";
import WalletScreen from "./WalletScreen";

const TABS = ["Магазин", "Кошелёк"];

/**
 * Раздел «Магазин»: что купить и на что.
 *
 * Начисление за прошедшее считается здесь же, в useRewards, — и это единственная причина,
 * по которой хук зовётся в разделе, а не в самом магазине. Разделы взаимно исключают друг
 * друга: одновременно смонтирован только один, поэтому пересчёт никогда не идёт в двух
 * местах сразу.
 */
export default function ShopSection() {
  const [tab, setTab] = useState(0);
  const { purse } = useRewards();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TabChips titles={TABS} index={tab} onChange={setTab} />
      {purse && (tab === 0 ? <ShopScreen purse={purse} /> : <WalletScreen purse={purse} />)}
    </View>
  );
}
