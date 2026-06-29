package tech.geektoshi.signet.util

/**
 * NIP-46 connect permission parsing/formatting, mirroring `parseConnectPermissions` and
 * `formatPermission` in `@signet/types`. The daemon surfaces a connect request's
 * `optional_requested_perms` as `requestedPerms: List<String>` (entries like "sign_event:1",
 * "nip44_encrypt"); these render the human-readable badges on the connect-approval screen.
 */
data class ParsedPermission(val method: String, val kind: Int?)

fun parseConnectPermissions(perms: List<String>?): List<ParsedPermission> {
    if (perms == null) return emptyList()
    return perms
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .map { entry ->
            val parts = entry.split(":")
            val kind = parts.getOrNull(1)?.toIntOrNull()
            ParsedPermission(parts[0], kind)
        }
}

fun formatPermission(perm: ParsedPermission): String {
    if (perm.method == "sign_event" && perm.kind != null) {
        return "Sign ${getKindLabel(perm.kind).lowercase()}"
    }
    return when (perm.method) {
        "sign_event" -> "Sign events (any kind)"
        "nip04_encrypt" -> "Send legacy DMs"
        "nip04_decrypt" -> "Read legacy DMs"
        "nip44_encrypt" -> "Send encrypted messages"
        "nip44_decrypt" -> "Read encrypted messages"
        "get_public_key" -> "Share your identity"
        else -> perm.method
    }
}
