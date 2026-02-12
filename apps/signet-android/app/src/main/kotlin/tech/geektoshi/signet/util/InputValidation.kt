package tech.geektoshi.signet.util

import java.net.URL

/**
 * Result of validating an input field.
 */
sealed class ValidationResult {
    /** Input is valid */
    data object Valid : ValidationResult()

    /** Input is invalid with an error message */
    data class Invalid(val message: String) : ValidationResult()

    val isValid: Boolean get() = this is Valid
    val errorMessage: String? get() = (this as? Invalid)?.message
}

/**
 * Centralized input validation utilities.
 */
object InputValidation {

    private val keyNameRegex = Regex(ValidationConstants.KEY_NAME_PATTERN)

    /**
     * Validate a key name.
     * Rules: alphanumeric, underscore, hyphen; max 64 characters
     */
    fun validateKeyName(name: String): ValidationResult {
        return when {
            name.isBlank() -> ValidationResult.Invalid("Key name is required")
            name.length > ValidationConstants.KEY_NAME_MAX_LENGTH ->
                ValidationResult.Invalid("Key name must be ${ValidationConstants.KEY_NAME_MAX_LENGTH} characters or less")
            !keyNameRegex.matches(name) ->
                ValidationResult.Invalid("Key name can only contain letters, numbers, hyphens, and underscores")
            else -> ValidationResult.Valid
        }
    }

    /**
     * Validate a daemon URL.
     * Must be a valid HTTP or HTTPS URL.
     */
    fun validateDaemonUrl(url: String): ValidationResult {
        if (url.isBlank()) {
            return ValidationResult.Invalid("Daemon URL is required")
        }

        return try {
            val parsed = URL(url)
            when {
                parsed.protocol !in listOf("http", "https") ->
                    ValidationResult.Invalid("URL must use http:// or https://")
                parsed.host.isNullOrBlank() ->
                    ValidationResult.Invalid("URL must include a host")
                else -> ValidationResult.Valid
            }
        } catch (e: Exception) {
            ValidationResult.Invalid("Invalid URL format")
        }
    }

    /**
     * Validate an app name.
     */
    fun validateAppName(name: String): ValidationResult {
        return when {
            name.length > ValidationConstants.APP_NAME_MAX_LENGTH ->
                ValidationResult.Invalid("App name must be ${ValidationConstants.APP_NAME_MAX_LENGTH} characters or less")
            else -> ValidationResult.Valid
        }
    }

    /**
     * Validate a passphrase.
     * Note: Empty is allowed (keys can be unencrypted).
     * When provided, must be at least MIN_LENGTH characters for security.
     */
    fun validatePassphrase(passphrase: String): ValidationResult {
        return when {
            passphrase.isNotEmpty() && passphrase.length < ValidationConstants.PASSPHRASE_MIN_LENGTH ->
                ValidationResult.Invalid("Passphrase must be at least ${ValidationConstants.PASSPHRASE_MIN_LENGTH} characters")
            passphrase.length > ValidationConstants.PASSPHRASE_MAX_LENGTH ->
                ValidationResult.Invalid("Passphrase must be ${ValidationConstants.PASSPHRASE_MAX_LENGTH} characters or less")
            else -> ValidationResult.Valid
        }
    }

    /**
     * Validate that two passphrases match.
     */
    fun validatePassphraseMatch(passphrase: String, confirmation: String): ValidationResult {
        return when {
            passphrase != confirmation -> ValidationResult.Invalid("Passphrases do not match")
            else -> ValidationResult.Valid
        }
    }

    /**
     * Validate an nsec (Nostr secret key in bech32 format).
     */
    fun validateNsec(nsec: String): ValidationResult {
        return when {
            nsec.isBlank() -> ValidationResult.Invalid("nsec is required")
            !nsec.startsWith("nsec1") -> ValidationResult.Invalid("Must start with 'nsec1'")
            nsec.length < 60 -> ValidationResult.Invalid("nsec appears to be too short")
            nsec.length > 70 -> ValidationResult.Invalid("nsec appears to be too long")
            else -> ValidationResult.Valid
        }
    }
}
