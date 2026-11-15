package com.moviebox.app

import android.app.*
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.*
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager

class DownloadService : HeadlessJsTaskService() {
  private var started = false
  override fun onCreate() {
    super.onCreate()
    channel(this)
    startForeground(2401, notification(this, "Preparing downloads", 0))
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (started) return START_REDELIVER_INTENT
    started = true
    return super.onStartCommand(intent, flags, startId)
  }
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig("MovieBoxDownloads", Arguments.createMap(), 0, true)

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  companion object {
    fun channel(context: android.content.Context) {
      if (Build.VERSION.SDK_INT >= 26) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
          NotificationChannel("moviebox_downloads", "Downloads", NotificationManager.IMPORTANCE_LOW)
        )
      }
    }
    fun notification(context: android.content.Context, text: String, progress: Int, ongoing: Boolean = true): Notification {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("moviebox://downloads"), context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val pending = PendingIntent.getActivity(context, 2401, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, "moviebox_downloads") else Notification.Builder(context)
      return builder
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle("MovieBox downloads").setContentText(text)
        .setContentIntent(pending).setOnlyAlertOnce(true).setOngoing(ongoing)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setAutoCancel(!ongoing)
        .apply { if (ongoing) setProgress(100, progress.coerceIn(0, 100), progress < 0) }
        .build()
    }
  }
}

class DownloadBridge(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MovieBoxDownloads"
  @ReactMethod fun start(promise: Promise) {
    try {
      val intent = Intent(context, DownloadService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      HeadlessJsTaskService.acquireWakeLockNow(context)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("DOWNLOAD_SERVICE", e.message, e) }
  }
  @ReactMethod fun progress(text: String, percent: Int, finished: Boolean) {
    DownloadService.channel(context)
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.notify(if (finished) 2402 else 2401, DownloadService.notification(context, text, percent, !finished))
  }
}
class DownloadPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(DownloadBridge(context), VideoLibraryBridge(context), PlaybackControlsBridge(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
