package expo.modules.corewidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Виджет «Сегодня»: привычки из «Ввожу сейчас», и каждую можно отметить прямо с рабочего
 * стола.
 *
 * Нажатие не пишет в хранилище приложения — туда отсюда не достать. Оно встаёт в очередь
 * (WidgetStore), виджет сразу рисует его отмеченным, а приложение при следующем открытии
 * забирает очередь и отмечает у себя так же, как отметил бы палец в чек-листе.
 */
class HabitsWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    val views = WidgetRender.build(context)
    for (id in appWidgetIds) appWidgetManager.updateAppWidget(id, views)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action != ACTION_TAP) return
    val habitId = intent.getStringExtra(EXTRA_HABIT) ?: return
    // Проверка по тому, что виджет показывает сейчас: два быстрых нажатия на привычку «один
    // раз в день» не должны встать в очередь дважды.
    val row = WidgetRender.rows(context)?.firstOrNull { it.id == habitId } ?: return
    if (row.auto || row.done) return
    WidgetStore.addTap(context, habitId, WidgetStore.today())
    refreshAll(context)
  }

  companion object {
    const val ACTION_TAP = "expo.modules.corewidget.TAP"
    const val EXTRA_HABIT = "habitId"

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, HabitsWidgetProvider::class.java))
      if (ids.isEmpty()) return
      val views = WidgetRender.build(context)
      for (id in ids) manager.updateAppWidget(id, views)
    }
  }
}
