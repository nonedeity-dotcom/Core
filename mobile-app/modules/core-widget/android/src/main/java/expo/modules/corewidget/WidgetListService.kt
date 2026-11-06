package expo.modules.corewidget

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Строки прокручиваемого списка в виджете.
 *
 * Список в виджете — не набор view, а адаптер: система сама листает его и просит у нас
 * строки по мере прокрутки. Данные берём из того же слепка, что и остальной виджет, а
 * когда они меняются, провайдер зовёт notifyAppWidgetViewDataChanged — и сюда приходит
 * onDataSetChanged.
 */
class WidgetListService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsService.RemoteViewsFactory =
    Factory(applicationContext)

  private class Factory(private val context: Context) : RemoteViewsService.RemoteViewsFactory {
    private var items: List<WidgetItem> = emptyList()

    override fun onCreate() {
      items = WidgetRender.items(context)
    }

    override fun onDataSetChanged() {
      items = WidgetRender.items(context)
    }

    override fun onDestroy() {
      items = emptyList()
    }

    override fun getCount(): Int = items.size

    override fun getViewAt(position: Int): RemoteViews {
      val line = RemoteViews(context.packageName, R.layout.core_widget_row)
      val item = items.getOrNull(position) ?: return line

      line.setTextViewText(R.id.core_widget_mark, if (item.done) "✓" else if (item.auto) "◷" else "○")
      line.setTextColor(R.id.core_widget_mark, if (item.done) WidgetRender.GREEN else WidgetRender.MUTED)
      line.setTextViewText(R.id.core_widget_label, item.label)
      line.setTextColor(R.id.core_widget_label, if (item.done) WidgetRender.MUTED else WidgetRender.TEXT)
      line.setTextViewText(R.id.core_widget_count, item.trailing)

      // Дописывается в шаблон из WidgetRender.build: привычка с подзадачами — «раскрой меня»,
      // всё остальное — пусто, и нажатие просто открывает приложение.
      val fill = Intent()
      item.expandId?.let { fill.putExtra(WidgetActionActivity.EXTRA_EXPAND, it) }
      line.setOnClickFillInIntent(R.id.core_widget_row, fill)
      return line
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long = position.toLong()

    override fun hasStableIds(): Boolean = false
  }
}
