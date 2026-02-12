package tech.geektoshi.signet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.BgTertiary
import tech.geektoshi.signet.ui.theme.BorderDefault
import tech.geektoshi.signet.ui.theme.Danger
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.Success
import tech.geektoshi.signet.ui.theme.Teal
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.Warning

/**
 * Parsed nostrconnect URI data
 */
data class ParsedNostrconnect(
    val clientPubkey: String,
    val relays: List<String>,
    val secret: String,
    val permissions: List<String>,
    val name: String?,
    val url: String?
)

/**
 * Parse a nostrconnect:// URI
 */
fun parseNostrconnectUri(uri: String): Result<ParsedNostrconnect> {
    val trimmed = uri.trim()

    if (!trimmed.startsWith("nostrconnect://")) {
        return Result.failure(Exception("URI must start with nostrconnect://"))
    }

    val withoutScheme = trimmed.substring("nostrconnect://".length)
    if (withoutScheme.isEmpty() || withoutScheme.startsWith("?")) {
        return Result.failure(Exception("Client pubkey is required"))
    }

    return try {
        // Parse using URL-like structure
        val questionIndex = withoutScheme.indexOf('?')
        val clientPubkey = if (questionIndex >= 0) {
            withoutScheme.substring(0, questionIndex).lowercase()
        } else {
            withoutScheme.lowercase()
        }

        if (!clientPubkey.matches(Regex("^[0-9a-f]{64}$"))) {
            return Result.failure(Exception("Client pubkey must be 64 hex characters"))
        }

        val params = if (questionIndex >= 0) {
            withoutScheme.substring(questionIndex + 1)
                .split("&")
                .mapNotNull { param ->
                    val eqIndex = param.indexOf('=')
                    if (eqIndex > 0) {
                        val key = param.substring(0, eqIndex)
                        val value = java.net.URLDecoder.decode(param.substring(eqIndex + 1), "UTF-8")
                        key to value
                    } else null
                }
                .groupBy({ it.first }, { it.second })
        } else {
            emptyMap()
        }

        val rawRelays = params["relay"] ?: emptyList()
        if (rawRelays.isEmpty()) {
            return Result.failure(Exception("At least one relay is required"))
        }

        // Validate and normalize relays
        val relays = mutableListOf<String>()
        val invalidRelays = mutableListOf<String>()
        for (relay in rawRelays) {
            val normalized = normalizeRelayUrl(relay)
            if (normalized != null) {
                relays.add(normalized)
            } else if (relay.trim().isNotEmpty()) {
                invalidRelays.add(relay)
            }
        }

        if (relays.isEmpty()) {
            val invalidList = if (invalidRelays.isNotEmpty()) ": ${invalidRelays.joinToString(", ")}" else ""
            return Result.failure(Exception("No valid relay URLs$invalidList"))
        }

        val secret = params["secret"]?.firstOrNull()
        if (secret.isNullOrEmpty()) {
            return Result.failure(Exception("Secret is required"))
        }

        val permissions = params["perms"]?.firstOrNull()
            ?.split(",")
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?: emptyList()

        Result.success(ParsedNostrconnect(
            clientPubkey = clientPubkey,
            relays = relays,
            secret = secret,
            permissions = permissions,
            name = params["name"]?.firstOrNull(),
            url = params["url"]?.firstOrNull()
        ))
    } catch (e: Exception) {
        Result.failure(Exception("Invalid URI format"))
    }
}

private val WSS_RELAY_REGEX = Regex("^wss?://.+", RegexOption.IGNORE_CASE)

/**
 * Normalize and validate a relay URL.
 * Returns the normalized URL or null if invalid.
 * Strips trailing slashes for consistent cache keys and API lookups.
 */
private fun normalizeRelayUrl(relay: String): String? {
    val trimmed = relay.trim()
    if (trimmed.isEmpty()) return null

    // Add wss:// if no scheme
    var normalized = if (trimmed.startsWith("wss://") || trimmed.startsWith("ws://")) {
        trimmed
    } else {
        "wss://$trimmed"
    }

    // Strip trailing slashes for consistency with trustedrelays.xyz API
    normalized = normalized.trimEnd('/')

    // Validate the URL format
    if (!WSS_RELAY_REGEX.matches(normalized)) {
        return null
    }

    // Try to parse as URL to catch malformed URLs
    return try {
        java.net.URL(normalized.replace("wss://", "https://").replace("ws://", "http://"))
        normalized
    } catch (e: Exception) {
        null
    }
}

/**
 * Normalize a relay URL for display and score lookup.
 * Public version for use in UI components.
 */
fun normalizeRelayUrlForDisplay(relay: String): String {
    return relay.trimEnd('/')
}

/**
 * Format a permission for display
 */
fun formatPermission(perm: String): String {
    val methodLabels = mapOf(
        "sign_event" to "Sign events",
        "nip04_encrypt" to "NIP-04 encryption",
        "nip04_decrypt" to "NIP-04 decryption",
        "nip44_encrypt" to "NIP-44 encryption",
        "nip44_decrypt" to "NIP-44 decryption",
        "get_public_key" to "Get public key",
        "connect" to "Connect",
        "ping" to "Ping"
    )

    val kindLabels = mapOf(
        0 to "profile metadata",
        1 to "notes",
        3 to "contact list",
        4 to "DMs (NIP-04)",
        6 to "reposts",
        7 to "reactions",
        9734 to "zap requests",
        9735 to "zap receipts",
        10002 to "relay list",
        30023 to "long-form content"
    )

    return if (perm.contains(":")) {
        val parts = perm.split(":")
        val method = parts[0]
        val kind = parts.getOrNull(1)?.toIntOrNull()
        if (method == "sign_event" && kind != null) {
            val kindLabel = kindLabels[kind] ?: "kind $kind"
            "Sign $kindLabel"
        } else {
            methodLabels[method] ?: perm
        }
    } else {
        methodLabels[perm] ?: perm
    }
}

/**
 * Truncate a pubkey for display
 */
fun truncatePubkey(pubkey: String): String {
    return if (pubkey.length > 16) {
        "${pubkey.take(8)}...${pubkey.takeLast(8)}"
    } else pubkey
}

/**
 * Styled radio button option for key selection
 */
@Composable
fun KeyOption(
    keyName: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(
                width = 1.dp,
                color = if (selected) SignetPurple else BorderDefault,
                shape = RoundedCornerShape(8.dp)
            )
            .background(if (selected) SignetPurple.copy(alpha = 0.1f) else BgTertiary)
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .border(2.dp, if (selected) SignetPurple else TextMuted, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (selected) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .background(SignetPurple, CircleShape)
                )
            }
        }

        Text(
            text = keyName,
            style = MaterialTheme.typography.bodyMedium,
            color = TextPrimary
        )
    }
}

/**
 * Styled radio button option for trust level selection
 */
@Composable
fun TrustLevelOption(
    label: String,
    description: String,
    selected: Boolean,
    recommended: Boolean = false,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(
                width = 1.dp,
                color = if (selected) SignetPurple else BorderDefault,
                shape = RoundedCornerShape(8.dp)
            )
            .background(if (selected) SignetPurple.copy(alpha = 0.1f) else BgTertiary)
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .border(2.dp, if (selected) SignetPurple else TextMuted, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            if (selected) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .background(SignetPurple, CircleShape)
                )
            }
        }

        Column(modifier = Modifier.weight(1f)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextPrimary
                )
                if (recommended) {
                    Text(
                        text = "Recommended",
                        style = MaterialTheme.typography.labelSmall,
                        color = Success,
                        modifier = Modifier
                            .background(Success.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = TextMuted
            )
        }
    }
}

/**
 * Card showing client info (pubkey, relays, URL)
 */
@Composable
fun ClientInfoCard(
    clientPubkey: String,
    relays: List<String>,
    url: String? = null
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(BgSecondary, RoundedCornerShape(8.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text("Client", style = MaterialTheme.typography.labelSmall, color = TextMuted)
            Text(
                truncatePubkey(clientPubkey),
                style = MaterialTheme.typography.bodySmall,
                color = TextPrimary
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text("Relays", style = MaterialTheme.typography.labelSmall, color = TextMuted)
            Text(
                relays.joinToString(", ") { it.removePrefix("wss://") },
                style = MaterialTheme.typography.bodySmall,
                color = TextPrimary
            )
        }
        url?.let { appUrl ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("URL", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                Text(
                    appUrl.removePrefix("https://").removePrefix("http://"),
                    style = MaterialTheme.typography.bodySmall,
                    color = SignetPurple
                )
            }
        }
    }
}

/**
 * Flow row of permission badges
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PermissionsBadges(
    permissions: List<String>
) {
    FlowRow(
        modifier = Modifier
            .fillMaxWidth()
            .background(BgSecondary, RoundedCornerShape(8.dp))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        permissions.forEach { perm ->
            Text(
                text = formatPermission(perm),
                style = MaterialTheme.typography.labelSmall,
                color = SignetPurple,
                modifier = Modifier
                    .background(SignetPurple.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            )
        }
    }
}

/**
 * Get color for trust score badge
 */
private fun getScoreColor(score: Int?): androidx.compose.ui.graphics.Color {
    return when {
        score == null -> TextMuted
        score >= 80 -> Success
        score >= 60 -> Teal
        score >= 40 -> Warning
        else -> Danger
    }
}

/**
 * Single relay badge with trust score
 */
@Composable
fun RelayBadge(
    relayUrl: String,
    score: Int?,
    isLoading: Boolean = false,
    modifier: Modifier = Modifier
) {
    val displayUrl = relayUrl
        .removePrefix("wss://")
        .removePrefix("ws://")
        .trimEnd('/')
    val scoreColor = getScoreColor(score)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(BgSecondary, RoundedCornerShape(6.dp))
            .border(1.dp, BorderDefault, RoundedCornerShape(6.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = displayUrl,
            style = MaterialTheme.typography.labelSmall,
            color = TextPrimary,
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )

        if (isLoading) {
            androidx.compose.material3.CircularProgressIndicator(
                modifier = Modifier.padding(start = 8.dp).size(12.dp),
                strokeWidth = 1.5.dp,
                color = TextMuted
            )
        } else {
            Text(
                text = score?.toString() ?: "?",
                style = MaterialTheme.typography.labelSmall,
                color = scoreColor,
                modifier = Modifier
                    .padding(start = 8.dp)
                    .background(scoreColor.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
    }
}

/**
 * Two-column grid of relay badges with trust scores
 */
@Composable
fun RelayBadgesGrid(
    relays: List<String>,
    scores: Map<String, Int?>,
    isLoading: Boolean = false
) {
    // Use a simple column with rows of 2 for a cleaner grid layout
    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        relays.chunked(2).forEach { rowRelays ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                rowRelays.forEach { relay ->
                    val normalizedUrl = normalizeRelayUrlForDisplay(relay)
                    RelayBadge(
                        relayUrl = normalizedUrl,
                        score = scores[normalizedUrl],
                        isLoading = isLoading,
                        modifier = Modifier.weight(1f)
                    )
                }
                // If odd number, add empty spacer for equal column width
                if (rowRelays.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}
