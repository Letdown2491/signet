package tech.geektoshi.signet.util

import io.ktor.client.plugins.ClientRequestException
import io.ktor.client.plugins.ServerResponseException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.io.IOException
import javax.net.ssl.SSLException

/**
 * Result of formatting an error with user-friendly message and metadata.
 */
data class FormattedError(
    /** User-friendly error message */
    val message: String,
    /** Suggested action the user can take */
    val action: String? = null,
    /** Whether the operation can be retried */
    val canRetry: Boolean = true,
    /** HTTP status code if applicable */
    val statusCode: Int? = null
)

/**
 * Centralized error formatting for consistent, user-friendly error messages.
 */
object ErrorFormatter {

    /**
     * Format an exception into a user-friendly error message.
     */
    fun format(exception: Throwable, context: String? = null): FormattedError {
        return when (exception) {
            // Network connectivity issues
            is UnknownHostException -> FormattedError(
                message = "Server unreachable",
                action = "Check your daemon URL in Settings",
                canRetry = true
            )

            is ConnectException -> FormattedError(
                message = "Connection refused",
                action = "Make sure the Signet daemon is running",
                canRetry = true
            )

            is SocketTimeoutException -> FormattedError(
                message = "Request timed out",
                action = "Server is slow or unreachable. Try again.",
                canRetry = true
            )

            is SSLException -> FormattedError(
                message = "Secure connection failed",
                action = "Check your network or daemon URL",
                canRetry = true
            )

            // HTTP client errors (4xx)
            is ClientRequestException -> formatClientError(exception)

            // HTTP server errors (5xx)
            is ServerResponseException -> FormattedError(
                message = "Server error (${exception.response.status.value})",
                action = "The daemon encountered an error. Try again.",
                canRetry = true,
                statusCode = exception.response.status.value
            )

            // Generic IO errors
            is IOException -> FormattedError(
                message = "Network error",
                action = "Check your connection and try again",
                canRetry = true
            )

            // Fallback for unknown errors
            else -> FormattedError(
                message = exception.message ?: "Unknown error",
                action = context?.let { "Failed to $it" },
                canRetry = true
            )
        }
    }

    /**
     * Format a simple error message string.
     * Use this for quick error display without full FormattedError details.
     */
    fun formatMessage(exception: Throwable, fallback: String = "An error occurred"): String {
        return format(exception).message.ifBlank { fallback }
    }

    /**
     * Format HTTP 4xx client errors with specific handling.
     */
    private fun formatClientError(exception: ClientRequestException): FormattedError {
        val statusCode = exception.response.status.value

        return when (statusCode) {
            400 -> FormattedError(
                message = "Invalid request",
                action = "Check your input and try again",
                canRetry = false,
                statusCode = statusCode
            )

            401 -> FormattedError(
                message = "Authentication required",
                action = "Your session may have expired",
                canRetry = false,
                statusCode = statusCode
            )

            403 -> FormattedError(
                message = "Access denied",
                action = "You don't have permission for this action",
                canRetry = false,
                statusCode = statusCode
            )

            404 -> FormattedError(
                message = "Not found",
                action = "The requested resource doesn't exist",
                canRetry = false,
                statusCode = statusCode
            )

            409 -> FormattedError(
                message = "Conflict",
                action = "This action conflicts with existing data",
                canRetry = false,
                statusCode = statusCode
            )

            422 -> FormattedError(
                message = "Invalid data",
                action = "Please check your input",
                canRetry = false,
                statusCode = statusCode
            )

            429 -> FormattedError(
                message = "Too many requests",
                action = "Please wait a moment before trying again",
                canRetry = true,
                statusCode = statusCode
            )

            else -> FormattedError(
                message = "Request failed ($statusCode)",
                action = exception.message,
                canRetry = statusCode >= 500,
                statusCode = statusCode
            )
        }
    }

    /**
     * Check if an exception represents a transient error that should be retried.
     */
    fun isRetryable(exception: Throwable): Boolean {
        return when (exception) {
            is SocketTimeoutException -> true
            is ConnectException -> true
            is UnknownHostException -> true
            is IOException -> true
            is ServerResponseException -> true // 5xx errors
            is ClientRequestException -> {
                val status = exception.response.status.value
                status == 429 || status >= 500
            }
            else -> false
        }
    }
}
