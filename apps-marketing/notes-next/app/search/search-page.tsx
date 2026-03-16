"use client"

import Link from "next/link"
import type { SemanticSearchResult, UserSummary } from "@lib/db-marketing"
import { type FormEvent, useEffect, useState } from "react"
import styles from "../page.module.css"

const STORAGE_KEY = "notes-app-user-id"

interface SessionResponse {
  user: UserSummary
}

interface SearchResponse {
  results: SemanticSearchResult[]
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected request error."

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))

const formatSimilarity = (value: number | null) => {
  if (typeof value !== "number") {
    return "n/a"
  }

  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`
}

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

export default function SearchPageClient() {
  const [user, setUser] = useState<UserSummary | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SemanticSearchResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [searchPending, setSearchPending] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      const storedUserId = window.localStorage.getItem(STORAGE_KEY)

      if (!storedUserId) {
        setSessionLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/session?userId=${storedUserId}`, {
          cache: "no-store",
        })
        const data = await readJson<SessionResponse>(response)

        if (!active) {
          return
        }

        setUser(data.user)
      } catch (error) {
        if (!active) {
          return
        }

        window.localStorage.removeItem(STORAGE_KEY)
        setUser(null)
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
  }, [])

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!user) {
      setErrorMessage("Sign in on the notes page before searching.")
      return
    }

    setErrorMessage(null)
    setStatusMessage(null)
    setSearchPending(true)

    try {
      const response = await fetch("/api/notes/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user.id,
          query,
          limit: 12,
        }),
      })
      const data = await readJson<SearchResponse>(response)
      setResults(data.results)
      setHasSearched(true)
      setStatusMessage(
        data.results.length === 0
          ? "No similar notes were found."
          : `Found ${data.results.length} semantic match${data.results.length === 1 ? "" : "es"}.`,
      )
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setSearchPending(false)
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Vector search</p>
            <h1 className={styles.title}>Semantic note search</h1>
            <p className={styles.subtitle}>
              Search across note meaning instead of just keywords. Queries are embedded
              with OpenAI and matched against stored note vectors in Postgres.
            </p>
          </div>

          <div className={styles.heroMeta}>
            <p>Uses title and full-note embeddings</p>
            <p>First search may backfill older notes</p>
            <Link className={styles.secondaryButton} href="/">
              Back to notes
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
                <h2>Sign in required</h2>
                <p>Use the notes page to choose a user before running semantic search.</p>
              </div>
            </div>

            <div className={styles.actions}>
              <Link className={styles.primaryButton} href="/">
                Go to notes
              </Link>
            </div>
          </section>
        ) : (
          <div className={styles.content}>
            <section className={`${styles.card} ${styles.sessionCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>Searching as</h2>
                  <p>
                    #{user.id} · {user.username}
                    {user.email ? ` · ${user.email}` : ""}
                    {user.phone ? ` · ${user.phone}` : ""}
                  </p>
                </div>

                <div className={styles.actions}>
                  <Link className={styles.secondaryButton} href="/">
                    Edit notes
                  </Link>
                </div>
              </div>
            </section>

            <section className={`${styles.card} ${styles.editorCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>Search notes</h2>
                  <p>
                    Enter a phrase, intent, or topic. The search uses the combined
                    title, summary, and description embedding as the primary ranking
                    signal, then lightly reranks with the title embedding.
                  </p>
                </div>
              </div>

              <form className={styles.stack} onSubmit={handleSearch}>
                <label className={styles.field}>
                  <span>Semantic query</span>
                  <textarea
                    name="query"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="e.g. planning notes about quarterly goals and customer follow-up"
                    required
                    rows={4}
                    value={query}
                  />
                </label>

                <p className={styles.searchHint}>
                  Best for meaning-based matches such as themes, reminders, or
                  paraphrased requests.
                </p>

                <div className={styles.actions}>
                  <button className={styles.primaryButton} disabled={searchPending} type="submit">
                    {searchPending ? "Searching…" : "Search semantically"}
                  </button>
                </div>
              </form>
            </section>

            <section className={`${styles.card} ${styles.listCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>Results</h2>
                  <p>
                    {hasSearched
                      ? `${results.length} semantic result${results.length === 1 ? "" : "s"}`
                      : "Run a search to see ranked note matches."}
                  </p>
                </div>
              </div>

              {!hasSearched ? (
                <p className={styles.emptyState}>
                  Semantic matches will appear here after you submit a query.
                </p>
              ) : results.length === 0 ? (
                <p className={styles.emptyState}>
                  No close matches were found for this user&apos;s current notes.
                </p>
              ) : (
                <ul className={styles.noteList}>
                  {results.map((result) => (
                    <li className={styles.noteCard} key={result.note.id}>
                      <div className={styles.searchResultHeader}>
                        <div>
                          <h3>{result.note.title?.trim() || "Untitled note"}</h3>
                          <p>Note #{result.note.id}</p>
                        </div>

                        <div className={styles.similarityBadge}>
                          {formatSimilarity(result.similarity)} match
                        </div>
                      </div>

                      <div className={styles.similarityBarTrack} aria-hidden="true">
                        <div
                          className={styles.similarityBarFill}
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(100, Math.round(result.similarity * 100)),
                            )}%`,
                          }}
                        />
                      </div>

                      <dl className={styles.searchMetrics}>
                        <div>
                          <dt>Full note</dt>
                          <dd>{formatSimilarity(result.contentSimilarity)}</dd>
                        </div>
                        <div>
                          <dt>Title</dt>
                          <dd>{formatSimilarity(result.titleSimilarity)}</dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd>{formatDateTime(result.note.timeModified)}</dd>
                        </div>
                      </dl>

                      {result.note.summary && <p className={styles.noteSummary}>{result.note.summary}</p>}
                      {result.note.description && (
                        <p className={styles.noteDescription}>{result.note.description}</p>
                      )}
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
