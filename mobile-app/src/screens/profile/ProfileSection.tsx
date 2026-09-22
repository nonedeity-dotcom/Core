import { useState } from "react";
import { View } from "react-native";
import { colors } from "../../theme/colors";
import TabChips from "../../navigation/TabChips";
import { useRewards } from "../../lib/rewards/useRewards";
import PathScreen from "../PathScreen";
import TitlesScreen from "./TitlesScreen";
import CollectionScreen from "./CollectionScreen";

const TABS = ["Путь", "Титулы", "Коллекция"];

/**
 * Раздел «Профиль»: кто ты и что у тебя есть.
 *
 * Три вкладки в порядке от нажитого к купленному. «Путь» — то, что случилось на самом деле
 * и чего не купить; титулы — то же самое, названное словом; коллекция — то, что взято за
 * монеты. Порядок не случайный: первым идёт то, что имеет вес.
 */
export default function ProfileSection() {
  const [tab, setTab] = useState(0);
  const { purse, titles, titleState, closedDays } = useRewards();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TabChips titles={TABS} index={tab} onChange={setTab} />
      {tab === 0 ? (
        <PathScreen />
      ) : purse ? (
        tab === 1 ? (
          <TitlesScreen purse={purse} titles={titles} titleState={titleState} closedDays={closedDays} />
        ) : (
          <CollectionScreen purse={purse} />
        )
      ) : null}
    </View>
  );
}
