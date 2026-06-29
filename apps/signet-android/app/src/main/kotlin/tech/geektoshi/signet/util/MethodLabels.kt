package tech.geektoshi.signet.util

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.VpnKey
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Get an icon for a NIP-46 method
 */
fun getMethodIcon(method: String): ImageVector {
    return when (method) {
        "connect" -> Icons.Outlined.Link
        "sign_event" -> Icons.Outlined.Edit
        "get_public_key" -> Icons.Outlined.VpnKey
        "nip04_encrypt", "nip44_encrypt" -> Icons.Outlined.Lock
        "nip04_decrypt", "nip44_decrypt" -> Icons.Outlined.LockOpen
        "logout" -> Icons.Outlined.LinkOff
        else -> Icons.Outlined.Edit
    }
}

/**
 * Convert method names to human-readable labels (present tense)
 */
fun getMethodLabel(method: String, eventKind: Int? = null): String {
    return when (method) {
        "connect" -> "Connect"
        "sign_event" -> getSignEventLabel(eventKind)
        "get_public_key" -> "Get public key"
        "nip04_encrypt" -> "Encrypt message (NIP-04)"
        "nip04_decrypt" -> "Decrypt message (NIP-04)"
        "nip44_encrypt" -> "Encrypt message (NIP-44)"
        "nip44_decrypt" -> "Decrypt message (NIP-44)"
        "ping" -> "Ping"
        "logout" -> "Disconnect"
        else -> method
    }
}

/**
 * Convert method names to human-readable labels (past tense for activity feed)
 */
fun getMethodLabelPastTense(method: String, eventKind: Int? = null): String {
    return when (method) {
        "connect" -> "Connected"
        "sign_event" -> getSignEventLabelPastTense(eventKind)
        "get_public_key" -> "Shared public key"
        "nip04_encrypt" -> "Encrypted message"
        "nip04_decrypt" -> "Decrypted message"
        "nip44_encrypt" -> "Encrypted message"
        "nip44_decrypt" -> "Decrypted message"
        "ping" -> "Pinged"
        "logout" -> "Disconnected"
        else -> method
    }
}

private fun getSignEventLabel(kind: Int?): String {
    return when (kind) {
        0 -> "Update profile"
        1 -> "Sign a note"
        3 -> "Update contacts"
        4 -> "Send DM"
        5 -> "Delete event"
        6 -> "Repost"
        7 -> "Sign a reaction"
        9 -> "Sign chat message"
        9734 -> "Sign zap request"
        9735 -> "Sign zap"
        10002 -> "Update relay list"
        22242 -> "Sign http auth"
        24133 -> "Sign NIP-46 response"
        27235 -> "Sign http auth"
        30023 -> "Sign article"
        else -> if (kind != null) "Sign event (kind $kind)" else "Sign event"
    }
}

private fun getSignEventLabelPastTense(kind: Int?): String {
    return when (kind) {
        0 -> "Updated profile"
        1 -> "Signed a note"
        3 -> "Updated contacts"
        4 -> "Sent DM"
        5 -> "Deleted event"
        6 -> "Reposted"
        7 -> "Signed a reaction"
        9 -> "Signed chat message"
        9734 -> "Signed zap request"
        9735 -> "Signed zap"
        10002 -> "Updated relay list"
        22242 -> "Signed http auth"
        24133 -> "Signed NIP-46 response"
        27235 -> "Signed http auth"
        30023 -> "Signed article"
        else -> if (kind != null) "Signed event (kind $kind)" else "Signed event"
    }
}

/**
 * Get a description for an event kind
 */
fun getKindLabel(kind: Int): String {
    return when (kind) {
        0 -> "Metadata"
        1 -> "Note"
        3 -> "Contacts"
        4 -> "DM"
        5 -> "Delete"
        6 -> "Repost"
        7 -> "Reaction"
        8 -> "Badge Award"
        9 -> "Chat Message"
        10 -> "Group Chat"
        1984 -> "Report"
        9734 -> "Zap Request"
        9735 -> "Zap"
        10000 -> "Mute List"
        10001 -> "Pin List"
        10002 -> "Relay List"
        22242 -> "HTTP Auth"
        27235 -> "HTTP Auth"
        30000 -> "Categorized People"
        30001 -> "Categorized Bookmarks"
        30023 -> "Long-form Content"
        30078 -> "App-specific Data"
        else -> "Kind $kind"
    }
}

/**
 * Event kinds that are sensitive and warrant an extra cue before signing — they can change
 * identity, leak data, or carry security/financial weight. Mirrors `SENSITIVE_KINDS` in
 * `@signet/types` so the cue matches the web dashboard and extension.
 */
private val SENSITIVE_KINDS = setOf(
    0,      // Profile metadata (identity)
    3,      // Contact/follow list (social graph)
    4,      // NIP-04 encrypted DM (privacy)
    5,      // Event deletion (irreversible)
    10002,  // Relay list (connectivity)
    22242,  // Client authentication (security)
    24133,  // NIP-46 request (signing for another signer)
    13194,  // Wallet info (financial)
    23194,  // Wallet request (financial)
    23195   // Wallet response (financial)
)

/** Whether an event kind is sensitive and should show an extra warning cue. */
fun isKindSensitive(kind: Int): Boolean = kind in SENSITIVE_KINDS
