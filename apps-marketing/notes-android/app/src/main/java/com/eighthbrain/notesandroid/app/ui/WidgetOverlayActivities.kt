package com.eighthbrain.notesandroid.app.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.eighthbrain.notesandroid.app.NotesApplication
import com.eighthbrain.notesandroid.app.data.NotesRepository
import com.eighthbrain.notesandroid.app.model.NoteDraft
import com.eighthbrain.notesandroid.app.model.toDraft
import kotlinx.coroutines.launch

class WidgetLoginActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            OverlayTheme {
                val repository = (application as NotesApplication).repository
                WidgetLoginScreen(
                    repository = repository,
                    finishOverlay = { finish() },
                )
            }
        }
    }
}

class WidgetSearchActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            OverlayTheme {
                val repository = (application as NotesApplication).repository
                WidgetSearchScreen(
                    repository = repository,
                    finishOverlay = { finish() },
                )
            }
        }
    }
}

class WidgetNoteEditorActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val noteId = intent.getIntExtra(extraNoteId, -1).takeIf { it > 0 }

        setContent {
            OverlayTheme {
                val repository = (application as NotesApplication).repository
                WidgetNoteEditorScreen(
                    repository = repository,
                    noteId = noteId,
                    finishOverlay = { finish() },
                )
            }
        }
    }

    companion object {
        const val extraNoteId = "note_id"
    }
}

@Composable
private fun WidgetLoginScreen(
    repository: NotesRepository,
    finishOverlay: () -> Unit,
) {
    var identifier by remember { mutableStateOf("") }
    var apiBaseUrl by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(repository) {
        val snapshot = repository.readSnapshot()
        apiBaseUrl = snapshot.apiBaseUrl
    }

    OverlayCard(
        title = "Widget sign-in",
        subtitle = "Widgets cannot host text input, so this short overlay collects the username and server URL.",
        busy = busy,
        error = error,
    ) {
        OutlinedTextField(
            value = identifier,
            onValueChange = {
                identifier = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Username, email, or phone") },
            singleLine = true,
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = apiBaseUrl,
            onValueChange = {
                apiBaseUrl = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Server URL") },
            singleLine = true,
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        repository.login(identifier, apiBaseUrl)
                        finishOverlay()
                    } catch (exception: Exception) {
                        error = exception.message ?: "Unable to sign in."
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Sign in")
        }
    }
}

@Composable
private fun WidgetSearchScreen(
    repository: NotesRepository,
    finishOverlay: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(repository) {
        val snapshot = repository.readSnapshot()
        query = snapshot.lastSearchQuery
    }

    OverlayCard(
        title = "Widget search",
        subtitle = "Enter a semantic query. Results will be written back to the home-screen widget.",
        busy = busy,
        error = error,
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = {
                query = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Semantic query") },
            minLines = 3,
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        repository.search(query)
                        finishOverlay()
                    } catch (exception: Exception) {
                        error = exception.message ?: "Unable to search."
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Search and update widget")
        }
    }
}

@Composable
private fun WidgetNoteEditorScreen(
    repository: NotesRepository,
    noteId: Int?,
    finishOverlay: () -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var summary by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var dueInput by remember { mutableStateOf(NoteDraft().dueInput) }
    var remindInput by remember { mutableStateOf(NoteDraft().remindInput) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(repository, noteId) {
        val note = noteId?.let { repository.noteById(it) }
        if (note != null) {
            val draft = note.toDraft()
            title = draft.title
            summary = draft.summary
            description = draft.description
            dueInput = draft.dueInput
            remindInput = draft.remindInput
        }
    }

    OverlayCard(
        title = if (noteId == null) "New note" else "Edit note",
        subtitle = "Use yyyy-MM-ddTHH:mm values for the due and reminder fields.",
        busy = busy,
        error = error,
    ) {
        OutlinedTextField(
            value = title,
            onValueChange = {
                title = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Title") },
            singleLine = true,
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = summary,
            onValueChange = {
                summary = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Summary") },
            minLines = 2,
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = description,
            onValueChange = {
                description = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Description") },
            minLines = 4,
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = dueInput,
            onValueChange = {
                dueInput = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Due time") },
            singleLine = true,
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = remindInput,
            onValueChange = {
                remindInput = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Reminder time") },
            singleLine = true,
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        repository.saveNote(
                            noteId = noteId,
                            noteDraft =
                                NoteDraft(
                                    title = title,
                                    summary = summary,
                                    description = description,
                                    dueInput = dueInput,
                                    remindInput = remindInput,
                                ),
                        )
                        finishOverlay()
                    } catch (exception: Exception) {
                        error = exception.message ?: "Unable to save note."
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (noteId == null) "Create note" else "Save note")
        }
        if (noteId != null) {
            Spacer(modifier = Modifier.height(8.dp))
            TextButton(
                onClick = {
                    scope.launch {
                        busy = true
                        error = null
                        try {
                            repository.deleteNote(noteId)
                            finishOverlay()
                        } catch (exception: Exception) {
                            error = exception.message ?: "Unable to delete note."
                        } finally {
                            busy = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Delete note")
            }
        }
    }
}

@Composable
private fun OverlayCard(
    title: String,
    subtitle: String,
    busy: Boolean,
    error: String?,
    content: @Composable Column.() -> Unit,
) {
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(text = title, style = MaterialTheme.typography.titleLarge)
                Text(text = subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (busy) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
                if (!error.isNullOrBlank()) {
                    Text(text = error, color = MaterialTheme.colorScheme.error)
                }
                content()
            }
        }
    }
}

@Composable
private fun OverlayTheme(content: @Composable () -> Unit) {
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize(), content = content)
    }
}
