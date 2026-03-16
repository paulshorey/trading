package com.eighthbrain.notesandroid.app.data

import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.SemanticSearchResult
import com.eighthbrain.notesandroid.app.model.UserSummary
import org.json.JSONArray
import org.json.JSONObject

private fun JSONObject.stringOrNull(key: String): String? =
    if (isNull(key)) {
        null
    } else {
        optString(key, "").ifBlank { null }
    }

private fun JSONObject.doubleOrNull(key: String): Double? =
    if (isNull(key)) {
        null
    } else {
        optDouble(key)
    }

fun userToJson(user: UserSummary): JSONObject =
    JSONObject()
        .put("id", user.id)
        .put("username", user.username)
        .put("email", user.email)
        .put("phone", user.phone)

fun userFromJson(json: JSONObject): UserSummary =
    UserSummary(
        id = json.getInt("id"),
        username = json.getString("username"),
        email = json.stringOrNull("email"),
        phone = json.stringOrNull("phone"),
    )

fun noteToJson(note: NoteRecord): JSONObject =
    JSONObject()
        .put("id", note.id)
        .put("userId", note.userId)
        .put("title", note.title)
        .put("summary", note.summary)
        .put("description", note.description)
        .put("timeDue", note.timeDue)
        .put("timeRemind", note.timeRemind)
        .put("timeCreated", note.timeCreated)
        .put("timeModified", note.timeModified)

fun noteFromJson(json: JSONObject): NoteRecord =
    NoteRecord(
        id = json.getInt("id"),
        userId = json.getInt("userId"),
        title = json.stringOrNull("title"),
        summary = json.stringOrNull("summary"),
        description = json.stringOrNull("description"),
        timeDue = json.getString("timeDue"),
        timeRemind = json.getString("timeRemind"),
        timeCreated = json.getString("timeCreated"),
        timeModified = json.getString("timeModified"),
    )

fun searchResultToJson(result: SemanticSearchResult): JSONObject =
    JSONObject()
        .put("note", noteToJson(result.note))
        .put("similarity", result.similarity)
        .put("titleSimilarity", result.titleSimilarity)
        .put("contentSimilarity", result.contentSimilarity)

fun searchResultFromJson(json: JSONObject): SemanticSearchResult =
    SemanticSearchResult(
        note = noteFromJson(json.getJSONObject("note")),
        similarity = json.getDouble("similarity"),
        titleSimilarity = json.doubleOrNull("titleSimilarity"),
        contentSimilarity = json.doubleOrNull("contentSimilarity"),
    )

fun notesToJson(notes: List<NoteRecord>): String =
    JSONArray().apply { notes.forEach { put(noteToJson(it)) } }.toString()

fun notesFromJson(raw: String?): List<NoteRecord> {
    if (raw.isNullOrBlank()) {
        return emptyList()
    }

    val array = JSONArray(raw)
    return buildList {
        for (index in 0 until array.length()) {
            add(noteFromJson(array.getJSONObject(index)))
        }
    }
}

fun searchResultsToJson(results: List<SemanticSearchResult>): String =
    JSONArray().apply { results.forEach { put(searchResultToJson(it)) } }.toString()

fun searchResultsFromJson(raw: String?): List<SemanticSearchResult> {
    if (raw.isNullOrBlank()) {
        return emptyList()
    }

    val array = JSONArray(raw)
    return buildList {
        for (index in 0 until array.length()) {
            add(searchResultFromJson(array.getJSONObject(index)))
        }
    }
}
