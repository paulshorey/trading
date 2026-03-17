import assert from "node:assert/strict"
import { test } from "node:test"
import type { NotesAppService } from "../services/notes-app"

type RequestOptions = {
  body?: unknown
  headers?: Record<string, string>
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
}

type ResponsePayload = {
  body: unknown
  status: number
}

export type NotesApiAdapter = {
  close?: () => Promise<void> | void
  request: (options: RequestOptions) => Promise<ResponsePayload>
}

type AdapterFactory = (
  service: NotesAppService,
) => Promise<NotesApiAdapter> | NotesApiAdapter

const sampleUser = {
  id: 7,
  username: "admin",
  email: "admin@example.com",
  phone: "5550100",
}

const sampleNote = {
  id: 41,
  userId: sampleUser.id,
  title: "Ship Notes API tests",
  summary: "Verify both HTTP adapters",
  description: "The Next and Express routes should stay behaviorally aligned.",
  timeDue: "2026-03-18T16:00:00.000Z",
  timeRemind: "2026-03-18T15:30:00.000Z",
  timeCreated: "2026-03-17T10:00:00.000Z",
  timeModified: "2026-03-17T10:05:00.000Z",
}

const sampleSearchResult = {
  note: sampleNote,
  similarity: 0.94,
  titleSimilarity: 0.91,
  contentSimilarity: 0.89,
}

export const createFakeNotesAppService = (
  overrides: Partial<NotesAppService> = {},
): NotesAppService => ({
  getNotesAppErrorStatus: () => 400,
  getNotesAppSession: async () => ({ user: sampleUser }),
  findNotesAppSession: async () => ({ user: sampleUser }),
  listNotesForNotesApp: async () => ({ notes: [sampleNote] }),
  createNoteForNotesApp: async () => ({ note: sampleNote }),
  updateNoteForNotesApp: async () => ({ note: sampleNote }),
  deleteNoteForNotesApp: async () => ({ ok: true }),
  searchNotesForNotesApp: async () => ({ results: [sampleSearchResult] }),
  ...overrides,
})

const readError = (body: unknown) =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined

export const registerNotesApiAdapterSuite = (
  adapterName: string,
  createAdapter: AdapterFactory,
) => {
  test(`${adapterName} adapter parity`, async (t) => {
    t.diagnostic(
      "Verifies that Notes API route semantics stay aligned across the Next and Express adapters.",
    )
  })

  test(`${adapterName} login trims identifiers`, async (t) => {
    const requests: Array<{ identifier: string }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        findNotesAppSession: async (request) => {
          requests.push(request)
          return { user: sampleUser }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/session",
      body: { identifier: "  admin  " },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { user: sampleUser })
    assert.deepEqual(requests, [{ identifier: "admin" }])
  })

  test(`${adapterName} returns 404 for missing session login`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        findNotesAppSession: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/session",
      body: { identifier: "missing-user" },
    })

    assert.equal(response.status, 404)
    assert.equal(
      readError(response.body),
      "No matching user was found. Enter an existing username, email, or phone number.",
    )
  })

  test(`${adapterName} validates session lookup query params`, async (t) => {
    const adapter = await createAdapter(createFakeNotesAppService())

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/session?userId=0",
    })

    assert.equal(response.status, 400)
    assert.equal(readError(response.body), "userId must be an integer of at least 1.")
  })

  test(`${adapterName} returns 404 when a stored session user is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        getNotesAppSession: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/session?userId=7",
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "User not found.")
  })

  test(`${adapterName} lists notes for the requested user`, async (t) => {
    const requests: Array<{ userId: number }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        listNotesForNotesApp: async (request) => {
          requests.push(request)
          return { notes: [sampleNote] }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/notes?userId=7",
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { notes: [sampleNote] })
    assert.deepEqual(requests, [{ userId: 7 }])
  })

  test(`${adapterName} creates notes with a 201 response`, async (t) => {
    const requests: Array<unknown> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        createNoteForNotesApp: async (request) => {
          requests.push(request)
          return { note: sampleNote }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/notes",
      body: {
        userId: 7,
        note: {
          title: "Ship Notes API tests",
          summary: "Verify both HTTP adapters",
          description: "The Next and Express routes should stay behaviorally aligned.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    })

    assert.equal(response.status, 201)
    assert.deepEqual(response.body, { note: sampleNote })
    assert.deepEqual(requests, [
      {
        userId: 7,
        note: {
          title: "Ship Notes API tests",
          summary: "Verify both HTTP adapters",
          description: "The Next and Express routes should stay behaviorally aligned.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    ])
  })

  test(`${adapterName} returns 404 when an update target is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        updateNoteForNotesApp: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "PATCH",
      path: "/api/notes",
      body: {
        userId: 7,
        noteId: 999,
        note: {
          title: "Ship Notes API tests",
          summary: "Verify both HTTP adapters",
          description: "The Next and Express routes should stay behaviorally aligned.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "Note not found.")
  })

  test(`${adapterName} returns 404 when a delete target is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        deleteNoteForNotesApp: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "DELETE",
      path: "/api/notes",
      body: {
        userId: 7,
        noteId: 999,
      },
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "Note not found.")
  })

  test(`${adapterName} maps search failures through the shared status helper`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        getNotesAppErrorStatus: () => 502,
        searchNotesForNotesApp: async () => {
          throw new Error("Embedding provider failed.")
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/notes/search",
      body: {
        userId: 7,
        query: "adapter parity",
        limit: 12,
      },
    })

    assert.equal(response.status, 502)
    assert.equal(readError(response.body), "Embedding provider failed.")
  })
}
