import { useState } from "react";
import { View } from "react-native";
import TabChips from "./TabChips";

/**
 * Раздел с вкладками наверху.
 *
 * Навигатора у вкладок больше нет: внизу теперь стоят разделы, и вторая полоса там не
 * помещается, а выносить чужой навигатор наверх — это подпорка ради подпорки. Вкладка
 * здесь — просто выбранный экран, и переключается она тем же чипом, каким в приложении
 * выбирают всё остальное.
 *
 * Уходя со вкладки, экран размонтируется. Это не потеря: данные лежат в кэше запросов и
 * возвращаются мгновенно, а держать в памяти пять экранов ради сохранённой прокрутки —
 * плата не по товару.
 */
export default function TabbedSection({ tabs }: { tabs: { title: string; render: () => React.ReactElement }[] }) {
  const [index, setIndex] = useState(0);
  const current = tabs[Math.min(index, tabs.length - 1)];
  return (
    <View style={{ flex: 1 }}>
      {tabs.length > 1 && <TabChips titles={tabs.map((t) => t.title)} index={index} onChange={setIndex} />}
      <View style={{ flex: 1 }}>{current.render()}</View>
    </View>
  );
}

