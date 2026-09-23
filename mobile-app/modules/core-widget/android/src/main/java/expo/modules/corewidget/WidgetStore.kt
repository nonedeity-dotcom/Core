package expo.modules.corewidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Что виджет знает и что он накопил, пока приложение было закрыто.
 *
 * Виджет не читает хранилище приложения — оно живёт внутри JS, и достать его отсюда можно
 * только запустив весь JS. Поэтому приложение само кладёт сюда слепок «сегодня» (привычки,
 * сколько отмечено, сколько нужно), а виджет складывает нажатия в очередь. Открыл
 * приложение — оно забирает очередь, отмечает у себя и кладёт свежий слепок.
 */
internal object WidgetStore {
  private const val PREFS = "core_widget"
  private const val SNAPSHOT = "snapshot"
  private const val PENDING = "pending"
  private val lock = Any()

  /** Сегодняшняя дата по часам телефона — так же, как её считает приложение. */
  fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun saveSnapshot(context: Context, json: String) {
    synchronized(lock) {
      prefs(context).edit().putString(SNAPSHOT, json).commit()
    }
  }

  fun snapshot(context: Context): JSONObject? {
    val raw = synchronized(lock) { prefs(context).getString(SNAPSHOT, null) }
    if (raw == null) return null
    return try {
      JSONObject(raw)
    } catch (e: Exception) {
      null
    }
  }

  fun pending(context: Context): JSONArray = synchronized(lock) { readPending(context) }

  private fun readPending(context: Context): JSONArray {
    val raw = prefs(context).getString(PENDING, null) ?: return JSONArray()
    return try {
      JSONArray(raw)
    } catch (e: Exception) {
      JSONArray()
    }
  }

  fun addTap(context: Context, habitId: String, date: String) {
    synchronized(lock) {
      val list = readPending(context)
      list.put(JSONObject().put("id", habitId).put("date", date))
      prefs(context).edit().putString(PENDING, list.toString()).commit()
    }
  }

  /** Отдать накопленные нажатия и забыть их — одним шагом, чтобы ни одно не ушло дважды. */
  fun takePending(context: Context): String {
    synchronized(lock) {
      val raw = readPending(context).toString()
      prefs(context).edit().remove(PENDING).commit()
      return raw
    }
  }
}
