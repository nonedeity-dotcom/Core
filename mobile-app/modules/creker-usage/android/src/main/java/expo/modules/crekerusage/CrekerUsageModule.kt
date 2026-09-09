package expo.modules.crekerusage

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

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

    // --- Measuring for ourselves ---
    //
    // Everything above reads creker. Everything below replaces it: the same system API creker
    // uses, asked for directly. The split is deliberate — this side stays as thin as it can
    // be, handing back the raw event stream, and every judgement about what those events mean
    // is made in TypeScript where it can be tested without a phone. Interval arithmetic that
    // only ever runs on a device is arithmetic nobody has checked.

    /** Whether this app may read usage statistics. A special app-op, not a runtime permission. */
    Function("hasUsageAccess") {
      val context = appContext.reactContext ?: return@Function false
      val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
        ?: return@Function false
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
      } else {
        @Suppress("DEPRECATION")
        appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
      }
      when (mode) {
        AppOpsManager.MODE_ALLOWED -> true
        // MODE_DEFAULT means "fall back to the permission check".
        AppOpsManager.MODE_DEFAULT ->
          context.checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS) ==
            PackageManager.PERMISSION_GRANTED
        else -> false
      }
    }

    /**
     * Opens the system screen where the person grants usage access — it cannot be granted from
     * a dialog. Some vendors ship without the per-app deep link, hence the fallback.
     */
    Function("openUsageAccessSettings") {
      val context = appContext.reactContext ?: return@Function false
      val intents = listOf(
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
          .setData(Uri.fromParts("package", context.packageName, null)),
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS),
      )
      var opened = false
      for (intent in intents) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (runCatching { context.startActivity(intent) }.isSuccess) {
          opened = true
          break
        }
      }
      opened
    }

    /**
     * The raw event stream between two epoch-millis stamps.
     *
     * Nothing is interpreted here beyond mapping the platform's integer event types onto
     * names. Screen and keyguard events describe the device rather than an app, and some
     * builds report them with no package at all; those get a stand-in name instead of being
     * dropped, which is what once left screen time permanently empty.
     */
    AsyncFunction("queryRawEvents") { startMs: Double, endMs: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val stream = runCatching { manager.queryEvents(startMs.toLong(), endMs.toLong()) }.getOrNull()
        ?: return@AsyncFunction emptyList<Map<String, Any>>()

      val out = mutableListOf<Map<String, Any>>()
      val event = UsageEvents.Event()
      while (stream.hasNextEvent()) {
        stream.getNextEvent(event)
        val type = eventTypeName(event.eventType) ?: continue
        val packageName = event.packageName ?: if (isDeviceWide(type)) DEVICE_PACKAGE else continue
        out.add(
          mapOf(
            "packageName" to packageName,
            // Doubles, because JS has no 64-bit integer: epoch millis fit exactly.
            "timestampMs" to event.timeStamp.toDouble(),
            "type" to type,
          )
        )
      }
      out
    }

    /**
     * Readable names and icons for packages.
     *
     * Needs the package-visibility declaration in the manifest: since Android 11 an app sees
     * only what it declared. A package uninstalled since it was recorded resolves to its own
     * name and no icon — history should survive an uninstall, not disappear with it.
     *
     * Icons come back as base64 PNG rather than as files: they are small, there are tens of
     * them, and a file per icon means a cache to keep and to invalidate.
     */
    AsyncFunction("getAppInfo") { packages: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      val pm = context.packageManager
      packages.map { packageName ->
        val info = runCatching { pm.getApplicationInfo(packageName, 0) }.getOrNull()
        val label = info?.let { runCatching { pm.getApplicationLabel(it).toString() }.getOrNull() }
          ?.takeIf { it.isNotBlank() }
        val icon = info?.let { runCatching { pm.getApplicationIcon(it) }.getOrNull() }
        // Когда приложение появилось на телефоне — «пользуюсь им три года» и «поставил
        // неделю назад» это разные факты об одном и том же числе часов.
        val installedAt = runCatching { pm.getPackageInfo(packageName, 0).firstInstallTime }.getOrNull()
        mapOf(
          "packageName" to packageName,
          "label" to (label ?: packageName),
          "installed" to (info != null),
          "icon" to icon?.let { encodeIcon(it) },
          "installedAtMs" to installedAt?.toDouble(),
        )
      }
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

  private fun eventTypeName(raw: Int): String? = when (raw) {
    // ACTIVITY_RESUMED (API 29+) shares its value with the older MOVE_TO_FOREGROUND.
    UsageEvents.Event.MOVE_TO_FOREGROUND -> "foreground"
    // Same for ACTIVITY_PAUSED and MOVE_TO_BACKGROUND.
    UsageEvents.Event.MOVE_TO_BACKGROUND -> "background"
    SCREEN_INTERACTIVE -> "screenOn"
    SCREEN_NON_INTERACTIVE -> "screenOff"
    KEYGUARD_SHOWN -> "keyguardShown"
    KEYGUARD_HIDDEN -> "keyguardHidden"
    DEVICE_SHUTDOWN -> "shutdown"
    else -> null
  }

  private fun isDeviceWide(type: String): Boolean =
    type == "screenOn" || type == "screenOff" || type == "keyguardShown" ||
      type == "keyguardHidden" || type == "shutdown"

  /** Draws a launcher icon into a small PNG and returns it as a data URI. */
  private fun encodeIcon(drawable: Drawable): String? = runCatching {
    val size = ICON_PX
    val bitmap = if (drawable is BitmapDrawable && drawable.bitmap != null) {
      Bitmap.createScaledBitmap(drawable.bitmap, size, size, true)
    } else {
      Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).also {
        val canvas = Canvas(it)
        drawable.setBounds(0, 0, size, size)
        drawable.draw(canvas)
      }
    }
    val bytes = ByteArrayOutputStream().use { stream ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
      stream.toByteArray()
    }
    "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
  }.getOrNull()

  private companion object {
    /** Stand-in package for events that belong to the device rather than an app. */
    const val DEVICE_PACKAGE = "android"

    /**
     * Declared as literals because the matching constants arrived in later API levels than
     * this app's minimum; the numeric values are part of the platform contract.
     */
    const val SCREEN_INTERACTIVE = 15
    const val SCREEN_NON_INTERACTIVE = 16
    const val KEYGUARD_SHOWN = 17
    const val KEYGUARD_HIDDEN = 18
    const val DEVICE_SHUTDOWN = 26

    /** Icons are shown at 24–32dp; 96px covers the densest screen without bloating storage. */
    const val ICON_PX = 96
  }
}
