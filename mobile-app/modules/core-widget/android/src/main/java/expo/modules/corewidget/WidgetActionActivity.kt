package expo.modules.corewidget

import android.app.Activity
import android.content.ActivityNotFoundException
import android.os.Bundle

/**
 * Невидимая развилка для нажатий на виджет.
 *
 * Список в виджете умеет слать только одно намерение на все строки, а нужны два разных
 * действия: раскрыть привычку с подзадачами и открыть приложение. Поэтому всё идёт сюда:
 * активность смотрит, что ей принесли, делает дело и тут же закрывается. Экрана у неё нет.
 *
 * - EXTRA_EXPAND — раскрыть привычку: виджет покажет её подзадачи;
 * - EXTRA_COLLAPSE — свернуть: виджет вернётся к общему списку;
 * - ничего — открыть приложение на «Чек-листе».
 */
class WidgetActionActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val expandId = intent.getStringExtra(EXTRA_EXPAND)
    when {
      expandId != null -> changeExpanded(expandId)
      intent.getBooleanExtra(EXTRA_COLLAPSE, false) -> changeExpanded(null)
      else -> openApp()
    }
    // Без этого NoDisplay-активность падает: ей нельзя дожить до onResume.
    finish()
  }

  private fun changeExpanded(habitId: String?) {
    WidgetStore.setExpanded(this, habitId)
    HabitsWidgetProvider.refreshAll(this)
  }

  private fun openApp() {
    try {
      startActivity(WidgetRender.checklistIntent(this))
    } catch (e: ActivityNotFoundException) {
      // Ссылка не нашла окно (схема не прописана в манифесте приложения) — открываем как есть.
      packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
    }
  }

  companion object {
    const val EXTRA_EXPAND = "expandId"
    const val EXTRA_COLLAPSE = "collapse"
  }
}
