#!/usr/bin/env bash
# Проверка Kotlin виджета без Android SDK.
#
# Android SDK в облачной среде не ставится (dl.google.com закрыт), поэтому настоящая сборка
# нативной части идёт только в CI. Этот скрипт ловит опечатки и ошибки типов раньше:
# компилирует modules/core-widget против заглушек с теми же сигнатурами Android и Expo.
# Заглушки Android — на Java, а не на Kotlin: иначе Kotlin не видит свойства вида
# intent.action и ругается на то, что в настоящем SDK работает.
#
# Запуск из mobile-app/:  bash tools/kotlin-check/check.sh
# Прошло — не значит, что соберётся Gradle (ресурсы, манифест, автолинковка не проверяются).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CACHE="${HOME}/.cache/kotlin-check"
KOTLINC="$CACHE/kotlinc/bin/kotlinc"
if [ ! -x "$KOTLINC" ]; then
  mkdir -p "$CACHE"
  curl -sSL -o "$CACHE/kc.zip" https://github.com/JetBrains/kotlin/releases/download/v1.9.24/kotlin-compiler-1.9.24.zip
  (cd "$CACHE" && unzip -q -o kc.zip)
fi
OUT="$(mktemp -d)"
javac -d "$OUT/j" $(find "$HERE/jstubs" -name "*.java")
"$KOTLINC" -cp "$OUT/j" "$HERE"/stubs/*.kt "$HERE"/../../modules/core-widget/android/src/main/java/expo/modules/corewidget/*.kt -d "$OUT/out.jar" 2>&1 \
  | grep -v "JAVA_TOOL_OPTIONS\|kotlin-stdlib" || true
test -f "$OUT/out.jar" && echo "Kotlin виджета компилируется." || { echo "Не компилируется."; exit 1; }
