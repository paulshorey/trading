package com.eighthbrain.notesandroid.app.data

import android.content.Context
import androidx.glance.appwidget.updateAll
import com.eighthbrain.notesandroid.app.model.AppSnapshot
import com.eighthbrain.notesandroid.app.model.NoteDraft
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.UserSummary
import com.eighthbrain.notesandroid.app.model.WidgetMode
import com.eighthbrain.notesandroid.app.widget.NotesHomeWidget
import com.eighthbrain.notesandroid.app.work.WidgetRefreshScheduler
import kotlinx.coroutines.flow.Flow

class NotesRepository(
    context: Context,
    private val sessionStore: SessionStore = SessionStore(context.applicationContext),
    private val apiClient: NotesApiClient = NotesApiClient(),
) {
    private val appContext = context.applicationContext

    val snapshots: Flow<AppSnapshot> = sessionStore.snapshots

    suspend fun readSnapshot(): AppSnapshot = sessionStore.readSnapshot()

    suspend fun updateApiBaseUrl(url: String): AppSnapshot {
        val snapshot = readSnapshot()
        val next =
            snapshot.copy(
                apiBaseUrl = apiClient.normalizeBaseUrl(url),
                lastError = null,
            )
        persist(next)
        return next
    }

    suspend fun login(
        identifier: String,
        apiBaseUrl: String,
    ): AppSnapshot =
        runWithErrorPersistence(readSnapshot().copy(apiBaseUrl = apiBaseUrl)) { snapshot ->
            val normalizedBaseUrl = apiClient.normalizeBaseUrl(apiBaseUrl)
            val user = apiClient.login(normalizedBaseUrl, identifier)
            val notes = apiClient.listNotes(normalizedBaseUrl, user.id)
            val next =
                snapshot.copy(
                    apiBaseUrl = normalizedBaseUrl,
                    user = user,
                    notes = notes,
                    lastSearchQuery = "",
                    searchResults = emptyList(),
                    widgetMode = WidgetMode.NOTES,
                    lastSyncEpochMillis = System.currentTimeMillis(),
                    lastError = null,
                )
            persist(next)
            WidgetRefreshScheduler.schedule(appContext)
            next
        }

    suspend fun restoreSession(refreshSearch: Boolean = false): AppSnapshot {
        val snapshot = readSnapshot()
        val user = snapshot.user ?: return snapshot
        return syncSnapshot(snapshot, user, refreshSearch)
    }

    suspend fun refreshNotes(): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        return syncSnapshot(snapshot, user, refreshSearch = false)
    }

    suspend fun saveNote(
        noteId: Int?,
        noteDraft: NoteDraft,
    ): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        return runWithErrorPersistence(snapshot) {
            apiClient.saveNote(snapshot.apiBaseUrl, user.id, noteId, noteDraft)
            syncSnapshot(snapshot, user, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun deleteNote(noteId: Int): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        return runWithErrorPersistence(snapshot) {
            apiClient.deleteNote(snapshot.apiBaseUrl, user.id, noteId)
            syncSnapshot(snapshot, user, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun search(query: String): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        return runWithErrorPersistence(snapshot) {
            val trimmedQuery = query.trim()
            require(trimmedQuery.isNotEmpty()) { "Search query is required." }

            val results = apiClient.semanticSearch(snapshot.apiBaseUrl, user.id, trimmedQuery)
            val next =
                snapshot.copy(
                    searchResults = results,
                    lastSearchQuery = trimmedQuery,
                    widgetMode = WidgetMode.SEARCH,
                    lastSyncEpochMillis = System.currentTimeMillis(),
                    lastError = null,
                )
            persist(next)
            next
        }
    }

    suspend fun setWidgetMode(mode: WidgetMode): AppSnapshot {
        val snapshot = readSnapshot()
        val next = snapshot.copy(widgetMode = mode, lastError = null)
        persist(next)
        return next
    }

    suspend fun clearSearch(): AppSnapshot {
        val snapshot = readSnapshot()
        val next =
            snapshot.copy(
                lastSearchQuery = "",
                searchResults = emptyList(),
                widgetMode = WidgetMode.NOTES,
                lastError = null,
            )
        persist(next)
        return next
    }

    suspend fun logout(): AppSnapshot {
        val snapshot = readSnapshot()
        val next = AppSnapshot(apiBaseUrl = snapshot.apiBaseUrl)
        persist(next)
        WidgetRefreshScheduler.cancel(appContext)
        return next
    }

    suspend fun noteById(noteId: Int): NoteRecord? = readSnapshot().notes.firstOrNull { it.id == noteId }

    private suspend fun syncSnapshot(
        snapshot: AppSnapshot,
        user: UserSummary,
        refreshSearch: Boolean,
    ): AppSnapshot =
        runWithErrorPersistence(snapshot) {
            val verifiedUser = apiClient.getUser(snapshot.apiBaseUrl, user.id)
            val notes = apiClient.listNotes(snapshot.apiBaseUrl, user.id)
            val results =
                if (refreshSearch && snapshot.lastSearchQuery.isNotBlank()) {
                    apiClient.semanticSearch(snapshot.apiBaseUrl, user.id, snapshot.lastSearchQuery)
                } else {
                    snapshot.searchResults
                }

            val next =
                snapshot.copy(
                    user = verifiedUser,
                    notes = notes,
                    searchResults = results,
                    lastSyncEpochMillis = System.currentTimeMillis(),
                    lastError = null,
                )
            persist(next)
            next
        }

    private suspend fun requireUser(snapshot: AppSnapshot): UserSummary =
        snapshot.user ?: throw IllegalStateException("Sign in before editing notes.")

    private suspend fun runWithErrorPersistence(
        snapshot: AppSnapshot,
        block: suspend (AppSnapshot) -> AppSnapshot,
    ): AppSnapshot =
        try {
            block(snapshot)
        } catch (error: Throwable) {
            persist(
                snapshot.copy(
                    lastError = error.message ?: "Unexpected request error.",
                ),
            )
            throw error
        }

    private suspend fun persist(snapshot: AppSnapshot) {
        sessionStore.saveSnapshot(snapshot)
        NotesHomeWidget().updateAll(appContext)
    }
}
