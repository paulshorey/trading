import {
  createNoteForNotesApp,
  deleteNoteForNotesApp,
  getNotesAppErrorStatus,
  listNotesForNotesApp,
  NOTES_APP_NOTE_NOT_FOUND_ERROR,
  parseCreateNoteRequest,
  parseDeleteNoteRequest,
  parseNotesRequest,
  parseUpdateNoteRequest,
  updateNoteForNotesApp,
} from "@lib/db-marketing/services/notes-app"
import { Router } from "express"
import type { Router as ExpressRouter } from "express"
import { sendError } from "@/lib/http"

export const createNotesRouter = (): ExpressRouter => {
  const router = Router()

  router.get("/", async (request, response) => {
    try {
      const result = await listNotesForNotesApp(parseNotesRequest(request.query.userId))
      return response.json(result)
    } catch (error) {
      return sendError(response, error)
    }
  })

  router.post("/", async (request, response) => {
    try {
      const result = await createNoteForNotesApp(parseCreateNoteRequest(request.body))
      return response.status(201).json(result)
    } catch (error) {
      return sendError(response, error, getNotesAppErrorStatus(error))
    }
  })

  router.patch("/", async (request, response) => {
    try {
      const result = await updateNoteForNotesApp(parseUpdateNoteRequest(request.body))

      if (!result) {
        return response.status(404).json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR })
      }

      return response.json(result)
    } catch (error) {
      return sendError(response, error, getNotesAppErrorStatus(error))
    }
  })

  router.delete("/", async (request, response) => {
    try {
      const result = await deleteNoteForNotesApp(parseDeleteNoteRequest(request.body))

      if (!result) {
        return response.status(404).json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR })
      }

      return response.json(result)
    } catch (error) {
      return sendError(response, error)
    }
  })

  return router
}
