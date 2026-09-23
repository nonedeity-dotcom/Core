import { View } from "react-native";
import { colors } from "../../theme/colors";
import TabbedSection from "../../navigation/TabbedSection";
import { useRewards } from "../../lib/rewards/useRewards";
import PathScreen from "../PathScreen";
import TitlesScreen from "./TitlesScreen";
import CollectionScreen from "./CollectionScreen";

/**
 * Раздел «Профиль»: кто ты и что у тебя есть.
 *
 * Три вкладки в порядке от нажитого к купленному. «Путь» — то, что случилось на самом деле
 * и чего не купить; титулы — то же самое, названное словом; коллекция — то, что взято за
 * монеты. Порядок не случайный: первым идёт то, что имеет вес.
 *
 * Титулы считаются один раз и раздаются обеим вкладкам: раньше «Путь» и «Титулы» считали
 * их каждый по-своему, с разной глубиной истории, и показывали разное «за всё время».
 */
export default function ProfileSection() {
  const { purse, titles, titleState, next } = useRewards();
  if (!purse) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <TabbedSection
      tabs={[
        { title: "Путь", render: () => <PathScreen titles={titles} next={next} /> },
        { title: "Титулы", render: () => <TitlesScreen purse={purse} titles={titles} titleState={titleState} /> },
        { title: "Коллекция", render: () => <CollectionScreen purse={purse} /> },
      ]}
    />
  );
}
