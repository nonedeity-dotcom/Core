# Core — заметки для Claude

Перед работой прочитай **`docs/JOURNAL.md`**: там устройство приложения, договорённости
с владельцем, хроника изменений, отложенное и грабли. После заметного изменения —
допиши туда запись.

Самое важное вкратце:
- Приложение — `mobile-app/` (Expo 51, RN 0.74, TS), всё локально, без сервера.
- Каждый коммит пушится в обе ветки: `claude/tracker-app-demo-8eowpg` (её собирает CI)
  и `claude/balance`.
- Когда сборка готова — самому прислать ссылку:
  `https://github.com/nonedeity-dotcom/Core/releases/download/android-build-N/app-release.apk`
- Перед пушем: `cd mobile-app && npx tsc --noEmit && npm test`.
- Общение по-русски, простыми словами.
