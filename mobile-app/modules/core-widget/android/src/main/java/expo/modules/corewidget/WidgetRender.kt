package expo.modules.corewidget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews

/** Подзадача раскрытой привычки. */
internal data class WidgetSub(
  val id: String,
  val label: String,
  val done: Boolean,
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
) {
  val done: Boolean
    get() = count >= target

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
)

internal object WidgetRender {
  /** Ссылка, по которой приложение открывает «Чек-лист» (см. RootTabs). */
  const val CHECKLIST_URL = "no-burnout://checklist"

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
          subs.add(WidgetSub(subId, s.optString("label"), fresh && s.optBoolean("done", false)))
        }
      }

      // У родителя с подзадачами «сделано» — это подзадачи, как в приложении.
      val target = if (subs.isNotEmpty()) subs.size else maxOf(1, h.optInt("target", 1))
      val count = when {
        !fresh -> 0
        subs.isNotEmpty() -> subs.count { it.done }
        else -> minOf(target, maxOf(0, h.optInt("count", 0)))
      }
      out.add(WidgetRow(id, h.optString("label"), count, target, h.optBoolean("auto", false), subs))
    }
    return out
  }

  /** Раскрытая привычка — только если она ещё есть и подзадачи у неё остались. */
  fun expanded(context: Context, rows: List<WidgetRow>): WidgetRow? {
    val id = WidgetStore.expanded(context) ?: return null
    return rows.firstOrNull { it.id == id && it.hasSubs && !it.done }
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
      return open.subs.filter { !it.done }.map { WidgetItem(it.label, false, false, "", null) }
    }
    return rows.filter { !it.done }.map { r ->
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

    val rows = rows(context)
    // Список пуст в трёх случаях, и говорить в каждом надо своё.
    val emptyText = if (rows == null) {
      "Открой Core — и здесь появятся привычки на сегодня."
    } else if (rows.isEmpty()) {
      "В «Ввожу сейчас» пока пусто."
    } else {
      "Всё сделано на сегодня ✓"
    }
    views.setTextViewText(R.id.core_widget_empty, emptyText)
    if (rows.isNullOrEmpty()) {
      views.setTextViewText(R.id.core_widget_progress, "")
    } else {
      val (done, total) = progress(rows)
      views.setTextViewText(R.id.core_widget_progress, "Сегодня · $done из $total")
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
