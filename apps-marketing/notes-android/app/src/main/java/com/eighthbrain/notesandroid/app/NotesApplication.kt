package com.eighthbrain.notesandroid.app

import android.app.Application
import com.eighthbrain.notesandroid.app.data.NotesRepository

class NotesApplication : Application() {
    val repository: NotesRepository by lazy { NotesRepository(this) }
}
