package expo.modules.corewidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context

/**
 * Виджет «Сегодня»: время и дата, под ними привычки из «Ввожу сейчас».
 *
 * Отмечать привычки отсюда нельзя: виджет только показывает. Нажатие на привычку с
 * подзадачами раскрывает её, нажатие на всё остальное открывает «Чек-лист» в приложении
 * (см. WidgetActionActivity).
 */
class HabitsWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    val views = WidgetRender.build(context)
    for (id in appWidgetIds) appWidgetManager.updateAppWidget(id, views)
    // Список — отдельный поставщик данных: сам он про перемену не узнает.
    appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.core_widget_list)
  }

  companion object {
    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, HabitsWidgetProvider::class.java))
      if (ids.isEmpty()) return
      val views = WidgetRender.build(context)
      for (id in ids) manager.updateAppWidget(id, views)
      manager.notifyAppWidgetViewDataChanged(ids, R.id.core_widget_list)
    }
  }
}
