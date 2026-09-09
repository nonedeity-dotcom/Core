package expo.modules.crekerusage

import android.database.Cursor
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val AUTHORITY = "com.creker.screentime.provider"

/**
 * Reads device-wide screen-on time and per-app foreground time out of creker's (a separate,
 * sibling app on the same device) read-only ContentProvider — see creker's UsageProvider.kt for the
 * query contract this mirrors. Nothing here writes anything or requires network;
 * if creker isn't installed, hasn't granted the permission, or has no data for the
 * range, every call just resolves to an empty list rather than throwing — "no data"
 * is an expected, normal state here, not an error.
 */
class CrekerUsageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CrekerUsage")

    // fromDate/toDate: "yyyy-MM-dd", inclusive. Resolves to a list of
    // { date: string, screenMillis: number, updatedAt: number } — one entry per day
    // creker has synced data for; missing days are simply absent from the list.
    // updatedAt is epoch millis up to which screenMillis for that day is complete
    // (not when the row was written), so a caller can tell a measured zero from a
    // day creker simply hasn't caught up on. Older creker builds have no such
    // column; those rows come back with updatedAt = 0, meaning "unknown".
    AsyncFunction("getScreenTime") { fromDate: String, toDate: String ->
      val resolver = appContext.reactContext?.contentResolver
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val uri = Uri.parse("content://$AUTHORITY/device_usage")
      val results = mutableListOf<Map<String, Any>>()
      try {
        val cursor: Cursor? = resolver.query(uri, null, null, arrayOf(fromDate, toDate), null)
        cursor?.use {
          val dateIdx = it.getColumnIndex("date")
          val millisIdx = it.getColumnIndex("screen_millis")
          // Absent on creker builds that predate the column — treat every row as
          // "unknown" (0) rather than dropping the data we do have.
          val updatedIdx = it.getColumnIndex("updated_at")
          if (dateIdx >= 0 && millisIdx >= 0) {
            while (it.moveToNext()) {
              results.add(
                mapOf(
                  "date" to it.getString(dateIdx),
                  "screenMillis" to it.getLong(millisIdx),
                  "updatedAt" to if (updatedIdx >= 0) it.getLong(updatedIdx) else 0L,
                )
              )
            }
          }
        }
      } catch (e: Exception) {
        // creker missing / permission not granted / provider unreachable — same as no data.
      }
      results
    }

    // Per-app foreground time for a date range, mirroring creker's `app_usage` path — the
    // same selectionArgs contract as above. Resolves to a list of
    // { date, packageName, label, usageMillis, launchCount }, one entry per app per day it
    // was used. `label` is the readable name, resolved by creker: since Android 11 this app
    // sees only the packages it declared up front, so it cannot work the name out itself.
    //
    // Same silence on failure as getScreenTime: an older creker without this path returns no
    // cursor, and that is an empty list, not an error. Callers must survive it, because every
    // creker installed before this path existed will do exactly that.
    AsyncFunction("getAppUsage") { fromDate: String, toDate: String ->
      val resolver = appContext.reactContext?.contentResolver
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val uri = Uri.parse("content://$AUTHORITY/app_usage")
      val results = mutableListOf<Map<String, Any>>()
      try {
        val cursor: Cursor? = resolver.query(uri, null, null, arrayOf(fromDate, toDate), null)
        cursor?.use {
          val dateIdx = it.getColumnIndex("date")
          val packageIdx = it.getColumnIndex("package_name")
          val millisIdx = it.getColumnIndex("usage_millis")
          val launchIdx = it.getColumnIndex("launch_count")
          val labelIdx = it.getColumnIndex("app_label")
          if (dateIdx >= 0 && packageIdx >= 0 && millisIdx >= 0) {
            while (it.moveToNext()) {
              val packageName = it.getString(packageIdx)
              results.add(
                mapOf(
                  "date" to it.getString(dateIdx),
                  "packageName" to packageName,
                  // A creker old enough to lack the column still gives usable rows; the
                  // package name is a worse name than a real one and better than nothing.
                  "label" to if (labelIdx >= 0) it.getString(labelIdx) ?: packageName else packageName,
                  "usageMillis" to it.getLong(millisIdx),
                  "launchCount" to if (launchIdx >= 0) it.getInt(launchIdx) else 0,
                )
              )
            }
          }
        }
      } catch (e: Exception) {
        // creker missing / too old for this path / not allowed — same as no data.
      }
      results
    }

    // Why there is no data, when there is none. getScreenTime deliberately flattens every
    // failure into an empty list, which is right for the habit tick but useless when the
    // user is asking "so is this working or not". Resolves to
    // { installed, answered, denied, screenMillis, updatedAt } for one day:
    //   installed = creker's provider is on this device at all
    //   answered  = it returned a cursor (installed, permitted, and sharing with this app)
    //   denied    = it refused us — no permission, or turned off for this app in creker
    // screenMillis/updatedAt are null when there is no row for that day.
    AsyncFunction("getStatus") { date: String ->
      val context = appContext.reactContext
        ?: return@AsyncFunction mapOf<String, Any?>("installed" to false, "answered" to false, "denied" to false)
      val installed = context.packageManager.resolveContentProvider(AUTHORITY, 0) != null
      if (!installed) {
        return@AsyncFunction mapOf<String, Any?>("installed" to false, "answered" to false, "denied" to false)
      }

      val uri = Uri.parse("content://$AUTHORITY/device_usage")
      var answered = false
      var denied = false
      var screenMillis: Long? = null
      var updatedAt: Long? = null
      try {
        val cursor: Cursor? = context.contentResolver.query(uri, null, null, arrayOf(date, date), null)
        if (cursor == null) {
          // Installed, reachable, and it chose to say nothing: creker returns a null cursor
          // for an app the user has not allowed.
          denied = true
        } else {
          answered = true
          cursor.use {
            val millisIdx = it.getColumnIndex("screen_millis")
            val updatedIdx = it.getColumnIndex("updated_at")
            if (it.moveToFirst() && millisIdx >= 0) {
              screenMillis = it.getLong(millisIdx)
              updatedAt = if (updatedIdx >= 0) it.getLong(updatedIdx) else 0L
            }
          }
        }
      } catch (e: SecurityException) {
        denied = true
      } catch (e: Exception) {
        // Installed but unreachable for some other reason: neither answered nor a refusal
        // we can explain, so it stays "no answer" rather than being blamed on permissions.
      }

      mapOf<String, Any?>(
        "installed" to true,
        "answered" to answered,
        "denied" to denied,
        "screenMillis" to screenMillis,
        "updatedAt" to updatedAt,
      )
    }
  }
}
