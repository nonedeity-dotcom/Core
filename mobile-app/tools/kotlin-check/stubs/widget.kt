@file:Suppress("unused", "UNUSED_PARAMETER")
package android.appwidget
open class AppWidgetManager {
  fun getAppWidgetIds(p: android.content.ComponentName?): IntArray = TODO()
  fun updateAppWidget(id: Int, v: android.widget.RemoteViews?) {}
  companion object { @JvmStatic fun getInstance(c: android.content.Context?): AppWidgetManager = TODO() }
}
open class AppWidgetProvider {
  open fun onUpdate(context: android.content.Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {}
  open fun onReceive(context: android.content.Context, intent: android.content.Intent) {}
}
