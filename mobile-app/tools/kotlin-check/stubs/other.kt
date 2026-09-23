@file:Suppress("unused", "UNUSED_PARAMETER")
package android.app
class PendingIntent {
  companion object {
    const val FLAG_UPDATE_CURRENT = 1
    const val FLAG_IMMUTABLE = 2
    @JvmStatic fun getBroadcast(c: android.content.Context?, r: Int, i: android.content.Intent, f: Int): PendingIntent = TODO()
    @JvmStatic fun getActivity(c: android.content.Context?, r: Int, i: android.content.Intent, f: Int): PendingIntent = TODO()
  }
}
