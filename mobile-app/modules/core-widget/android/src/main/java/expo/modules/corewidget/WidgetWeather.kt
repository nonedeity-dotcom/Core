package expo.modules.corewidget

import android.content.BroadcastReceiver
import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToInt

/**
 * Погода в Уфе для режима «часы». Источник — Open-Meteo (бесплатный, без ключа).
 *
 * Грузится только когда виджет в режиме «часы», и только в фоне: на главном потоке сеть
 * запрещена. Последний ответ лежит в настройках; старше трёх часов считается устаревшим и
 * не показывается, чтобы не врать про погоду. Нет связи — блок погоды просто скрыт.
 */
internal object WidgetWeather {
  private const val PREFS = "core_widget_weather"
  // Уфа: 54.7388 с. ш., 55.9721 в. д.
  private const val ENDPOINT =
    "https://api.open-meteo.com/v1/forecast?latitude=54.7388&longitude=55.9721" +
      "&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=auto"
  private const val FRESH_MS = 10 * 60 * 1000L
  private const val STALE_MS = 3 * 60 * 60 * 1000L

  data class Weather(val temp: Int, val feels: Int, val code: Int, val isDay: Boolean)

  /** Последняя известная погода или null, если её нет или она устарела. */
  fun cached(context: Context): Weather? {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val at = p.getLong("at", 0L)
    if (at == 0L || System.currentTimeMillis() - at > STALE_MS) return null
    return Weather(p.getInt("temp", 0), p.getInt("feels", 0), p.getInt("code", 0), p.getBoolean("day", true))
  }

  /**
   * Обновить погоду в фоне и перерисовать виджет. Ничего не делает, если виджет не в режиме
   * «часы» или данные свежее десяти минут (force — всё равно загрузить).
   * pending — из goAsync(): держит получателя живым, пока идёт запрос (система даёт около 10 с).
   */
  fun refreshAsync(context: Context, pending: BroadcastReceiver.PendingResult?, force: Boolean) {
    val app = context.applicationContext
    Thread {
      try {
        if (WidgetStore.clock(app)) {
          val at = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("at", 0L)
          if (force || System.currentTimeMillis() - at > FRESH_MS) {
            if (fetch(app)) HabitsWidgetProvider.refreshAll(app)
          }
        }
      } catch (e: Exception) {
        // Нет сети или кривой ответ: остаётся прежняя погода, если она ещё не устарела.
      } finally {
        pending?.finish()
      }
    }.start()
  }

  private fun fetch(context: Context): Boolean {
    val conn = URL(ENDPOINT).openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 6000
      conn.readTimeout = 6000
      conn.requestMethod = "GET"
      if (conn.responseCode != 200) return false
      val body = conn.inputStream.bufferedReader().use { it.readText() }
      val cur = JSONObject(body).getJSONObject("current")
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putInt("temp", cur.getDouble("temperature_2m").roundToInt())
        .putInt("feels", cur.getDouble("apparent_temperature").roundToInt())
        .putInt("code", cur.getInt("weather_code"))
        .putBoolean("day", cur.optInt("is_day", 1) == 1)
        .putLong("at", System.currentTimeMillis())
        .apply()
      return true
    } finally {
      conn.disconnect()
    }
  }

  /** Значок по коду погоды WMO (так их отдаёт Open-Meteo). */
  fun icon(code: Int, isDay: Boolean): String = when (code) {
    0, 1 -> if (isDay) "☀️" else "🌙"
    2 -> if (isDay) "⛅" else "☁️"
    3 -> "☁️"
    45, 48 -> "🌫️"
    51, 53, 55, 56, 57 -> "🌦️"
    61, 63, 65, 66, 67, 80, 81, 82 -> "🌧️"
    71, 73, 75, 77, 85, 86 -> "🌨️"
    95, 96, 99 -> "⛈️"
    else -> "☁️"
  }

  /** «+12°», «−3°», «0°». */
  fun degrees(t: Int): String = when {
    t > 0 -> "+$t°"
    t < 0 -> "−${-t}°"
    else -> "0°"
  }
}
