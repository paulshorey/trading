"use client"

import Link from "next/link"
import type { NoteRecord, UserSummary } from "@lib/db-marketing"
import { type FormEvent, useCallback, useEffect, useState } from "react"
import styles from "./page.module.css"

const STORAGE_KEY = "notes-app-user-id"

interface NoteFormState {
  title: string
  summary: string
  description: string
  timeDue: string
  timeRemind: string
}

interface SessionResponse {
  user: UserSummary
}

interface NotesResponse {
  notes: NoteRecord[]
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))

const toDateTimeLocalValue = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

const createDefaultNoteForm = (): NoteFormState => {
  const now = new Date()
  const remindAt = new Date(now.getTime() + 30 * 60 * 1000)
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  return {
    title: "",
    summary: "",
    description: "",
    timeDue: toDateTimeLocalValue(dueAt),
    timeRemind: toDateTimeLocalValue(remindAt),
  }
}

const noteToFormState = (note: NoteRecord): NoteFormState => ({
  title: note.title ?? "",
  summary: note.summary ?? "",
  description: note.description ?? "",
  timeDue: toDateTimeLocalValue(note.timeDue),
  timeRemind: toDateTimeLocalValue(note.timeRemind),
})

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected request error."

const readJson = async <T,>(response: Response) => {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed.")
  }

  if (!payload) {
    throw new Error("Request returned no response body.")
  }

  return payload as T
}

export default function NotesApp() {
  const [identifier, setIdentifier] = useState("")
  const [user, setUser] = useState<UserSummary | null>(null)
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [noteForm, setNoteForm] = useState<NoteFormState>(() => createDefaultNoteForm())
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [notesLoading, setNotesLoading] = useState(false)
  const [authPending, setAuthPending] = useState(false)
  const [notePending, setNotePending] = useState(false)
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const clearMessages = () => {
    setStatusMessage(null)
    setErrorMessage(null)
  }

  const resetNoteForm = () => {
    setNoteForm(createDefaultNoteForm())
    setEditingNoteId(null)
  }

  const loadNotes = useCallback(async (userId: number) => {
    setNotesLoading(true)

    try {
      const response = await fetch(`/api/notes?userId=${userId}`, {
        cache: "no-store",
      })
      const data = await readJson<NotesResponse>(response)
      setNotes(data.notes)
      return data.notes
    } finally {
      setNotesLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      const storedUserId = window.localStorage.getItem(STORAGE_KEY)

      if (!storedUserId) {
        setSessionLoading(false)
        return
      }

      try {
        const sessionResponse = await fetch(`/api/session?userId=${storedUserId}`, {
          cache: "no-store",
        })
        const sessionData = await readJson<SessionResponse>(sessionResponse)

        if (!active) {
          return
        }

        setUser(sessionData.user)
        await loadNotes(sessionData.user.id)
      } catch (error) {
        if (!active) {
          return
        }

        window.localStorage.removeItem(STORAGE_KEY)
        setUser(null)
        setNotes([])
        setErrorMessage(getErrorMessage(error))
      } finally {
        if (active) {
          setSessionLoading(false)
        }
      }
    }

    void restoreSession()

    return () => {
      active = false
    }
  }, [loadNotes])

  const handleRefreshNotes = async () => {
    if (!user) {
      return
    }

    clearMessages()

    try {
      await loadNotes(user.id)
      setStatusMessage("Notes refreshed.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearMessages()
    setAuthPending(true)

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ identifier }),
      })
      const data = await readJson<SessionResponse>(response)

      window.localStorage.setItem(STORAGE_KEY, String(data.user.id))
      setUser(data.user)
      setIdentifier("")
      resetNoteForm()
      await loadNotes(data.user.id)
      setStatusMessage(`Signed in as ${data.user.username}.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setAuthPending(false)
      setSessionLoading(false)
    }
  }

  const handleLogout = () => {
    window.localStorage.removeItem(STORAGE_KEY)
    setUser(null)
    setNotes([])
    resetNoteForm()
    clearMessages()
    setStatusMessage("Signed out.")
  }

  const handleStartEdit = (note: NoteRecord) => {
    clearMessages()
    setEditingNoteId(note.id)
    setNoteForm(noteToFormState(note))
  }

  const handleSaveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!user) {
      setErrorMessage("Sign in before editing notes.")
      return
    }

    clearMessages()
    setNotePending(true)

    try {
      const response = await fetch("/api/notes", {
        method: editingNoteId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user.id,
          noteId: editingNoteId,
          note: noteForm,
        }),
      })

      await readJson<{ note: NoteRecord }>(response)
      await loadNotes(user.id)
      resetNoteForm()
      setStatusMessage(editingNoteId ? "Note updated." : "Note created.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setNotePending(false)
    }
  }

  const handleDeleteNote = async (noteId: number) => {
    if (!user) {
      return
    }

    const confirmed = window.confirm("Delete this note?")

    if (!confirmed) {
      return
    }

    clearMessages()
    setDeletingNoteId(noteId)

    try {
      const response = await fetch("/api/notes", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user.id,
          noteId,
        }),
      })

      await readJson<{ ok: true }>(response)
      await loadNotes(user.id)

      if (editingNoteId === noteId) {
        resetNoteForm()
      }

      setStatusMessage("Note deleted.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeletingNoteId(null)
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Prototype CMS</p>
            <h1 className={styles.title}>Notes</h1>
            <p className={styles.subtitle}>
              Sign in with an existing username, email, or phone number to manage
              your notes in <code>user_note_v1</code>.
            </p>
          </div>
          <div className={styles.heroMeta}>
            <p>Local session storage only</p>
            <p>No password or auth yet</p>
            <Link className={styles.secondaryButton} href="/search">
              Semantic search
            </Link>
          </div>
        </section>

        {(statusMessage || errorMessage) && (
          <section className={styles.feedback}>
            {statusMessage && <p className={styles.success}>{statusMessage}</p>}
            {errorMessage && <p className={styles.error}>{errorMessage}</p>}
          </section>
        )}

        {sessionLoading ? (
          <section className={styles.card}>
            <p className={styles.emptyState}>Restoring your local session…</p>
          </section>
        ) : !user ? (
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2>Sign in</h2>
                <p>Use any existing username, email, or phone value.</p>
              </div>
            </div>

            <form className={styles.stack} onSubmit={handleLogin}>
              <label className={styles.field}>
                <span>Username, email, or phone</span>
                <input
                  autoComplete="username"
                  name="identifier"
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="e.g. alice or alice@example.com"
                  value={identifier}
                />
              </label>

              <button className={styles.primaryButton} disabled={authPending} type="submit">
                {authPending ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </section>
        ) : (
          <div className={styles.content}>
            <section className={`${styles.card} ${styles.sessionCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>Current user</h2>
                  <p>
                    #{user.id} · {user.username}
                    {user.email ? ` · ${user.email}` : ""}
                    {user.phone ? ` · ${user.phone}` : ""}
                  </p>
                </div>

                <div className={styles.actions}>
                  <Link className={styles.secondaryButton} href="/search">
                    Semantic search
                  </Link>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => void handleRefreshNotes()}
                    type="button"
                  >
                    {notesLoading ? "Refreshing…" : "Refresh notes"}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    onClick={handleLogout}
                    type="button"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </section>

            <section className={`${styles.card} ${styles.editorCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>{editingNoteId ? "Edit note" : "New note"}</h2>
                  <p>
                    {editingNoteId
                      ? "Update the selected note."
                      : "Create a note for the signed-in user."}
                  </p>
                </div>

                {editingNoteId && (
                  <button
                    className={styles.secondaryButton}
                    onClick={resetNoteForm}
                    type="button"
                  >
                    Cancel edit
                  </button>
                )}
              </div>

              <form className={styles.stack} onSubmit={handleSaveNote}>
                <label className={styles.field}>
                  <span>Title</span>
                  <input
                    name="title"
                    onChange={(event) =>
                      setNoteForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Weekly review"
                    value={noteForm.title}
                  />
                </label>

                <label className={styles.field}>
                  <span>Summary</span>
                  <input
                    name="summary"
                    onChange={(event) =>
                      setNoteForm((current) => ({
                        ...current,
                        summary: event.target.value,
                      }))
                    }
                    placeholder="Short summary"
                    value={noteForm.summary}
                  />
                </label>

                <label className={styles.field}>
                  <span>Description</span>
                  <textarea
                    name="description"
                    onChange={(event) =>
                      setNoteForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Longer description or reminder details"
                    rows={6}
                    value={noteForm.description}
                  />
                </label>

                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span>Due time</span>
                    <input
                      name="timeDue"
                      onChange={(event) =>
                        setNoteForm((current) => ({
                          ...current,
                          timeDue: event.target.value,
                        }))
                      }
                      required
                      type="datetime-local"
                      value={noteForm.timeDue}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Reminder time</span>
                    <input
                      name="timeRemind"
                      onChange={(event) =>
                        setNoteForm((current) => ({
                          ...current,
                          timeRemind: event.target.value,
                        }))
                      }
                      required
                      type="datetime-local"
                      value={noteForm.timeRemind}
                    />
                  </label>
                </div>

                <div className={styles.actions}>
                  <button className={styles.primaryButton} disabled={notePending} type="submit">
                    {notePending
                      ? editingNoteId
                        ? "Saving…"
                        : "Creating…"
                      : editingNoteId
                        ? "Save note"
                        : "Create note"}
                  </button>
                </div>
              </form>
            </section>

            <section className={`${styles.card} ${styles.listCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>Notes</h2>
                  <p>{notes.length} record(s) for this user.</p>
                </div>
              </div>

              {notesLoading ? (
                <p className={styles.emptyState}>Loading notes…</p>
              ) : notes.length === 0 ? (
                <p className={styles.emptyState}>
                  No notes yet. Create the first record for this user.
                </p>
              ) : (
                <ul className={styles.noteList}>
                  {notes.map((note) => (
                    <li className={styles.noteCard} key={note.id}>
                      <div className={styles.noteCardHeader}>
                        <div>
                          <h3>{note.title?.trim() || "Untitled note"}</h3>
                          <p>Note #{note.id}</p>
                        </div>

                        <div className={styles.actions}>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => handleStartEdit(note)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className={styles.dangerButton}
                            disabled={deletingNoteId === note.id}
                            onClick={() => void handleDeleteNote(note.id)}
                            type="button"
                          >
                            {deletingNoteId === note.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>

                      {note.summary && <p className={styles.noteSummary}>{note.summary}</p>}
                      {note.description && (
                        <p className={styles.noteDescription}>{note.description}</p>
                      )}

                      <dl className={styles.noteMeta}>
                        <div>
                          <dt>Due</dt>
                          <dd>{formatDateTime(note.timeDue)}</dd>
                        </div>
                        <div>
                          <dt>Remind</dt>
                          <dd>{formatDateTime(note.timeRemind)}</dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd>{formatDateTime(note.timeModified)}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
