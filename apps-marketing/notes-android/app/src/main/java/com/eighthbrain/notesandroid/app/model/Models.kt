package com.eighthbrain.notesandroid.app.model

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

enum class WidgetMode {
    NOTES,
    SEARCH,
}

data class UserSummary(
    val id: Int,
    val username: String,
    val email: String?,
    val phone: String?,
)

data class NoteRecord(
    val id: Int,
    val userId: Int,
    val title: String?,
    val summary: String?,
    val description: String?,
    val timeDue: String,
    val timeRemind: String,
    val timeCreated: String,
    val timeModified: String,
)

data class SemanticSearchResult(
    val note: NoteRecord,
    val similarity: Double,
    val titleSimilarity: Double?,
    val contentSimilarity: Double?,
)

data class NoteDraft(
    val title: String = "",
    val summary: String = "",
    val description: String = "",
    val dueInput: String = defaultDueInput(),
    val remindInput: String = defaultRemindInput(),
)

data class AppSnapshot(
    val apiBaseUrl: String,
    val user: UserSummary? = null,
    val notes: List<NoteRecord> = emptyList(),
    val lastSearchQuery: String = "",
    val searchResults: List<SemanticSearchResult> = emptyList(),
    val widgetMode: WidgetMode = WidgetMode.NOTES,
    val lastSyncEpochMillis: Long? = null,
    val lastError: String? = null,
)

private val localInputFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")
private val dateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(
    FormatStyle.MEDIUM,
    FormatStyle.SHORT,
)

private fun nowLocalDateTime(): LocalDateTime = LocalDateTime.now(ZoneId.systemDefault())

fun defaultDueInput(): String = nowLocalDateTime().plusDays(1).format(localInputFormatter)

fun defaultRemindInput(): String = nowLocalDateTime().plusMinutes(30).format(localInputFormatter)

fun NoteRecord.toDraft(): NoteDraft =
    NoteDraft(
        title = title.orEmpty(),
        summary = summary.orEmpty(),
        description = description.orEmpty(),
        dueInput = isoToLocalInput(timeDue),
        remindInput = isoToLocalInput(timeRemind),
    )

fun isoToLocalInput(value: String): String =
    Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDateTime().format(localInputFormatter)

fun parseLocalInputToIso(
    value: String,
    fieldName: String,
): String {
    val trimmed = value.trim()
    require(trimmed.isNotEmpty()) { "$fieldName is required." }

    return try {
        LocalDateTime.parse(trimmed, localInputFormatter)
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toString()
    } catch (_: Exception) {
        throw IllegalArgumentException("$fieldName must use the format yyyy-MM-dd'T'HH:mm.")
    }
}

fun formatTimestamp(value: String): String =
    Instant.parse(value).atZone(ZoneId.systemDefault()).format(dateTimeFormatter)

fun formatPercent(value: Double?): String {
    if (value == null) {
        return "n/a"
    }

    val bounded = (value * 100.0).toInt().coerceIn(0, 100)
    return "$bounded%"
}
