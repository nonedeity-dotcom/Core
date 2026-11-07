package expo.modules.corewidget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import java.util.Calendar

/** Подзадача раскрытой привычки. */
internal data class WidgetSub(
  val id: String,
  val label: String,
  val done: Boolean,
  /**
   * Время вышло, а правило — «день провален»: отметить уже нельзя. В списке не показывается,
   * в счёте остаётся невыполненной. Считается по часам телефона при каждой сборке списка.
   */
  val failed: Boolean = false,
)

/** Привычка «Ввожу сейчас» на сегодня. */
internal data class WidgetRow(
  val id: String,
  val label: String,
  val count: Int,
  val target: Int,
  /** Отмечается сама (экранное время). */
  val auto: Boolean,
  val subs: List<WidgetSub>,
  /** Провалена на сегодня (у родителя с подзадачами — когда провалены все его подзадачи). */
  val failed: Boolean = false,
) {
  val done: Boolean
    get() = count >= target

  /** Отмечать и раскрывать больше нечего: всё сделано или провалено. В список такая не попадает. */
  val settled: Boolean
    get() = if (subs.isNotEmpty()) subs.all { it.done || it.failed } else done || failed

  val hasSubs: Boolean
    get() = subs.isNotEmpty()
}

/** Одна строка списка в виджете: привычка или подзадача раскрытой привычки. */
internal data class WidgetItem(
  val label: String,
  val done: Boolean,
  val auto: Boolean,
  /** Справа от названия: «2/5», «2/5  ›» или пусто. */
  val trailing: String,
  /** Если задан — нажатие раскрывает эту привычку; иначе открывает приложение. */
  val expandId: String?,
  /** Полоса под названием: сколько подзадач сделано из скольких. barMax = 0 — полосы нет. */
  val barMax: Int = 0,
  val barNow: Int = 0,
)

internal object WidgetRender {
  /** Ссылка, по которой приложение открывает «Чек-лист» (см. RootTabs). */
  const val CHECKLIST_URL = "no-burnout://checklist"

  /** Нажатие на кнопку «часы»: его ловит провайдер и зовёт toggleClock. */
  const val ACTION_TOGGLE_CLOCK = "expo.modules.corewidget.TOGGLE_CLOCK"

  val TEXT = Color.parseColor("#E8E6E0")
  val MUTED = Color.parseColor("#8B8F98")
  val GREEN = Color.parseColor("#8FB89A")

  /**
   * Привычки из слепка.
   *
   * Слепок мог остаться со вчера — тогда вчерашние отметки не в счёт, день начинается с нуля.
   * null — слепка нет вовсе: приложение ни разу не открывали после установки виджета.
   */
  fun rows(context: Context): List<WidgetRow>? {
    val snapshot = WidgetStore.snapshot(context) ?: return null
    val fresh = snapshot.optString("date") == WidgetStore.today()

    val habits = snapshot.optJSONArray("habits") ?: return emptyList()
    val now = nowMinutes()
    val out = ArrayList<WidgetRow>()
    for (i in 0 until habits.length()) {
      val h = habits.optJSONObject(i) ?: continue
      val id = h.optString("id")
      if (id.isEmpty()) continue

      val subs = ArrayList<WidgetSub>()
      val subsJson = h.optJSONArray("subs")
      if (subsJson != null) {
        for (j in 0 until subsJson.length()) {
          val s = subsJson.optJSONObject(j) ?: continue
          val subId = s.optString("id")
          if (subId.isEmpty()) continue
          val subDone = fresh && s.optBoolean("done", false)
          subs.add(WidgetSub(subId, s.optString("label"), subDone, failedAt(s.optLateAt(), subDone, now)))
        }
      }

      // У родителя с подзадачами «сделано» — это подзадачи, как в приложении.
      val target = if (subs.isNotEmpty()) subs.size else maxOf(1, h.optInt("target", 1))
      val count = when {
        !fresh -> 0
        subs.isNotEmpty() -> subs.count { it.done }
        else -> minOf(target, maxOf(0, h.optInt("count", 0)))
      }
      // Родитель с подзадачами провален, только если провалены все его подзадачи.
      val failed = if (subs.isNotEmpty()) subs.all { it.failed } else failedAt(h.optLateAt(), count >= target, now)
      out.add(WidgetRow(id, h.optString("label"), count, target, h.optBoolean("auto", false), subs, failed))
    }
    return out
  }

  /** Минут с начала суток по часам телефона — той же шкалой, что и время привычки в приложении. */
  private fun nowMinutes(): Int {
    val c = Calendar.getInstance()
    return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
  }

  /** Минута, после которой привычку уже нельзя отметить; null — по времени она не проваливается. */
  private fun org.json.JSONObject.optLateAt(): Int? =
    if (has("lateAt") && !isNull("lateAt")) optInt("lateAt") else null

  /** «Поздно» — строго после конца окна, как windowState в приложении. Сделанное не проваливается. */
  private fun failedAt(lateAt: Int?, done: Boolean, now: Int): Boolean = !done && lateAt != null && now > lateAt

  /** Раскрытая привычка — только если она ещё есть и подзадачи у неё остались. */
  fun expanded(context: Context, rows: List<WidgetRow>): WidgetRow? {
    val id = WidgetStore.expanded(context) ?: return null
    return rows.firstOrNull { it.id == id && it.hasSubs && !it.settled }
  }

  /**
   * Сколько задач на сегодня и сколько сделано.
   *
   * Подзадачи считаются вместо родителя, а не вместе с ним: родитель — не отдельная задача,
   * он закрывается, когда сделаны все его подзадачи.
   */
  fun progress(rows: List<WidgetRow>): Pair<Int, Int> {
    var done = 0
    var total = 0
    for (r in rows) {
      if (r.hasSubs) {
        total += r.subs.size
        done += r.subs.count { it.done }
      } else {
        total += 1
        if (r.done) done += 1
      }
    }
    return done to total
  }

  /** Что показывает список: подзадачи раскрытой привычки или все привычки. */
  fun items(context: Context): List<WidgetItem> {
    val rows = rows(context) ?: return emptyList()
    val open = expanded(context, rows)
    if (open != null) {
      return open.subs.filter { !it.done && !it.failed }.map { WidgetItem(it.label, false, false, "", null) }
    }
    return rows.filter { !it.settled }.map { r ->
      WidgetItem(
        label = r.label,
        done = r.done,
        auto = r.auto,
        trailing = when {
          r.hasSubs -> "${r.count}/${r.target}  ›"
          r.target > 1 -> "${r.count}/${r.target}"
          else -> ""
        },
        expandId = if (r.hasSubs) r.id else null,
        barMax = if (r.hasSubs) r.target else 0,
        barNow = if (r.hasSubs) r.count else 0,
      )
    }
  }

  fun build(context: Context): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.core_widget)

    // Нажатие на сам виджет — в приложение, на «Чек-лист».
    val open = action(context, requestCode = 0, collapse = false, mutable = false)
    views.setOnClickPendingIntent(R.id.core_widget_root, open)
    views.setOnClickPendingIntent(R.id.core_widget_header, open)
    views.setOnClickPendingIntent(R.id.core_widget_empty, open)

    // Режим «часы»: на весь виджет только время, число и день недели. Сами часы идут без
    // нас (TextClock), поэтому перерисовывать виджет раз в минуту не нужно.
    val clockMode = WidgetStore.clock(context)
    views.setViewVisibility(R.id.core_widget_normal, if (clockMode) View.GONE else View.VISIBLE)
    views.setViewVisibility(R.id.core_widget_clock, if (clockMode) View.VISIBLE else View.GONE)
    views.setImageViewResource(
      R.id.core_widget_clock_btn,
      if (clockMode) R.drawable.core_widget_ic_list else R.drawable.core_widget_ic_clock,
    )
    views.setContentDescription(R.id.core_widget_clock_btn, if (clockMode) "Список" else "Часы")
    views.setOnClickPendingIntent(R.id.core_widget_clock_btn, toggleClockIntent(context))
    views.setOnClickPendingIntent(R.id.core_widget_clock, open)
    if (clockMode) {
      bindWeather(context, views)
      bindBattery(context, views)
    }

    val rows = rows(context)
    // Список пуст в трёх случаях, и говорить в каждом надо своё.
    val emptyText = if (rows == null) {
      "Открой Core — и здесь появятся привычки на сегодня."
    } else if (rows.isEmpty()) {
      "В «Ввожу сейчас» пока пусто."
    } else if (rows.all { it.done }) {
      "Всё сделано на сегодня ✓"
    } else {
      "Больше задач на сегодня нет"
    }
    views.setTextViewText(R.id.core_widget_empty, emptyText)
    if (rows.isNullOrEmpty()) {
      views.setTextViewText(R.id.core_widget_progress, "")
      // Считать нечего — полоса не нужна.
      views.setViewVisibility(R.id.core_widget_bar, View.GONE)
    } else {
      val (done, total) = progress(rows)
      views.setTextViewText(R.id.core_widget_progress, "Сегодня · $done из $total")
      // Общая полоса в шапке: те же done и total, что в тексте выше.
      views.setViewVisibility(R.id.core_widget_bar, View.VISIBLE)
      views.setProgressBar(R.id.core_widget_bar, maxOf(total, 1), done, false)
    }

    val expanded = if (rows == null) null else expanded(context, rows)
    if (expanded != null) {
      views.setTextViewText(
        R.id.core_widget_back,
        "▾ ${expanded.label} · ${expanded.count}/${expanded.target} — свернуть",
      )
      views.setViewVisibility(R.id.core_widget_back, View.VISIBLE)
      views.setOnClickPendingIntent(R.id.core_widget_back, action(context, requestCode = 2, collapse = true, mutable = false))
    } else {
      views.setViewVisibility(R.id.core_widget_back, View.GONE)
    }

    views.setRemoteAdapter(R.id.core_widget_list, Intent(context, WidgetListService::class.java))
    views.setEmptyView(R.id.core_widget_list, R.id.core_widget_empty)
    // Шаблон нажатия на строку: каждая строка дописывает в него своё (раскрыть такую-то).
    views.setPendingIntentTemplate(
      R.id.core_widget_list,
      action(context, requestCode = 1, collapse = false, mutable = true),
    )
    return views
  }

  /** Погода слева сверху. Нет свежих данных — блок скрыт, часы остаются по центру. */
  private fun bindWeather(context: Context, views: RemoteViews) {
    val w = WidgetWeather.cached(context)
    if (w == null) {
      views.setViewVisibility(R.id.core_widget_weather, View.GONE)
      return
    }
    views.setViewVisibility(R.id.core_widget_weather, View.VISIBLE)
    views.setTextViewText(R.id.core_widget_weather_icon, WidgetWeather.icon(w.code, w.isDay))
    views.setTextViewText(R.id.core_widget_weather_temp, WidgetWeather.degrees(w.temp))
    views.setTextViewText(R.id.core_widget_weather_feels, "Ощущается ${WidgetWeather.degrees(w.feels)}")
  }

  /** Заряд батареи внизу: до 20% красная, 21–35% оранжевая, выше — зелёная. */
  private fun bindBattery(context: Context, views: RemoteViews) {
    val pct = batteryPercent(context)
    if (pct < 0) {
      views.setViewVisibility(R.id.core_widget_battery, View.GONE)
      return
    }
    views.setViewVisibility(R.id.core_widget_battery, View.VISIBLE)
    val bars = intArrayOf(R.id.core_widget_battery_red, R.id.core_widget_battery_orange, R.id.core_widget_battery_green)
    val active = when {
      pct <= 20 -> 0
      pct <= 35 -> 1
      else -> 2
    }
    for (i in bars.indices) views.setViewVisibility(bars[i], if (i == active) View.VISIBLE else View.GONE)
    views.setProgressBar(bars[active], 100, pct, false)
    views.setTextViewText(R.id.core_widget_battery_text, "$pct%")
  }

  /** Процент заряда или -1, если система его не сообщила. */
  private fun batteryPercent(context: Context): Int {
    val status = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return -1
    val level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    if (level < 0 || scale <= 0) return -1
    return level * 100 / scale
  }

  /** Кнопка «часы» шлёт широковещательное сообщение провайдеру: активность для этого не нужна. */
  private fun toggleClockIntent(context: Context): PendingIntent {
    val intent = Intent(context, HabitsWidgetProvider::class.java).setAction(ACTION_TOGGLE_CLOCK)
    return PendingIntent.getBroadcast(context, 3, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** Переключить режим «часы» и сразу перерисовать все такие виджеты на экране. */
  fun toggleClock(context: Context) {
    WidgetStore.setClock(context, !WidgetStore.clock(context))
    HabitsWidgetProvider.refreshAll(context)
  }

  /** Намерение, которым приложение открывается на «Чек-листе». */
  fun checklistIntent(context: Context): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(CHECKLIST_URL)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

  /**
   * Нажатие через невидимую активность: она раскроет привычку, свернёт или откроет приложение.
   *
   * Свой requestCode у каждого вида: система различает PendingIntent по коду и действию, а
   * дополнения (extras) в сравнение не входят — без этого все три слились бы в один.
   * Шаблон строки списка обязан быть изменяемым, иначе строки не смогут дописать в него своё.
   */
  private fun action(context: Context, requestCode: Int, collapse: Boolean, mutable: Boolean): PendingIntent {
    val intent = Intent(context, WidgetActionActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (collapse) putExtra(WidgetActionActivity.EXTRA_COLLAPSE, true)
    }
    val mutability = when {
      !mutable -> PendingIntent.FLAG_IMMUTABLE
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> PendingIntent.FLAG_MUTABLE
      else -> 0
    }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutability)
  }
}
