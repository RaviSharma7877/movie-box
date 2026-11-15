package com.moviebox.app

import android.content.ClipData
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.BaseColumns
import android.provider.MediaStore
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.util.Clock
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.FileDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultDecoderFactory
import androidx.media3.transformer.ExoPlayerAssetLoader
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.Executors

@OptIn(UnstableApi::class)
class VideoLibraryBridge(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val io = Executors.newFixedThreadPool(5)
  private val main = Handler(Looper.getMainLooper())
  private val folder = "${Environment.DIRECTORY_MOVIES}/MovieBox/"
  private val resolver get() = context.contentResolver

  override fun getName() = "MovieBoxVideoLibrary"

  override fun invalidate() {
    io.shutdown()
    super.invalidate()
  }

  @ReactMethod
  fun publish(source: String, title: String, identity: String, playlist: Boolean, promise: Promise) {
    io.execute {
      try {
        check(Build.VERSION.SDK_INT >= 29) { "Sharing downloads requires Android 10 or later." }
        val root = File(context.filesDir, "moviebox_downloads").canonicalFile
        val uri = Uri.parse(source)
        require(uri.scheme == "file") { "Expected a saved video file." }
        val input = File(requireNotNull(uri.path)).canonicalFile
        val name = displayName(title, identity)
        val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        // A previous attempt may have published successfully before the queue was saved.
        val existing = findPublished(collection, name)
        if (existing != null) {
          result(existing, name, promise)
          return@execute
        }
        require(input.path.startsWith(root.path + File.separator) && input.isFile && input.length() > 0) {
          "The saved video could not be found."
        }
        if (playlist) {
          // Keep the temporary MP4 on the same volume and publish only after export succeeds.
          val output = File(context.cacheDir, "moviebox-export-" + name.substringAfterLast(" - "))
          if (output.exists()) output.delete()
          main.post { exportPlaylist(input, output, collection, name, promise) }
        } else {
          publishFile(input, collection, name, promise)
        }
      } catch (e: Exception) {
        promise.reject("VIDEO_LIBRARY", e.message, e)
      }
    }
  }

  private fun displayName(title: String, identity: String): String {
    val clean = title.replace(Regex("""[\\/:*?"<>|\p{Cntrl}]"""), "_")
      .trim(' ', '.').take(120).trimEnd().ifBlank { "MovieBox video" }
    val suffix = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray())
      .take(6).joinToString("") { "%02x".format(it.toInt() and 255) }
    return "$clean - $suffix.mp4"
  }

  private fun findPublished(collection: Uri, name: String): Uri? {
    val id = MediaStore.Video.Media._ID
    val filter = "${MediaStore.Video.Media.RELATIVE_PATH}=? AND ${MediaStore.Video.Media.DISPLAY_NAME}=? AND " +
      "${MediaStore.Video.Media.IS_PENDING}=0 AND ${MediaStore.Video.Media.SIZE}>0 AND " +
      "${MediaStore.Video.Media.OWNER_PACKAGE_NAME}=?"
    return resolver.query(collection, arrayOf(id), filter, arrayOf(folder, name, context.packageName), null)
      ?.use { if (it.moveToFirst()) ContentUris.withAppendedId(collection, it.getLong(0)) else null }
  }

  private fun result(uri: Uri, name: String, promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putString("uri", uri.toString())
      putString("filename", name)
    })
  }

  private fun publishFile(input: File, collection: Uri, name: String, promise: Promise) {
    var pending: Uri? = null
    try {
      check(input.length() > 0) { "The exported video is empty." }
      val extractor = MediaExtractor()
      try {
        extractor.setDataSource(input.path)
        check((0 until extractor.trackCount).any {
          extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
        }) { "The saved file doesn’t contain a video track." }
      } finally {
        extractor.release()
      }
      val values = ContentValues().apply {
        put(MediaStore.Video.Media.DISPLAY_NAME, name)
        put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
        put(MediaStore.Video.Media.RELATIVE_PATH, folder)
        put(MediaStore.Video.Media.IS_PENDING, 1)
      }
      val destination = resolver.insert(collection, values) ?: throw IOException("Could not create a video in Movies.")
      pending = destination
      val output = resolver.openOutputStream(destination, "w") ?: throw IOException("Could not open the video for writing.")
      output.use { stream -> input.inputStream().use { it.copyTo(stream, 256 * 1024) } }
      val finished = ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }
      check(resolver.update(destination, finished, null, null) == 1) { "Could not finish saving the video." }
      pending = null
      val actualName = resolver.query(destination, arrayOf(MediaStore.Video.Media.DISPLAY_NAME), null, null, null)
        ?.use { if (it.moveToFirst()) it.getString(0) else null }
      result(destination, actualName ?: name, promise)
    } catch (e: Exception) {
      pending?.let { runCatching { resolver.delete(it, null, null) } }
      promise.reject("VIDEO_LIBRARY", e.message, e)
    }
  }

  private fun exportPlaylist(input: File, output: File, collection: Uri, name: String, promise: Promise) {
    var finished = false
    var timeout: Runnable? = null
    try {
      // Local file data sources also cover encrypted HLS, without making any network requests.
      val sources = DefaultMediaSourceFactory(DataSource.Factory { FileDataSource() })
      val transformer = Transformer.Builder(context)
        .setAssetLoaderFactory(ExoPlayerAssetLoader.Factory(
          context, DefaultDecoderFactory.Builder(context).build(), Clock.DEFAULT, sources
        ))
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            if (finished) return
            finished = true
            timeout?.let { main.removeCallbacks(it) }
            io.execute {
              try { publishFile(output, collection, name, promise) } finally { output.delete() }
            }
          }

          override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
            if (finished) return
            finished = true
            timeout?.let { main.removeCallbacks(it) }
            output.delete()
            promise.reject("VIDEO_EXPORT", "Couldn’t turn this episode into a Gallery video.", exportException)
          }
        })
        .build()
      timeout = Runnable {
        if (!finished) {
          finished = true
          transformer.cancel()
          output.delete()
          promise.reject("VIDEO_EXPORT", "Preparing the Gallery video took too long.")
        }
      }
      transformer.start(MediaItem.fromUri(Uri.fromFile(input)), output.path)
      main.postDelayed(requireNotNull(timeout), 20 * 60 * 1000L)
    } catch (e: Exception) {
      timeout?.let { main.removeCallbacks(it) }
      output.delete()
      promise.reject("VIDEO_EXPORT", e.message, e)
    }
  }

  private fun sharedUri(value: String): Uri = Uri.parse(value).also {
    require(it.scheme == "content" && it.authority == MediaStore.AUTHORITY && it.pathSegments.take(3) ==
      listOf(MediaStore.VOLUME_EXTERNAL_PRIMARY, "video", "media"))
  }

  @ReactMethod
  fun exists(value: String, promise: Promise) {
    io.execute {
      try {
        val storageState = Environment.getExternalStorageState()
        check(storageState == Environment.MEDIA_MOUNTED || storageState == Environment.MEDIA_MOUNTED_READ_ONLY) {
          "The device video library is temporarily unavailable."
        }
        val uri = sharedUri(value)
        val columns = if (Build.VERSION.SDK_INT >= 30) {
          arrayOf(BaseColumns._ID, MediaStore.MediaColumns.IS_TRASHED)
        } else arrayOf(BaseColumns._ID)
        val visible = checkNotNull(resolver.query(uri, columns, null, null, null)).use { cursor ->
          cursor.moveToFirst() && (Build.VERSION.SDK_INT < 30 || cursor.getInt(1) == 0)
        }
        if (!visible) {
          promise.resolve(false)
        } else {
          val exists = resolver.openFileDescriptor(uri, "r")?.use { true }
          promise.resolve(checkNotNull(exists))
        }
      } catch (_: FileNotFoundException) {
        promise.resolve(false)
      } catch (error: Exception) {
        promise.reject("VIDEO_ACCESS", error.message, error)
      }
    }
  }

  @ReactMethod
  fun remove(value: String, promise: Promise) {
    io.execute {
      try {
        resolver.delete(sharedUri(value), null, null)
        promise.resolve(null)
      } catch (e: Exception) { promise.reject("VIDEO_DELETE", e.message, e) }
    }
  }

  @ReactMethod
  fun open(value: String, promise: Promise) {
    main.post {
      try {
        val uri = sharedUri(value)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "video/mp4")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData = ClipData.newRawUri("MovieBox video", uri)
        val activity = context.currentActivity ?: throw IllegalStateException("Open MovieBox to choose a video player.")
        activity.startActivity(Intent.createChooser(intent, "Open video with"))
        promise.resolve(null)
      } catch (e: Exception) { promise.reject("VIDEO_OPEN", e.message, e) }
    }
  }
}
