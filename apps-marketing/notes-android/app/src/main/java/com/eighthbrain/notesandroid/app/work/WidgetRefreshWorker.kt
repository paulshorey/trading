package com.eighthbrain.notesandroid.app.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.eighthbrain.notesandroid.app.NotesApplication

class WidgetRefreshWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val repository = (applicationContext as NotesApplication).repository
        val snapshot = repository.readSnapshot()

        if (snapshot.user == null) {
            return Result.success()
        }

        return try {
            repository.restoreSession(refreshSearch = false)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
