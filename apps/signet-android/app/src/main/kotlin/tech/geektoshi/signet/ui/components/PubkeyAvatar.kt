package tech.geektoshi.signet.ui.components

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import tech.geektoshi.signet.data.api.SignetApiClient

/**
 * FNV-1a over the pubkey hex — deterministic, dependency-free, matching the web `PubkeyAvatar`
 * so the same key yields the same disc and a spoofed name on a *different* key looks different.
 */
private fun hashPubkey(pubkey: String): Int {
    var h = -0x7ee3623b // 0x811c9dc5 as a signed Int
    for (c in pubkey) {
        h = h xor c.code
        h *= 0x01000193
    }
    return h
}

private fun identiconBrush(pubkey: String): Brush {
    if (pubkey.isEmpty()) {
        val neutral = Color(0xFF2A2A2A)
        return Brush.linearGradient(listOf(neutral, neutral))
    }
    val h = hashPubkey(pubkey)
    val hue1 = ((h % 360) + 360) % 360
    val hue2 = (hue1 + 90 + ((h ushr 8) % 180)) % 360
    return Brush.linearGradient(
        listOf(
            Color.hsv(hue1.toFloat(), 0.65f, 0.55f),
            Color.hsv(hue2.toFloat(), 0.70f, 0.45f),
        )
    )
}

/**
 * A deterministic gradient-disc identicon seeded from a pubkey. Decorative — the adjacent
 * name/npub conveys identity; this is a fast visual fingerprint to recognize a returning app
 * and notice an impostor at a glance.
 */
@Composable
fun PubkeyIdenticon(pubkey: String, size: Dp, modifier: Modifier = Modifier) {
    val brush = remember(pubkey) { identiconBrush(pubkey) }
    Canvas(modifier = modifier.size(size).clip(CircleShape)) {
        drawRect(brush = brush)
    }
}

/**
 * App avatar with a safe image path. When the app supplied an image (`hasImage`) we load it
 * from the daemon's SSRF-guarded proxy (`GET /apps/:id/avatar`) — never the raw client URL —
 * and fall back to the [PubkeyIdenticon] when there's no image or the proxy returns nothing.
 *
 * When [ringColor] is set, the avatar is framed by a status ring/halo of that colour — this
 * replaces a separate status dot, so the avatar and its connection/suspension state read as
 * one element (matching the web dashboard).
 */
@Composable
fun AppAvatar(
    pubkey: String,
    appId: Int,
    hasImage: Boolean,
    daemonUrl: String?,
    size: Dp,
    modifier: Modifier = Modifier,
    ringColor: Color? = null,
) {
    var bitmap by remember(appId, hasImage, daemonUrl) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(appId, hasImage, daemonUrl) { mutableStateOf(false) }

    LaunchedEffect(appId, hasImage, daemonUrl) {
        if (!hasImage || daemonUrl.isNullOrBlank()) return@LaunchedEffect
        try {
            val bytes = withContext(Dispatchers.IO) {
                val client = SignetApiClient(daemonUrl)
                try {
                    client.getAppAvatar(appId)
                } finally {
                    client.close()
                }
            }
            val decoded = bytes?.let {
                withContext(Dispatchers.Default) {
                    BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap()
                }
            }
            if (decoded != null) bitmap = decoded else failed = true
        } catch (_: Exception) {
            failed = true
        }
    }

    val current = bitmap
    Box(
        modifier = if (ringColor != null) {
            modifier.border(width = 1.5.dp, color = ringColor, shape = CircleShape).padding(3.dp)
        } else {
            modifier
        },
        contentAlignment = Alignment.Center,
    ) {
        if (hasImage && !failed && current != null) {
            Image(
                bitmap = current,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size).clip(CircleShape),
            )
        } else {
            PubkeyIdenticon(pubkey = pubkey, size = size)
        }
    }
}
