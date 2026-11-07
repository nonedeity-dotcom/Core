package expo.modules.corewidget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Виджет «Сегодня»: время и дата, под ними привычки из «Ввожу сейчас». Кнопка в углу
 * переключает его в режим «часы»: на весь виджет только время, число и день недели.
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
    // Погода нужна только в режиме «часы»; в другом режиме этот вызов сразу ничего не делает.
    WidgetWeather.refreshAsync(context, goAsync(), force = false)
    // После перезагрузки телефона или обновления виджета цепочка 10-минутных тиков стартует заново.
    syncTick(context)
  }

  override fun onDisabled(context: Context) {
    // Последний виджет убрали с экрана: будильник больше не нужен.
    cancelTick(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    // Кнопка «часы» в углу: переключить режим и перерисовать. Остальное — как у системы.
    when (intent.action) {
      WidgetRender.ACTION_TOGGLE_CLOCK -> {
        WidgetRender.toggleClock(context)
        syncTick(context)
        WidgetWeather.refreshAsync(context, goAsync(), force = false)
        return
      }
      ACTION_TICK -> {
        // Раз в 10 минут в режиме «часы»: только перерисовать, чтобы обновился заряд батареи.
        // Погоду это не трогает: она грузится только при обновлении виджета и переключении.
        if (WidgetStore.clock(context)) {
          refreshAll(context)
          scheduleTick(context)
        } else {
          cancelTick(context)
        }
        return
      }
    }
    super.onReceive(context, intent)
  }

  companion object {
    /** Тик будильника: пока включён режим «часы», приходит раз в 10 минут. */
    const val ACTION_TICK = "expo.modules.corewidget.TICK"
    private const val TICK_MS = 10 * 60 * 1000L

    private fun tickIntent(context: Context): PendingIntent {
      val intent = Intent(context, HabitsWidgetProvider::class.java).setAction(ACTION_TICK)
      return PendingIntent.getBroadcast(context, 4, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /**
     * Следующий тик через 10 минут. Будильник неточный и не будит телефон (RTC, не RTC_WAKEUP):
     * разрешений не нужно, расход батареи минимальный. Платим этим тем, что пока телефон спит,
     * тик ждёт, а после пробуждения приходит сразу. Тот же PendingIntent заменяет прежний будильник.
     */
    fun scheduleTick(context: Context) {
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarms.setAndAllowWhileIdle(AlarmManager.RTC, System.currentTimeMillis() + TICK_MS, tickIntent(context))
    }

    fun cancelTick(context: Context) {
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarms.cancel(tickIntent(context))
    }

    /** Тики нужны, только пока включён режим «часы». */
    fun syncTick(context: Context) {
      if (WidgetStore.clock(context)) scheduleTick(context) else cancelTick(context)
    }

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
