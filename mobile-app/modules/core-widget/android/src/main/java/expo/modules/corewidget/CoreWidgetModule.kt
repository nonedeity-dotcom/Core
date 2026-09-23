package expo.modules.corewidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Мост между приложением и виджетом: положить слепок «сегодня» и забрать нажатия.
 *
 * Оба вызова синхронные и дешёвые — это запись и чтение одной строки в SharedPreferences.
 */
class CoreWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CoreWidget")

    // json: { date: "yyyy-MM-dd", habits: [{ id, label, count, target, auto }] }
    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function false
      WidgetStore.saveSnapshot(context, json)
      HabitsWidgetProvider.refreshAll(context)
      true
    }

    // Нажатия с виджета, которых приложение ещё не видело: [{ id, date }], по одному на
    // нажатие. Забираются и сразу стираются.
    Function("takePending") {
      val context = appContext.reactContext ?: return@Function "[]"
      WidgetStore.takePending(context)
    }
  }
}
