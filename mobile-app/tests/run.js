/*
 * Прогон всех проверок: tsc собирает их в tests/.out, этот файл по очереди подключает
 * каждый *.test.js и печатает итог. Код выхода не ноль, если хоть что-то не сошлось, —
 * чтобы проверку можно было поставить в сборку и она там не молчала.
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, ".out", "tests");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();
for (const f of files) {
  console.log(f.replace(".test.js", ""));
  require(path.join(dir, f));
}
const { summary } = require(path.join(dir, "harness.js"));
const { passed, failed } = summary();
console.log(failed === 0 ? `\nВсё сошлось: ${passed}.` : `\nНе сошлось: ${failed} из ${passed + failed}.`);
process.exit(failed === 0 ? 0 : 1);
