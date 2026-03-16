package com.eighthbrain.notesandroid.app.ui

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.eighthbrain.notesandroid.app.BuildConfig
import com.eighthbrain.notesandroid.app.NotesApplication
import com.eighthbrain.notesandroid.app.data.NotesRepository
import com.eighthbrain.notesandroid.app.model.AppSnapshot
import com.eighthbrain.notesandroid.app.model.NoteDraft
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.SemanticSearchResult
import com.eighthbrain.notesandroid.app.model.WidgetMode
import com.eighthbrain.notesandroid.app.model.formatPercent
import com.eighthbrain.notesandroid.app.model.formatTimestamp
import com.eighthbrain.notesandroid.app.model.toDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class MainTab {
    NOTES,
    SEARCH,
}

data class NotesUiState(
    val snapshot: AppSnapshot = AppSnapshot(apiBaseUrl = BuildConfig.DEFAULT_API_BASE_URL),
    val identifier: String = "",
    val apiBaseUrl: String = BuildConfig.DEFAULT_API_BASE_URL,
    val noteDraft: NoteDraft = NoteDraft(),
    val editingNoteId: Int? = null,
    val searchQuery: String = "",
    val currentTab: MainTab = MainTab.NOTES,
    val isBusy: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class NotesViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val repository = (application as NotesApplication).repository
    private val _uiState = MutableStateFlow(NotesUiState())
    val uiState: StateFlow<NotesUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.snapshots.collect { snapshot ->
                _uiState.update { current ->
                    current.copy(
                        snapshot = snapshot,
                        apiBaseUrl = snapshot.apiBaseUrl,
                        searchQuery = if (current.searchQuery.isBlank()) snapshot.lastSearchQuery else current.searchQuery,
                    )
                }
            }
        }

        viewModelScope.launch {
            if (repository.readSnapshot().user != null) {
                runAction(errorPrefix = "Unable to refresh saved session.") {
                    repository.restoreSession(refreshSearch = false)
                    val snapshot = repository.readSnapshot()
                    _uiState.update {
                        it.copy(
                            message = "Session restored.",
                            currentTab = if (snapshot.widgetMode == WidgetMode.SEARCH) MainTab.SEARCH else MainTab.NOTES,
                        )
                    }
                }
            }
        }
    }

    fun updateIdentifier(value: String) {
        _uiState.update { it.copy(identifier = value) }
    }

    fun updateApiBaseUrl(value: String) {
        _uiState.update { it.copy(apiBaseUrl = value) }
    }

    fun updateSearchQuery(value: String) {
        _uiState.update { it.copy(searchQuery = value) }
    }

    fun updateNoteTitle(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(title = value)) }
    }

    fun updateNoteSummary(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(summary = value)) }
    }

    fun updateNoteDescription(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(description = value)) }
    }

    fun updateDueInput(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(dueInput = value)) }
    }

    fun updateRemindInput(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(remindInput = value)) }
    }

    fun selectTab(tab: MainTab) {
        _uiState.update { it.copy(currentTab = tab, message = null, error = null) }
        viewModelScope.launch {
            repository.setWidgetMode(if (tab == MainTab.NOTES) WidgetMode.NOTES else WidgetMode.SEARCH)
        }
    }

    fun signIn() {
        val current = uiState.value
        runAction {
            val snapshot = repository.login(current.identifier, current.apiBaseUrl)
            _uiState.update {
                it.copy(
                    identifier = "",
                    noteDraft = NoteDraft(),
                    editingNoteId = null,
                    currentTab = MainTab.NOTES,
                    message = "Signed in as ${snapshot.user?.username}.",
                    error = null,
                )
            }
        }
    }

    fun signOut() {
        runAction {
            repository.logout()
            _uiState.update {
                it.copy(
                    noteDraft = NoteDraft(),
                    editingNoteId = null,
                    searchQuery = "",
                    currentTab = MainTab.NOTES,
                    message = "Signed out.",
                    error = null,
                )
            }
        }
    }

    fun refreshNotes() {
        runAction {
            repository.refreshNotes()
            _uiState.update {
                it.copy(
                    message = "Notes refreshed.",
                    error = null,
                )
            }
        }
    }

    fun startEditing(note: NoteRecord) {
        _uiState.update {
            it.copy(
                noteDraft = note.toDraft(),
                editingNoteId = note.id,
                currentTab = MainTab.NOTES,
                message = null,
                error = null,
            )
        }
    }

    fun cancelEditing() {
        _uiState.update {
            it.copy(
                noteDraft = NoteDraft(),
                editingNoteId = null,
                message = null,
                error = null,
            )
        }
    }

    fun saveNote() {
        val current = uiState.value
        runAction {
            repository.saveNote(current.editingNoteId, current.noteDraft)
            _uiState.update {
                it.copy(
                    noteDraft = NoteDraft(),
                    editingNoteId = null,
                    message = if (current.editingNoteId == null) "Note created." else "Note updated.",
                    error = null,
                )
            }
        }
    }

    fun deleteNote(noteId: Int) {
        val current = uiState.value
        runAction {
            repository.deleteNote(noteId)
            _uiState.update {
                it.copy(
                    noteDraft = if (current.editingNoteId == noteId) NoteDraft() else it.noteDraft,
                    editingNoteId = if (current.editingNoteId == noteId) null else it.editingNoteId,
                    message = "Note deleted.",
                    error = null,
                )
            }
        }
    }

    fun runSearch() {
        val query = uiState.value.searchQuery
        runAction {
            val snapshot = repository.search(query)
            _uiState.update {
                it.copy(
                    currentTab = MainTab.SEARCH,
                    message =
                        if (snapshot.searchResults.isEmpty()) {
                            "No similar notes were found."
                        } else {
                            "Found ${snapshot.searchResults.size} semantic match(es)."
                        },
                    error = null,
                )
            }
        }
    }

    fun clearSearch() {
        runAction {
            repository.clearSearch()
            _uiState.update {
                it.copy(
                    searchQuery = "",
                    currentTab = MainTab.NOTES,
                    message = "Search cleared.",
                    error = null,
                )
            }
        }
    }

    private fun runAction(
        errorPrefix: String? = null,
        action: suspend () -> Unit,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isBusy = true, error = null) }
            try {
                action()
            } catch (error: Exception) {
                val message = error.message ?: "Unexpected request error."
                _uiState.update {
                    it.copy(
                        error = errorPrefix?.let { prefix -> "$prefix $message" } ?: message,
                        message = null,
                    )
                }
            } finally {
                _uiState.update { it.copy(isBusy = false) }
            }
        }
    }

    companion object {
        fun factory(application: Application) =
            viewModelFactory {
                initializer {
                    NotesViewModel(application)
                }
            }
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            NotesTheme {
                val viewModel: NotesViewModel = viewModel(factory = NotesViewModel.factory(application))
                val uiState by viewModel.uiState.collectAsState()
                NotesAppScreen(uiState = uiState, viewModel = viewModel)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotesAppScreen(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Notes Android") },
                actions = {
                    if (uiState.snapshot.user != null) {
                        TextButton(onClick = viewModel::refreshNotes) {
                            Text("Refresh")
                        }
                        TextButton(onClick = viewModel::signOut) {
                            Text("Sign out")
                        }
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
        ) {
            if (uiState.isBusy) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            StatusCard(
                message = uiState.message,
                error = uiState.error ?: uiState.snapshot.lastError,
            )

            if (uiState.snapshot.user == null) {
                LoginScreen(uiState = uiState, viewModel = viewModel)
            } else {
                TabRow(selectedTabIndex = if (uiState.currentTab == MainTab.NOTES) 0 else 1) {
                    Tab(
                        selected = uiState.currentTab == MainTab.NOTES,
                        onClick = { viewModel.selectTab(MainTab.NOTES) },
                        text = { Text("Notes") },
                    )
                    Tab(
                        selected = uiState.currentTab == MainTab.SEARCH,
                        onClick = { viewModel.selectTab(MainTab.SEARCH) },
                        text = { Text("Search") },
                    )
                }

                when (uiState.currentTab) {
                    MainTab.NOTES -> NotesScreen(uiState = uiState, viewModel = viewModel)
                    MainTab.SEARCH -> SearchScreen(uiState = uiState, viewModel = viewModel)
                }
            }
        }
    }
}

@Composable
private fun StatusCard(
    message: String?,
    error: String?,
) {
    if (message.isNullOrBlank() && error.isNullOrBlank()) {
        return
    }

    Card(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            if (!message.isNullOrBlank()) {
                Text(text = message, color = MaterialTheme.colorScheme.primary)
            }

            if (!error.isNullOrBlank()) {
                if (!message.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(8.dp))
                }
                Text(text = error, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun LoginScreen(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard(title = "Sign in", subtitle = "No password. Type an existing username, email, or phone value.") {
            OutlinedTextField(
                value = uiState.identifier,
                onValueChange = viewModel::updateIdentifier,
                label = { Text("Username, email, or phone") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(modifier = Modifier.height(12.dp))
            OutlinedTextField(
                value = uiState.apiBaseUrl,
                onValueChange = viewModel::updateApiBaseUrl,
                label = { Text("Server URL") },
                supportingText = { Text("Use the companion API, e.g. http://10.0.2.2:8787 on the emulator.") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = viewModel::signIn,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Sign in")
            }
        }

        SectionCard(
            title = "Widget-first architecture",
            subtitle = "The app uses Kotlin + Compose for screens and Jetpack Glance for the home-screen widget.",
        ) {
            Text(
                text =
                    "Android widgets do not support editable text fields directly, so widget actions launch tiny overlay forms for sign-in, add/edit, and semantic search.",
            )
        }
    }
}

@Composable
private fun NotesScreen(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            val user = uiState.snapshot.user
            SectionCard(
                title = "Current user",
                subtitle =
                    if (user == null) {
                        ""
                    } else {
                        buildString {
                            append("#${user.id} · ${user.username}")
                            user.email?.takeIf { it.isNotBlank() }?.let { append(" · $it") }
                            user.phone?.takeIf { it.isNotBlank() }?.let { append(" · $it") }
                        }
                    },
            ) {
                Text(
                    text = "Data comes from MARKETING_DB user_v1 and user_note_v1 through the companion API.",
                )
            }
        }

        item {
            SectionCard(
                title = if (uiState.editingNoteId == null) "New note" else "Edit note",
                subtitle = "Use yyyy-MM-ddTHH:mm for due and reminder times.",
            ) {
                NoteEditorFields(uiState = uiState, viewModel = viewModel)
            }
        }

        item {
            Text(
                text = "Notes (${uiState.snapshot.notes.size})",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }

        if (uiState.snapshot.notes.isEmpty()) {
            item {
                SectionCard(title = "No notes", subtitle = "Create the first note for this user.") {
                    Text(text = "Notes are sorted by due time, just like the web prototype.")
                }
            }
        } else {
            items(uiState.snapshot.notes, key = { it.id }) { note ->
                NoteListItem(
                    note = note,
                    onEdit = { viewModel.startEditing(note) },
                    onDelete = { viewModel.deleteNote(note.id) },
                )
            }
        }
    }
}

@Composable
private fun SearchScreen(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            SectionCard(
                title = "Semantic search",
                subtitle = "Search meaning, intent, or topic. The API embeds the query and compares it against note vectors in Postgres.",
            ) {
                OutlinedTextField(
                    value = uiState.searchQuery,
                    onValueChange = viewModel::updateSearchQuery,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Semantic query") },
                    minLines = 3,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Button(
                        onClick = viewModel::runSearch,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Search")
                    }
                    TextButton(
                        onClick = viewModel::clearSearch,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Clear")
                    }
                }
            }
        }

        item {
            Text(
                text = "Results (${uiState.snapshot.searchResults.size})",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
        }

        if (uiState.snapshot.searchResults.isEmpty()) {
            item {
                SectionCard(
                    title = "No results yet",
                    subtitle = "Run a semantic search to rank the most similar notes.",
                ) {
                    Text(text = "The search tab mirrors the unfinished notes-next prototype, but with a native Android UI.")
                }
            }
        } else {
            items(uiState.snapshot.searchResults, key = { it.note.id }) { result ->
                SearchResultItem(result = result, onOpen = { viewModel.startEditing(result.note) })
            }
        }
    }
}

@Composable
private fun NoteEditorFields(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
) {
    OutlinedTextField(
        value = uiState.noteDraft.title,
        onValueChange = viewModel::updateNoteTitle,
        label = { Text("Title") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    Spacer(modifier = Modifier.height(12.dp))
    OutlinedTextField(
        value = uiState.noteDraft.summary,
        onValueChange = viewModel::updateNoteSummary,
        label = { Text("Summary") },
        modifier = Modifier.fillMaxWidth(),
        minLines = 2,
    )
    Spacer(modifier = Modifier.height(12.dp))
    OutlinedTextField(
        value = uiState.noteDraft.description,
        onValueChange = viewModel::updateNoteDescription,
        label = { Text("Description") },
        modifier = Modifier.fillMaxWidth(),
        minLines = 4,
    )
    Spacer(modifier = Modifier.height(12.dp))
    OutlinedTextField(
        value = uiState.noteDraft.dueInput,
        onValueChange = viewModel::updateDueInput,
        label = { Text("Due time") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    Spacer(modifier = Modifier.height(12.dp))
    OutlinedTextField(
        value = uiState.noteDraft.remindInput,
        onValueChange = viewModel::updateRemindInput,
        label = { Text("Reminder time") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    Spacer(modifier = Modifier.height(16.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Button(
            onClick = viewModel::saveNote,
            modifier = Modifier.weight(1f),
        ) {
            Text(if (uiState.editingNoteId == null) "Create note" else "Save note")
        }
        if (uiState.editingNoteId != null) {
            TextButton(
                onClick = viewModel::cancelEditing,
                modifier = Modifier.weight(1f),
            ) {
                Text("Cancel")
            }
        }
    }
}

@Composable
private fun NoteListItem(
    note: NoteRecord,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = note.title?.takeIf { it.isNotBlank() } ?: "Untitled note",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "Note #${note.id}",
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                TextButton(onClick = onEdit) {
                    Text("Edit")
                }
                TextButton(onClick = onDelete) {
                    Text("Delete")
                }
            }

            note.summary?.takeIf { it.isNotBlank() }?.let {
                Text(text = it)
            }
            note.description?.takeIf { it.isNotBlank() }?.let {
                Text(text = it, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            Text(text = "Due ${formatTimestamp(note.timeDue)}")
            Text(text = "Remind ${formatTimestamp(note.timeRemind)}")
            Text(text = "Updated ${formatTimestamp(note.timeModified)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SearchResultItem(
    result: SemanticSearchResult,
    onOpen: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = result.note.title?.takeIf { it.isNotBlank() } ?: "Untitled note",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(text = "Note #${result.note.id}")
                }
                Text(text = "${formatPercent(result.similarity)} match", color = MaterialTheme.colorScheme.primary)
            }
            Text(text = "Full note ${formatPercent(result.contentSimilarity)} · Title ${formatPercent(result.titleSimilarity)}")
            result.note.summary?.takeIf { it.isNotBlank() }?.let { Text(text = it) }
            result.note.description?.takeIf { it.isNotBlank() }?.let {
                Text(text = it, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(text = "Updated ${formatTimestamp(result.note.timeModified)}")
            Button(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
                Text("Open note")
            }
        }
    }
}

@Composable
private fun SectionCard(
    title: String,
    subtitle: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(text = title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (subtitle.isNotBlank()) {
                Text(text = subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            content()
        }
    }
}

@Composable
private fun NotesTheme(content: @Composable () -> Unit) {
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize(), content = content)
    }
}
