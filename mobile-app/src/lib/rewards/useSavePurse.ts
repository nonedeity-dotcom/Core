import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Purse } from "./currency";

/**
 * Одна дорога записи кошелька — для магазина, коллекции, титулов и подсказок в игре.
 *
 * Раньше у каждого из четырёх экранов была своя копия этой записи, и починку гонки пришлось
 * бы вносить в четыре места, одно из которых обязательно забылось бы.
 *
 * Сохранённый кошелёк сразу кладётся в кэш: так покупка видна на экране в тот же кадр, а
 * не после того, как запрос за кошельком сходит в хранилище ещё раз.
 */
export function useSavePurse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: (purse: Purse) => Purse | null) => api.updatePurse(change),
    onSuccess: (saved) => {
      if (saved) qc.setQueryData(["purse"], saved);
    },
  });
}
