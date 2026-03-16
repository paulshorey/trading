package com.eighthbrain.notesandroid.app.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.eighthbrain.notesandroid.app.BuildConfig
import com.eighthbrain.notesandroid.app.model.AppSnapshot
import com.eighthbrain.notesandroid.app.model.WidgetMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONObject

private val Context.notesAndroidDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "notes_android_store",
)

private object PreferenceKeys {
    val apiBaseUrl = stringPreferencesKey("api_base_url")
    val userJson = stringPreferencesKey("user_json")
    val notesJson = stringPreferencesKey("notes_json")
    val lastSearchQuery = stringPreferencesKey("last_search_query")
    val searchResultsJson = stringPreferencesKey("search_results_json")
    val widgetMode = stringPreferencesKey("widget_mode")
    val lastSyncEpochMillis = longPreferencesKey("last_sync_epoch_millis")
    val lastError = stringPreferencesKey("last_error")
}

class SessionStore(
    private val context: Context,
) {
    val snapshots: Flow<AppSnapshot> =
        context.notesAndroidDataStore.data.map { preferences ->
            preferences.toSnapshot()
        }

    suspend fun readSnapshot(): AppSnapshot = snapshots.first()

    suspend fun saveSnapshot(snapshot: AppSnapshot) {
        context.notesAndroidDataStore.edit { preferences ->
            preferences[PreferenceKeys.apiBaseUrl] = snapshot.apiBaseUrl

            if (snapshot.user == null) {
                preferences.remove(PreferenceKeys.userJson)
            } else {
                preferences[PreferenceKeys.userJson] = userToJson(snapshot.user).toString()
            }

            preferences[PreferenceKeys.notesJson] = notesToJson(snapshot.notes)
            preferences[PreferenceKeys.lastSearchQuery] = snapshot.lastSearchQuery
            preferences[PreferenceKeys.searchResultsJson] = searchResultsToJson(snapshot.searchResults)
            preferences[PreferenceKeys.widgetMode] = snapshot.widgetMode.name

            if (snapshot.lastSyncEpochMillis == null) {
                preferences.remove(PreferenceKeys.lastSyncEpochMillis)
            } else {
                preferences[PreferenceKeys.lastSyncEpochMillis] = snapshot.lastSyncEpochMillis
            }

            if (snapshot.lastError.isNullOrBlank()) {
                preferences.remove(PreferenceKeys.lastError)
            } else {
                preferences[PreferenceKeys.lastError] = snapshot.lastError
            }
        }
    }

    private fun Preferences.toSnapshot(): AppSnapshot {
        val apiBaseUrl = this[PreferenceKeys.apiBaseUrl] ?: BuildConfig.DEFAULT_API_BASE_URL
        val userJson = this[PreferenceKeys.userJson]
        val widgetMode =
            this[PreferenceKeys.widgetMode]
                ?.let {
                    runCatching { WidgetMode.valueOf(it) }.getOrDefault(WidgetMode.NOTES)
                }
                ?: WidgetMode.NOTES

        return AppSnapshot(
            apiBaseUrl = apiBaseUrl,
            user = userJson?.let { userFromJson(JSONObject(it)) },
            notes = notesFromJson(this[PreferenceKeys.notesJson]),
            lastSearchQuery = this[PreferenceKeys.lastSearchQuery].orEmpty(),
            searchResults = searchResultsFromJson(this[PreferenceKeys.searchResultsJson]),
            widgetMode = widgetMode,
            lastSyncEpochMillis = this[PreferenceKeys.lastSyncEpochMillis],
            lastError = this[PreferenceKeys.lastError],
        )
    }
}
