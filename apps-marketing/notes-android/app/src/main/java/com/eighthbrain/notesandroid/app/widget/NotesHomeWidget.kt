package com.eighthbrain.notesandroid.app.widget

import android.content.Context
import android.content.Intent
import androidx.compose.ui.graphics.Color
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.FillMaxSize
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.unit.DpSize
import androidx.glance.unit.dp
import com.eighthbrain.notesandroid.app.NotesApplication
import com.eighthbrain.notesandroid.app.model.AppSnapshot
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.SemanticSearchResult
import com.eighthbrain.notesandroid.app.model.WidgetMode
import com.eighthbrain.notesandroid.app.model.formatPercent
import com.eighthbrain.notesandroid.app.model.formatTimestamp
import com.eighthbrain.notesandroid.app.ui.WidgetLoginActivity
import com.eighthbrain.notesandroid.app.ui.WidgetNoteEditorActivity
import com.eighthbrain.notesandroid.app.ui.WidgetSearchActivity

class NotesHomeWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NotesHomeWidget()
}

class NotesHomeWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode =
        SizeMode.Responsive(
            setOf(
                DpSize(180.dp, 250.dp),
                DpSize(320.dp, 320.dp),
            ),
        )

    override suspend fun provideGlance(
        context: Context,
        id: androidx.glance.GlanceId,
    ) {
        val repository = (context.applicationContext as NotesApplication).repository
        val snapshot = repository.readSnapshot()

        provideContent {
            WidgetContent(snapshot = snapshot)
        }
    }
}

private object WidgetActionKeys {
    val mode = ActionParameters.Key<String>("mode")
    val noteId = ActionParameters.Key<String>("note_id")
}

private val widgetBackground = ColorProvider(Color(0xFF10131A))
private val widgetSurface = ColorProvider(Color(0xFF1B2230))
private val widgetMuted = ColorProvider(Color(0xFF98A2B3))
private val widgetPrimary = ColorProvider(Color(0xFF71B7FF))
private val widgetDanger = ColorProvider(Color(0xFFFF8A80))
private val widgetText = ColorProvider(Color(0xFFF5F7FB))

@androidx.compose.runtime.Composable
private fun WidgetContent(snapshot: AppSnapshot) {
    val context = LocalContext.current

    Box(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .background(widgetBackground)
                .padding(12.dp),
        contentAlignment = Alignment.TopStart,
    ) {
        Column(modifier = GlanceModifier.fillMaxSize()) {
            Text(
                text = "Notes widget",
                style = TextStyle(color = widgetText, fontWeight = FontWeight.Bold),
            )
            Spacer(modifier = GlanceModifier.height(6.dp))
            Text(
                text =
                    snapshot.user?.let { "#${it.id} · ${it.username}" }
                        ?: "Passwordless sign-in from the home screen",
                style = TextStyle(color = widgetMuted),
            )
            snapshot.lastError?.takeIf { it.isNotBlank() }?.let { message ->
                Spacer(modifier = GlanceModifier.height(8.dp))
                SurfaceCard {
                    Text(
                        text = message,
                        style = TextStyle(color = widgetDanger),
                    )
                }
            }
            Spacer(modifier = GlanceModifier.height(10.dp))

            if (snapshot.user == null) {
                SurfaceCard {
                    Text(
                        text = "Widgets cannot host editable text fields, so sign-in opens a tiny overlay form.",
                        style = TextStyle(color = widgetMuted),
                    )
                    Spacer(modifier = GlanceModifier.height(10.dp))
                    WidgetChip(
                        text = "Sign in",
                        action = actionStartActivity<WidgetLoginActivity>(),
                    )
                }
            } else {
                WidgetToolbar(snapshot = snapshot, context = context)
                Spacer(modifier = GlanceModifier.height(10.dp))

                when (snapshot.widgetMode) {
                    WidgetMode.NOTES -> NotesPane(snapshot = snapshot, context = context)
                    WidgetMode.SEARCH -> SearchPane(snapshot = snapshot, context = context)
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun WidgetToolbar(
    snapshot: AppSnapshot,
    context: Context,
) {
    val addIntent = Intent(context, WidgetNoteEditorActivity::class.java)

    Column {
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            WidgetChip(
                text = "Notes",
                action =
                    actionRunCallback<SwitchModeAction>(
                        actionParametersOf(WidgetActionKeys.mode to WidgetMode.NOTES.name),
                    ),
                highlighted = snapshot.widgetMode == WidgetMode.NOTES,
            )
            Spacer(modifier = GlanceModifier.width(8.dp))
            WidgetChip(
                text = "Search",
                action = actionStartActivity<WidgetSearchActivity>(),
                highlighted = snapshot.widgetMode == WidgetMode.SEARCH,
            )
        }
        Spacer(modifier = GlanceModifier.height(8.dp))
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            WidgetChip(text = "Add", action = actionStartActivity(addIntent))
            Spacer(modifier = GlanceModifier.width(8.dp))
            WidgetChip(text = "Refresh", action = actionRunCallback<RefreshNotesAction>())
            Spacer(modifier = GlanceModifier.width(8.dp))
            WidgetChip(text = "Sign out", action = actionRunCallback<LogoutAction>())
        }
    }
}

@androidx.compose.runtime.Composable
private fun NotesPane(
    snapshot: AppSnapshot,
    context: Context,
) {
    SurfaceCard(modifier = GlanceModifier.defaultWeight()) {
        Text(
            text = "${snapshot.notes.size} note(s)",
            style = TextStyle(color = widgetMuted),
        )
        Spacer(modifier = GlanceModifier.height(8.dp))

        if (snapshot.notes.isEmpty()) {
            Text(
                text = "No notes yet. Tap Add to create the first one.",
                style = TextStyle(color = widgetText),
            )
            return@SurfaceCard
        }

        LazyColumn(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
            items(snapshot.notes.take(5), itemId = { it.id.toLong() }) { note ->
                NoteRow(note = note, context = context)
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun SearchPane(
    snapshot: AppSnapshot,
    context: Context,
) {
    SurfaceCard(modifier = GlanceModifier.defaultWeight()) {
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    text = if (snapshot.lastSearchQuery.isBlank()) "Semantic search" else snapshot.lastSearchQuery,
                    style = TextStyle(color = widgetText, fontWeight = FontWeight.Bold),
                    maxLines = 2,
                )
                Spacer(modifier = GlanceModifier.height(4.dp))
                Text(
                    text =
                        if (snapshot.lastSearchQuery.isBlank()) {
                            "Run a search from the widget to pin semantic results here."
                        } else {
                            "${snapshot.searchResults.size} match(es)"
                        },
                    style = TextStyle(color = widgetMuted),
                )
            }
            if (snapshot.lastSearchQuery.isNotBlank()) {
                Spacer(modifier = GlanceModifier.width(8.dp))
                WidgetChip(text = "Clear", action = actionRunCallback<ClearSearchAction>())
            }
        }

        Spacer(modifier = GlanceModifier.height(8.dp))

        if (snapshot.searchResults.isEmpty()) {
            Text(
                text = "Search opens a tiny overlay because widgets cannot accept free-form text input directly.",
                style = TextStyle(color = widgetText),
            )
            return@SurfaceCard
        }

        LazyColumn(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
            items(snapshot.searchResults.take(5), itemId = { it.note.id.toLong() }) { result ->
                SearchResultRow(result = result, context = context)
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun NoteRow(
    note: NoteRecord,
    context: Context,
) {
    val editIntent =
        Intent(context, WidgetNoteEditorActivity::class.java).putExtra(
            WidgetNoteEditorActivity.extraNoteId,
            note.id,
        )

    Column(
        modifier =
            GlanceModifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
    ) {
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            Column(modifier = GlanceModifier.defaultWeight().clickable(actionStartActivity(editIntent))) {
                Text(
                    text = note.title?.takeIf { it.isNotBlank() } ?: "Untitled note",
                    style = TextStyle(color = widgetText, fontWeight = FontWeight.Bold),
                    maxLines = 1,
                )
                note.summary?.takeIf { it.isNotBlank() }?.let {
                    Spacer(modifier = GlanceModifier.height(2.dp))
                    Text(
                        text = it,
                        style = TextStyle(color = widgetMuted),
                        maxLines = 2,
                    )
                }
            }
            Spacer(modifier = GlanceModifier.width(8.dp))
            WidgetChip(
                text = "Delete",
                action =
                    actionRunCallback<DeleteNoteAction>(
                        actionParametersOf(WidgetActionKeys.noteId to note.id.toString()),
                    ),
            )
        }
        Spacer(modifier = GlanceModifier.height(2.dp))
        Text(
            text = "Due ${formatTimestamp(note.timeDue)}",
            style = TextStyle(color = widgetMuted),
            maxLines = 1,
        )
    }
}

@androidx.compose.runtime.Composable
private fun SearchResultRow(
    result: SemanticSearchResult,
    context: Context,
) {
    val editIntent =
        Intent(context, WidgetNoteEditorActivity::class.java).putExtra(
            WidgetNoteEditorActivity.extraNoteId,
            result.note.id,
        )

    Column(
        modifier =
            GlanceModifier
                .fillMaxWidth()
                .padding(vertical = 4.dp)
                .clickable(actionStartActivity(editIntent)),
    ) {
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    text = result.note.title?.takeIf { it.isNotBlank() } ?: "Untitled note",
                    style = TextStyle(color = widgetText, fontWeight = FontWeight.Bold),
                    maxLines = 1,
                )
                Text(
                    text = result.note.summary?.takeIf { it.isNotBlank() } ?: result.note.description.orEmpty(),
                    style = TextStyle(color = widgetMuted),
                    maxLines = 2,
                )
            }
            Spacer(modifier = GlanceModifier.width(8.dp))
            Text(
                text = formatPercent(result.similarity),
                style = TextStyle(color = widgetPrimary, fontWeight = FontWeight.Bold),
            )
        }
    }
}

@androidx.compose.runtime.Composable
private fun SurfaceCard(
    modifier: GlanceModifier = GlanceModifier,
    content: @androidx.compose.runtime.Composable () -> Unit,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .background(widgetSurface)
                .padding(10.dp),
    ) {
        content()
    }
}

@androidx.compose.runtime.Composable
private fun WidgetChip(
    text: String,
    action: androidx.glance.action.Action,
    highlighted: Boolean = false,
) {
    Box(
        modifier =
            GlanceModifier
                .background(if (highlighted) widgetPrimary else widgetSurface)
                .clickable(action)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style =
                TextStyle(
                    color = if (highlighted) ColorProvider(Color(0xFF041826)) else widgetText,
                    fontWeight = FontWeight.Medium,
                ),
        )
    }
}

class RefreshNotesAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: androidx.glance.GlanceId,
        parameters: ActionParameters,
    ) {
        val repository = (context.applicationContext as NotesApplication).repository
        val snapshot = repository.readSnapshot()
        if (snapshot.user != null) {
            repository.restoreSession(
                refreshSearch = snapshot.widgetMode == WidgetMode.SEARCH && snapshot.lastSearchQuery.isNotBlank(),
            )
        }
    }
}

class SwitchModeAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: androidx.glance.GlanceId,
        parameters: ActionParameters,
    ) {
        val mode = parameters[WidgetActionKeys.mode]?.let { runCatching { WidgetMode.valueOf(it) }.getOrNull() }
        if (mode != null) {
            val repository = (context.applicationContext as NotesApplication).repository
            repository.setWidgetMode(mode)
        }
    }
}

class DeleteNoteAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: androidx.glance.GlanceId,
        parameters: ActionParameters,
    ) {
        val noteId = parameters[WidgetActionKeys.noteId]?.toIntOrNull() ?: return
        val repository = (context.applicationContext as NotesApplication).repository
        repository.deleteNote(noteId)
    }
}

class ClearSearchAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: androidx.glance.GlanceId,
        parameters: ActionParameters,
    ) {
        val repository = (context.applicationContext as NotesApplication).repository
        repository.clearSearch()
    }
}

class LogoutAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: androidx.glance.GlanceId,
        parameters: ActionParameters,
    ) {
        val repository = (context.applicationContext as NotesApplication).repository
        repository.logout()
    }
}
