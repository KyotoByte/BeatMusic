package com.music.bitchord.data

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.music.bitchord.BuildConfig
import com.music.bitchord.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

/**
 * The update feed BeatMusic reads: a small public JSON file on GitHub
 * (raw.githubusercontent.com/KyotoByte/BeatMusic/main/update.json). Nothing
 * about the listener is sent; the app only reads that file.
 *
 *     { "versionCode": 2, "versionName": "1.1", "notes": "...",
 *       "apks":   { "arm64-v8a": "https://...apk", "universal": "https://...apk" },
 *       "sha256": { "arm64-v8a": "hex", "universal": "hex" } }
 *
 * Pure JVM so it is unit tested without a device.
 */
object UpdateFeed {
    const val FEED_URL = "https://raw.githubusercontent.com/KyotoByte/BeatMusic/main/update.json"
    const val RELEASES_URL = "https://github.com/KyotoByte/BeatMusic/releases/latest"
    const val MAX_JSON_BYTES = 64 * 1024

    @Serializable
    data class Feed(
        val versionCode: Long = 0,
        val versionName: String = "",
        val notes: String = "",
        val apks: Map<String, String> = emptyMap(),
        val sha256: Map<String, String> = emptyMap(),
        val releaseUrl: String = "",
    )

    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    fun parse(text: String?): Feed? {
        if (text.isNullOrBlank() || text.length > MAX_JSON_BYTES) return null
        val feed = runCatching { json.decodeFromString(Feed.serializer(), text) }.getOrNull() ?: return null
        return feed.takeIf { it.versionCode > 0 }
    }

    fun isNewer(feed: Feed?, installedVersionCode: Long): Boolean =
        feed != null && feed.versionCode > installedVersionCode

    /** The APK key for this phone: its primary ABI when the feed has one, else "universal". https only. */
    fun pickAbi(feed: Feed, supportedAbis: List<String>): String? {
        val candidates = supportedAbis.filter { it in feed.apks } + "universal"
        return candidates.firstOrNull { key -> feed.apks[key]?.let(::isHttps) == true }
    }

    fun isHttps(url: String): Boolean =
        url.startsWith("https://", ignoreCase = true) && url.length > "https://".length + 3 && ' ' !in url

    /** "1.0 (build 2)": the build number tells two releases of the same version name apart. */
    fun label(feed: Feed): String {
        val name = feed.versionName.trim().removePrefix("v").removePrefix("V")
        return if (name.isEmpty()) "build ${feed.versionCode}" else "$name (build ${feed.versionCode})"
    }

    fun sha256Hex(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun hashMatches(expected: String?, actual: String): Boolean =
        expected.isNullOrBlank() || expected.trim().equals(actual, ignoreCase = true)

    /** null when the downloaded APK is safe to hand to the installer, else the reason it was refused. */
    fun verifyArchive(
        expectedPackage: String,
        installedVersionCode: Long,
        installedSigners: Set<String>,
        apkPackage: String?,
        apkVersionCode: Long,
        apkSigners: Set<String>,
    ): String? = when {
        apkPackage == null -> "The downloaded file isn't a valid APK. Nothing was installed."
        apkPackage != expectedPackage -> "This file is a different app. Refused for your safety."
        installedSigners.isEmpty() || apkSigners.none { it in installedSigners } ->
            "Signature check failed: this APK isn't signed by the BeatMusic developer. Refused for your safety."
        apkVersionCode <= installedVersionCode -> "This APK isn't newer than the version you have."
        else -> null
    }
}

/**
 * BeatMusic ships as a sideloaded APK off GitHub, so there is no store to push
 * an update: this reads [UpdateFeed.FEED_URL] on launch (and from Settings →
 * Check for updates), shows the update dialog and a one-time notification, and
 * downloads, hash-checks and signature-checks the APK before handing it to the
 * system installer.
 */
object AppUpdateChecker {

    data class UpdateInfo(
        val version: String,
        val releaseUrl: String,
        val apkUrl: String?,
        /** The feed's notes, shown as this update's "what's new". */
        val notes: String?,
        val versionCode: Long = 0,
        val sha256: String? = null,
    )

    /** The outcome of the last check, for Settings' "Check for updates" row. */
    sealed interface CheckState {
        data object Idle : CheckState
        data object Checking : CheckState
        data object UpToDate : CheckState
        data class Available(val info: UpdateInfo) : CheckState
        data object Failed : CheckState
    }

    private const val CACHE_SUBDIR = "updates"
    private const val CHANNEL_ID = "app_updates"
    private const val NOTIFICATION_ID = 0x5EA7
    private const val PREFS = "beatmusic_updates"
    private const val KEY_LAST_NOTIFIED = "last_notified_version_code"

    private val _available = MutableStateFlow<UpdateInfo?>(null)
    val available = _available.asStateFlow()

    private val _checkState = MutableStateFlow<CheckState>(CheckState.Idle)
    val checkState = _checkState.asStateFlow()

    /** Bumped by "Check for updates" so a dialog the listener dismissed earlier shows again. */
    private val _showRequests = MutableStateFlow(0)
    val showRequests = _showRequests.asStateFlow()

    /** Where this update's APK download currently stands, for the dialog's progress row. */
    sealed interface DownloadState {
        data object Idle : DownloadState
        data class Downloading(val fraction: Float) : DownloadState
        data class Ready(val file: File) : DownloadState
        data class Failed(val message: String) : DownloadState
    }

    private val _download = MutableStateFlow<DownloadState>(DownloadState.Idle)
    val download = _download.asStateFlow()

    /** Set from the UI thread when the user cancels; polled between network reads. */
    @Volatile
    private var downloadCancelled = false

    /**
     * Reads the feed. [context] (when given) lets a newly found version post a
     * notification once; [userInitiated] re-opens the update dialog.
     */
    suspend fun check(context: Context? = null, userInitiated: Boolean = false) = withContext(Dispatchers.IO) {
        if (_checkState.value == CheckState.Checking) return@withContext
        _checkState.value = CheckState.Checking
        val feed = runCatching {
            val request = Request.Builder()
                .url(UpdateFeed.FEED_URL)
                .header("Cache-Control", "no-cache")
                .build()
            Http.client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) null else response.body?.string()
            }
        }.getOrNull().let(UpdateFeed::parse)
        if (feed == null) {
            _checkState.value = CheckState.Failed
            return@withContext
        }
        if (!UpdateFeed.isNewer(feed, BuildConfig.VERSION_CODE.toLong())) {
            _available.value = null
            _checkState.value = CheckState.UpToDate
            return@withContext
        }
        val abi = UpdateFeed.pickAbi(feed, Build.SUPPORTED_ABIS.toList())
        val info = UpdateInfo(
            version = UpdateFeed.label(feed),
            releaseUrl = feed.releaseUrl.takeIf(UpdateFeed::isHttps) ?: UpdateFeed.RELEASES_URL,
            apkUrl = abi?.let { feed.apks[it] },
            notes = feed.notes.ifBlank { null },
            versionCode = feed.versionCode,
            sha256 = abi?.let { feed.sha256[it] },
        )
        _available.value = info
        _checkState.value = CheckState.Available(info)
        if (userInitiated) _showRequests.value = _showRequests.value + 1
        context?.let { runCatching { notifyOnce(it.applicationContext, info) } }
    }

    @SuppressLint("MissingPermission")
    private fun notifyOnce(context: Context, info: UpdateInfo) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (info.versionCode <= prefs.getLong(KEY_LAST_NOTIFIED, 0L)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_DEFAULT),
            )
        }
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = launch?.let {
            PendingIntent.getActivity(
                context, NOTIFICATION_ID, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_logo)
            .setContentTitle("New update available: v${info.version}")
            .setContentText(info.notes?.lineSequence()?.firstOrNull()?.take(120) ?: "Tap to update BeatMusic")
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
        prefs.edit().putLong(KEY_LAST_NOTIFIED, info.versionCode).apply()
    }

    /**
     * Wipes any APK left over from a previous run. Called once at cold start
     * so a downloaded update is only ever "Install Now" for the session that
     * downloaded it.
     */
    suspend fun clearCache(context: Context) = withContext(Dispatchers.IO) {
        File(context.cacheDir, CACHE_SUBDIR).listFiles()?.forEach { it.delete() }
    }

    /**
     * Streams the current update's APK into the app cache, reporting progress
     * through [download], then checks its SHA-256 against the feed and its
     * package, version and signing certificate against the installed app.
     */
    suspend fun downloadApk(context: Context): Unit = withContext(Dispatchers.IO) {
        val info = _available.value ?: return@withContext
        val url = info.apkUrl ?: return@withContext
        downloadCancelled = false
        _download.value = DownloadState.Downloading(0f)

        runCatching {
            val dir = File(context.cacheDir, CACHE_SUBDIR).apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val target = File(dir, "beatmusic-${info.versionCode}.apk")

            val request = Request.Builder().url(url).build()
            Http.client.newCall(request).execute().use { response ->
                check(response.isSuccessful) { "Download failed (HTTP ${response.code}). Try again." }
                val body = response.body ?: error("Download failed: empty file")
                val total = body.contentLength().takeIf { it > 0 }

                body.byteStream().use { input ->
                    target.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var readTotal = 0L
                        var lastFraction = -1f
                        while (true) {
                            if (downloadCancelled) {
                                _download.value = DownloadState.Idle
                                return@withContext
                            }
                            val read = input.read(buffer)
                            if (read == -1) break
                            output.write(buffer, 0, read)
                            readTotal += read
                            total?.let {
                                val fraction = (readTotal.toFloat() / it).coerceIn(0f, 1f)
                                // ~200 UI updates per download rather than one per 64 KB read.
                                if (fraction - lastFraction >= 0.005f || fraction >= 1f) {
                                    lastFraction = fraction
                                    _download.value = DownloadState.Downloading(fraction)
                                }
                            }
                        }
                    }
                }
            }
            val actualHash = UpdateFeed.sha256Hex(target)
            if (!UpdateFeed.hashMatches(info.sha256, actualHash)) {
                target.delete()
                error("The download was damaged (checksum mismatch). Nothing was installed. Try again.")
            }
            verifyArchive(context, target)?.let { reason ->
                target.delete()
                error(reason)
            }
            _download.value = DownloadState.Ready(target)
        }.onFailure { error ->
            _download.value = if (downloadCancelled) {
                DownloadState.Idle
            } else {
                DownloadState.Failed(error.message ?: "Download failed")
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun signerDigests(info: PackageInfo?): Set<String> {
        if (info == null) return emptySet()
        val sigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signing = info.signingInfo ?: return emptySet()
            if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
        } else {
            info.signatures
        } ?: return emptySet()
        return sigs.mapTo(mutableSetOf()) { sig ->
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
        }
    }

    @Suppress("DEPRECATION")
    private fun verifyArchive(context: Context, file: File): String? {
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        val installed = runCatching { pm.getPackageInfo(context.packageName, flags) }.getOrNull()
        val archive = runCatching { pm.getPackageArchiveInfo(file.absolutePath, flags) }.getOrNull()
        val archiveCode = archive?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode else it.versionCode.toLong()
        } ?: 0L
        return UpdateFeed.verifyArchive(
            expectedPackage = context.packageName,
            installedVersionCode = BuildConfig.VERSION_CODE.toLong(),
            installedSigners = signerDigests(installed),
            apkPackage = archive?.packageName,
            apkVersionCode = archiveCode,
            apkSigners = signerDigests(archive),
        )
    }

    /** Stops an in-flight download; the next read loop sees this and bails. */
    fun cancelDownload() {
        downloadCancelled = true
    }

    /** Back to square one after a failure, so the dialog offers Download again. */
    fun resetDownload() {
        _download.value = DownloadState.Idle
    }

    /**
     * Hands a downloaded APK to the system installer.
     *
     * Sideloaded apps need the user's blessing per app ("install unknown apps");
     * without it the installer intent silently does nothing on most ROMs, so
     * the user is sent to that one switch first and taps Install again after.
     * Some TV builds have no such settings screen; there the installer is
     * launched anyway and shows its own "not allowed" prompt with a way in.
     */
    fun installApk(context: Context, file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            val opened = runCatching {
                context.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                        .setData(Uri.parse("package:${context.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }.isSuccess
            if (opened) return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        context.startActivity(
            Intent(Intent.ACTION_INSTALL_PACKAGE)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
                .putExtra(Intent.EXTRA_RETURN_RESULT, true)
                .addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_ACTIVITY_NEW_TASK,
                ),
        )
    }
}
