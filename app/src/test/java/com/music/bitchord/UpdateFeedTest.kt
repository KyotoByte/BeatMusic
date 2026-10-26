package com.music.bitchord

import com.music.bitchord.data.UpdateFeed
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class UpdateFeedTest {
    private val sample = """
        {"versionCode": 3, "versionName": "1.1", "notes": "Liquid Glass",
         "apks": {"arm64-v8a": "https://github.com/KyotoByte/BeatMusic/releases/download/v1.1/BeatMusic-arm64-v8a.apk",
                  "universal": "https://github.com/KyotoByte/BeatMusic/releases/download/v1.1/BeatMusic-universal.apk",
                  "x86": "http://insecure.example/app.apk"},
         "sha256": {"arm64-v8a": "ABCDEF"}, "extra": true}
    """.trimIndent()

    @Test fun parsesFeedAndIgnoresUnknownKeys() {
        val feed = UpdateFeed.parse(sample)
        assertNotNull(feed)
        assertEquals(3L, feed!!.versionCode)
        assertEquals("1.1 (build 3)", UpdateFeed.label(feed))
    }

    @Test fun rejectsGarbageEmptyAndZeroVersion() {
        assertNull(UpdateFeed.parse(null))
        assertNull(UpdateFeed.parse(""))
        assertNull(UpdateFeed.parse("<html>404</html>"))
        assertNull(UpdateFeed.parse("{\"versionCode\": 0}"))
        assertNull(UpdateFeed.parse("x".repeat(UpdateFeed.MAX_JSON_BYTES + 1)))
    }

    @Test fun newerOnlyWhenVersionCodeIsHigher() {
        val feed = UpdateFeed.parse(sample)
        assertTrue(UpdateFeed.isNewer(feed, 2))
        assertFalse(UpdateFeed.isNewer(feed, 3))
        assertFalse(UpdateFeed.isNewer(feed, 4))
        assertFalse(UpdateFeed.isNewer(null, 1))
    }

    @Test fun picksPrimaryAbiThenUniversalAndNeverHttp() {
        val feed = UpdateFeed.parse(sample)!!
        assertEquals("arm64-v8a", UpdateFeed.pickAbi(feed, listOf("arm64-v8a", "armeabi-v7a")))
        assertEquals("universal", UpdateFeed.pickAbi(feed, listOf("armeabi-v7a")))
        assertEquals("universal", UpdateFeed.pickAbi(feed, listOf("x86")))
        assertNull(UpdateFeed.pickAbi(feed.copy(apks = mapOf("x86" to "http://a.b/c.apk")), listOf("x86")))
    }

    @Test fun hashCheck() {
        val f = File.createTempFile("feed", ".bin").apply { writeText("abc"); deleteOnExit() }
        val hex = UpdateFeed.sha256Hex(f)
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex)
        assertTrue(UpdateFeed.hashMatches(hex.uppercase(), hex))
        assertTrue(UpdateFeed.hashMatches(null, hex))
        assertFalse(UpdateFeed.hashMatches("00", hex))
    }

    @Test fun archiveVerification() {
        val ok = UpdateFeed.verifyArchive("p", 2, setOf("a"), "p", 3, setOf("a"))
        assertNull(ok)
        assertNotNull(UpdateFeed.verifyArchive("p", 2, setOf("a"), null, 3, setOf("a")))
        assertNotNull(UpdateFeed.verifyArchive("p", 2, setOf("a"), "q", 3, setOf("a")))
        assertNotNull(UpdateFeed.verifyArchive("p", 2, setOf("a"), "p", 3, setOf("b")))
        assertNotNull(UpdateFeed.verifyArchive("p", 2, emptySet(), "p", 3, setOf("b")))
        assertNotNull(UpdateFeed.verifyArchive("p", 2, setOf("a"), "p", 2, setOf("a")))
    }
}
