@file:Suppress("unused", "UNUSED_PARAMETER")
package android.widget
class RemoteViews(pkg: String?, layout: Int) {
  fun removeAllViews(id: Int) {}
  fun addView(id: Int, v: RemoteViews?) {}
  fun setTextViewText(id: Int, t: CharSequence?) {}
  fun setTextColor(id: Int, c: Int) {}
  fun setViewVisibility(id: Int, v: Int) {}
  fun setOnClickPendingIntent(id: Int, p: android.app.PendingIntent?) {}
}
