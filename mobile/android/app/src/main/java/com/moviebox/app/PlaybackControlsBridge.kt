package com.moviebox.app

import android.app.Activity
import android.app.AppOpsManager
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import android.os.Process
import android.provider.Settings
import androidx.core.app.AppOpsManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.lang.ref.WeakReference
import java.util.Locale
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

class PlaybackControlsBridge(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val audio get() = context.getSystemService(AudioManager::class.java)
  private var brightnessActivity: WeakReference<Activity>? = null
  private var previousBrightness = -1f
  private val trackReads = ThreadPoolExecutor(0, 2, 30, TimeUnit.SECONDS, SynchronousQueue())

  @ReactMethod
  fun readAudioLanguages(url: String, headers: ReadableMap, promise: Promise) {
    if (!url.startsWith("https://", ignoreCase = true)) {
      promise.resolve(Arguments.createArray())
      return
    }
    val requestHeaders = headers.toHashMap().mapNotNull { (key, value) ->
      (value as? String)?.let { key to it }
    }.toMap()
    try {
      trackReads.execute {
        val extractor = MediaExtractor()
        val languages = Arguments.createArray()
        try {
          extractor.setDataSource(url, requestHeaders)
          val seen = mutableSetOf<String>()
          for (index in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(index)
            if (format.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") != true) continue
            val code = format.getString(MediaFormat.KEY_LANGUAGE)?.lowercase(Locale.ROOT) ?: continue
            if (code == "und" || code == "unknown" || code.isBlank() || !seen.add(code)) continue
            val language = Locale.forLanguageTag(code).getDisplayLanguage(Locale.ENGLISH)
            languages.pushMap(Arguments.createMap().apply {
              putString("code", code)
              putString("label", language.ifBlank { code.uppercase(Locale.ROOT) })
            })
          }
        } catch (_: Exception) {
          // Some sources omit track metadata or decline requests from the extractor.
        } finally {
          extractor.release()
        }
        promise.resolve(languages)
      }
    } catch (_: RejectedExecutionException) {
      promise.resolve(Arguments.createArray())
    }
  }

  override fun getName() = "MovieBoxPlaybackControls"

  private fun supportsPictureInPicture() = Build.VERSION.SDK_INT >= 26 &&
    context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  override fun getConstants(): Map<String, Any> =
    mapOf("pictureInPictureSupported" to supportsPictureInPicture())

  @ReactMethod
  fun canEnterPictureInPicture(promise: Promise) {
    val allowed = supportsPictureInPicture() &&
      AppOpsManagerCompat.noteOpNoThrow(context, AppOpsManager.OPSTR_PICTURE_IN_PICTURE,
        Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    promise.resolve(allowed)
  }

  private fun minimumVolume() = if (Build.VERSION.SDK_INT >= 28) {
    audio.getStreamMinVolume(AudioManager.STREAM_MUSIC)
  } else 0

  @ReactMethod
  fun getLevel(kind: String, promise: Promise) {
    context.runOnUiQueueThread {
      try {
        val level = when (kind) {
          "volume" -> {
            val min = minimumVolume()
            val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            (audio.getStreamVolume(AudioManager.STREAM_MUSIC) - min).toDouble() / (max - min).coerceAtLeast(1)
          }
          "brightness" -> {
            val current = context.currentActivity?.window?.attributes?.screenBrightness ?: -1f
            if (current >= 0) current.toDouble()
            else Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255.0
          }
          else -> throw IllegalArgumentException("Unknown playback control")
        }
        promise.resolve(level.coerceIn(0.0, 1.0))
      } catch (e: Exception) { promise.reject("PLAYBACK_LEVEL", e.message, e) }
    }
  }

  @ReactMethod
  fun setLevel(kind: String, value: Double) {
    if (!value.isFinite()) return
    context.runOnUiQueueThread {
      val level = value.coerceIn(0.0, 1.0)
      when (kind) {
        "volume" -> runCatching {
          val stream = AudioManager.STREAM_MUSIC
          val min = minimumVolume()
          val max = audio.getStreamMaxVolume(stream)
          val index = (min + level * (max - min)).roundToInt()
          if (audio.getStreamVolume(stream) != index) audio.setStreamVolume(stream, index, 0)
        }
        "brightness" -> {
          val activity = context.currentActivity ?: return@runOnUiQueueThread
          val window = activity.window
          val attributes = window.attributes
          if (brightnessActivity?.get() !== activity) {
            previousBrightness = attributes.screenBrightness
            brightnessActivity = WeakReference(activity)
          }
          attributes.screenBrightness = level.toFloat().coerceAtLeast(0.03f)
          window.attributes = attributes
        }
        else -> Unit
      }
    }
  }

  @ReactMethod
  fun restoreBrightness() {
    context.runOnUiQueueThread {
      brightnessActivity?.get()?.window?.let { window ->
        val attributes = window.attributes
        attributes.screenBrightness = previousBrightness
        window.attributes = attributes
      }
      brightnessActivity = null
    }
  }
}
