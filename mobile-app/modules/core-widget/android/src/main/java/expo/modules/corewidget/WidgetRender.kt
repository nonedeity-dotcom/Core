package expo.modules.corewidget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews

/** Строка виджета: одна привычка «Ввожу сейчас» на сегодня. */
internal data class WidgetRow(
  val id: String,
  val label: String,
  val count: Int,
  val target: Int,
  /** Отмечается сама (экранное время) — нажимать на неё нечего. */
  val auto: Boolean,
) {
  val done: Boolean
    get() = count >= target
}

internal object WidgetRender {
  private const val MAX_ROWS = 8
  private val TEXT = Color.parseColor("#E8E6E0")
  private val MUTED = Color.parseColor("#8B8F98")
  private val GREEN = Color.parseColor("#8FB89A")

  /**
   * Строки с учётом нажатий, которых приложение ещё не видело.
   *
   * Слепок мог остаться со вчера — тогда вчерашние отметки не в счёт, день начинается с нуля.
   * null — слепка нет вовсе: приложение ни разу не открывали после установки виджета.
   */
  fun rows(context: Context): List<WidgetRow>? {
    val snapshot = WidgetStore.snapshot(context) ?: return null
    val today = WidgetStore.today()
    val fresh = snapshot.optString("date") == today

    val taps = HashMap<String, Int>()
    val pending = WidgetStore.pending(context)
    for (i in 0 until pending.length()) {
      val tap = pending.optJSONObject(i) ?: continue
      if (tap.optString("date") != today) continue
      val id = tap.optString("id")
      taps[id] = (taps[id] ?: 0) + 1
    }

    val habits = snapshot.optJSONArray("habits") ?: return emptyList()
    val out = ArrayList<WidgetRow>()
    for (i in 0 until habits.length()) {
      val h = habits.optJSONObject(i) ?: continue
      val id = h.optString("id")
      if (id.isEmpty()) continue
      val target = maxOf(1, h.optInt("target", 1))
      val base = if (fresh) maxOf(0, h.optInt("count", 0)) else 0
      out.add(
        WidgetRow(
          id = id,
          label = h.optString("label"),
          count = minOf(target, base + (taps[id] ?: 0)),
          target = target,
          auto = h.optBoolean("auto", false),
        ),
      )
    }
    return out
  }

  fun build(context: Context): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.core_widget)
    views.removeAllViews(R.id.core_widget_rows)
    openApp(context)?.let { views.setOnClickPendingIntent(R.id.core_widget_title, it) }

    val rows = rows(context)
    if (rows == null || rows.isEmpty()) {
      views.setTextViewText(R.id.core_widget_title, "Core")
      views.setTextViewText(
        R.id.core_widget_empty,
        if (rows == null) "Открой Core — и здесь появятся привычки на сегодня." else "В «Ввожу сейчас» пока пусто.",
      )
      views.setViewVisibility(R.id.core_widget_empty, View.VISIBLE)
      views.setViewVisibility(R.id.core_widget_more, View.GONE)
      openApp(context)?.let { views.setOnClickPendingIntent(R.id.core_widget_empty, it) }
      return views
    }

    views.setViewVisibility(R.id.core_widget_empty, View.GONE)
    val done = rows.count { it.done }
    views.setTextViewText(R.id.core_widget_title, "Сегодня · $done из ${rows.size}")

    for (row in rows.take(MAX_ROWS)) {
      val line = RemoteViews(context.packageName, R.layout.core_widget_row)
      line.setTextViewText(R.id.core_widget_mark, if (row.done) "✓" else if (row.auto) "◷" else "○")
      line.setTextColor(R.id.core_widget_mark, if (row.done) GREEN else MUTED)
      line.setTextViewText(R.id.core_widget_label, row.label)
      line.setTextColor(R.id.core_widget_label, if (row.done) MUTED else TEXT)
      line.setTextViewText(R.id.core_widget_count, if (row.target > 1) "${row.count}/${row.target}" else "")
      // Нажатие — шаг вверх, как в чек-листе. Отмеченное и то, что считается само, не
      // нажимается: снять отметку можно только в приложении, в режиме правки.
      if (!row.auto && !row.done) line.setOnClickPendingIntent(R.id.core_widget_row, tap(context, row.id))
      views.addView(R.id.core_widget_rows, line)
    }

    val hidden = rows.size - MAX_ROWS
    if (hidden > 0) {
      views.setTextViewText(R.id.core_widget_more, "и ещё $hidden — в приложении")
      views.setViewVisibility(R.id.core_widget_more, View.VISIBLE)
      openApp(context)?.let { views.setOnClickPendingIntent(R.id.core_widget_more, it) }
    } else {
      views.setViewVisibility(R.id.core_widget_more, View.GONE)
    }
    return views
  }

  private fun tap(context: Context, habitId: String): PendingIntent {
    val intent = Intent(context, HabitsWidgetProvider::class.java).apply {
      action = HabitsWidgetProvider.ACTION_TAP
      // Своя ссылка на каждую строку: иначе система сочтёт все намерения одинаковыми и
      // оставит одно — и каждая строка отмечала бы одну и ту же привычку.
      data = Uri.parse("core-widget://tap/" + Uri.encode(habitId))
      putExtra(HabitsWidgetProvider.EXTRA_HABIT, habitId)
    }
    return PendingIntent.getBroadcast(
      context,
      habitId.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun openApp(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
