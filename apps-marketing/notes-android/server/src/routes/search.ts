import {
  listNotesMissingEmbeddingsByUser,
  searchNotesByEmbedding,
  updateNoteEmbeddingsForUser,
} from "@lib/db-marketing"
import { Router } from "express"
import type { Router as ExpressRouter } from "express"
import {
  EmbeddingConfigurationError,
  EmbeddingRequestError,
  createBackfillEmbeddingInputs,
  createQueryEmbedding,
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

const syncMissingEmbeddingsForUser = async (userId: number) => {
  const notes = await listNotesMissingEmbeddingsByUser(userId)

  if (notes.length === 0) {
    return
  }

  const jobs = await createBackfillEmbeddingInputs(notes)

  for (const job of jobs) {
    await updateNoteEmbeddingsForUser(job.noteId, userId, job.input)
  }
}

export const createSearchRouter = (): ExpressRouter => {
  const router = Router()

  router.post("/", async (request, response) => {
    try {
      const body = toBodyObject(request.body)
      const userId = parsePositiveInteger(body.userId, "userId")
      const query = typeof body.query === "string" ? body.query.trim() : ""
      const limit = parsePositiveInteger(body.limit ?? 12, "limit", {
        min: 1,
        max: 25,
      })

      if (query === "") {
        throw new Error("Search query is required.")
      }

      await syncMissingEmbeddingsForUser(userId)

      const queryEmbedding = await createQueryEmbedding(query)
      const results = await searchNotesByEmbedding(userId, queryEmbedding, limit)

      return response.json({ results })
    } catch (error) {
      return sendError(response, error, getErrorStatus(error))
    }
  })

  return router
}
