import { eq, ok, test } from "./harness";
import { REACHED_KG, forecast, maintenance, plateauWeight, requiredIntake } from "../src/lib/balance/forecast";
import type { Profile } from "../src/lib/balance/profile";

const me: Profile = { sex: "male", age: 20, heightCm: 180, weightKg: 65, activity: "moderate", goal: "gain" } as Profile;

test("уже на месте", () => {
  eq("ближе порога", forecast({ profile: me, targetWeightKg: 65 + REACHED_KG / 2, intakeKcal: null }).kind, "already");
});

test("по норме — доходит", () => {
  const f = forecast({ profile: me, targetWeightKg: 70, intakeKcal: null });
  eq("вид", f.kind, "reach");
  if (f.kind === "reach") {
    ok("за разумный срок", f.days > 30 && f.days < 400);
    ok("и в плюс", f.rateKgPerWeek > 0);
  }
});

test("по факту — потолок", () => {
  const food = maintenance(me) + 300;
  const ceiling = plateauWeight(me, food);
  ok("потолок выше нынешнего веса", ceiling > me.weightKg);
  const f = forecast({ profile: me, targetWeightKg: ceiling + 3, intakeKcal: food });
  eq("за потолок не пройти", f.kind, "stalls");
  if (f.kind === "stalls") eq("и назван сам потолок", f.plateauKg, ceiling);
});

test("еда ниже расхода при наборе — не туда", () => {
  eq("вид", forecast({ profile: me, targetWeightKg: 70, intakeKcal: maintenance(me) - 200 }).kind, "wrong-way");
});

test("потолок — это вес, где расход равен еде", () => {
  const food = 3000;
  const w = plateauWeight(me, food);
  ok("расход на потолке ≈ еде", Math.abs(maintenance({ ...me, weightKg: w }) - food) < 20);
});

test("сколько есть, чтобы успеть к сроку", () => {
  const kcal = requiredIntake(me, 68, 120);
  ok("нашлось", kcal !== null);
  if (kcal !== null) {
    const f = forecast({ profile: me, targetWeightKg: 68, intakeKcal: kcal });
    ok("и с этой едой доходит примерно в срок", f.kind === "reach" && Math.abs(f.days - 120) <= 3);
  }
  eq("срок прошёл — не считаем", requiredIntake(me, 68, 0), null);
});
