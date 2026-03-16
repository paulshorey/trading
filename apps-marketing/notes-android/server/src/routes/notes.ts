import {
  createNoteForUser,
  deleteNoteForUser,
  listNotesByUser,
  parseNoteInput,
  updateNoteForUser,
} from "@lib/db-marketing"
import { Router } from "express"
import {
  EmbeddingConfigurationError,
  EmbeddingRequestError,
  createNoteEmbeddingInput,
} from "@/lib/note-embeddings"
import { parsePositiveInteger, sendError, toBodyObject } from "@/lib/http"

const getErrorStatus = (error: unknown) => {
  if (error instanceof EmbeddingConfigurationError) {
    return 500
  }

  if (error instanceof EmbeddingRequestError) {
    return error.status >= 400 && error.status < 500 ? 502 : error.status
  }

  return 400
}

export const createNotesRouter = () => {
  const router = Router()

  router.get("/", async (request, response) => {
    try {
      const userId = parsePositiveInteger(request.query.userId, "userId")
      const notes = await listNotesByUser(userId)
      return response.json({ notes })
    } catch (error) {
      return sendError(response, error)
    }
  })

  router.post("/", async (request, response) => {
    try {
      const body = toBodyObject(request.body)
      const userId = parsePositiveInteger(body.userId, "userId")
      const noteInput = parseNoteInput(body.note)
      const embeddings = await createNoteEmbeddingInput(noteInput)
      const note = await createNoteForUser(userId, noteInput, embeddings)
      return response.status(201).json({ note })
    } catch (error) {
      return sendError(response, error, getErrorStatus(error))
    }
  })

  router.patch("/", async (request, response) => {
    try {
      const body = toBodyObject(request.body)
      const userId = parsePositiveInteger(body.userId, "userId")
      const noteId = parsePositiveInteger(body.noteId, "noteId")
      const noteInput = parseNoteInput(body.note)
      const embeddings = await createNoteEmbeddingInput(noteInput)
      const note = await updateNoteForUser(noteId, userId, noteInput, embeddings)

      if (!note) {
        return response.status(404).json({ error: "Note not found." })
      }

      return response.json({ note })
    } catch (error) {
      return sendError(response, error, getErrorStatus(error))
    }
  })

  router.delete("/", async (request, response) => {
    try {
      const body = toBodyObject(request.body)
      const userId = parsePositiveInteger(body.userId, "userId")
      const noteId = parsePositiveInteger(body.noteId, "noteId")
      const deleted = await deleteNoteForUser(noteId, userId)

      if (!deleted) {
        return response.status(404).json({ error: "Note not found." })
      }

      return response.json({ ok: true })
    } catch (error) {
      return sendError(response, error)
    }
  })

  return router
}
