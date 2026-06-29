package tech.geektoshi.signet.util

/**
 * Trust-level labels and descriptions, single-sourced so the connect-approval screen, the
 * connect-app sheet, and the app-detail editor all agree. These mirror `getTrustLevelBehavior`
 * in `@signet/types` (the web dashboard and browser extension), keeping the product consistent:
 * "Always Ask / Auto-approve Safe / Auto-approve All" rather than the older
 * "Paranoid / Reasonable / Full".
 */
object TrustLevels {
    val ORDER = listOf("paranoid", "reasonable", "full")

    fun label(level: String): String = when (level) {
        "paranoid" -> "Always Ask"
        "reasonable" -> "Auto-approve Safe"
        "full" -> "Auto-approve All"
        else -> level
    }

    fun description(level: String): String = when (level) {
        "paranoid" -> "Every action requires your approval"
        "reasonable" -> "Auto-approve common actions, ask for sensitive ones"
        "full" -> "Automatically approve all requests"
        else -> ""
    }
}
