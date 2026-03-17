import {
  getNotesAppErrorStatus,
  NOTES_APP_NOTE_NOT_FOUND_ERROR,
  notesAppService,
  parseCreateNoteRequest,
  parseDeleteNoteRequest,
  parseNotesRequest,
  parseUpdateNoteRequest,
  type NotesAppService,
} from "@lib/db-marketing/services/notes-app"
import { Router } from "express"
import type { Router as ExpressRouter } from "express"
import { sendError } from "@/lib/http"

export const createNotesRouter = (
  service: NotesAppService = notesAppService,
): ExpressRouter => {
  const router = Router()

  router.get("/", async (request, response) => {
    try {
      const result = await service.listNotesForNotesApp(parseNotesRequest(request.query.userId))
      return response.json(result)
    } catch (error) {
      return sendError(response, error)
    }
  })

  router.post("/", async (request, response) => {
    try {
      const result = await service.createNoteForNotesApp(parseCreateNoteRequest(request.body))
      return response.status(201).json(result)
    } catch (error) {
      return sendError(response, error, service.getNotesAppErrorStatus(error))
    }
  })

  router.patch("/", async (request, response) => {
    try {
      const result = await service.updateNoteForNotesApp(parseUpdateNoteRequest(request.body))

      if (!result) {
        return response.status(404).json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR })
      }

      return response.json(result)
    } catch (error) {
      return sendError(response, error, service.getNotesAppErrorStatus(error))
    }
  })

  router.delete("/", async (request, response) => {
    try {
      const result = await service.deleteNoteForNotesApp(parseDeleteNoteRequest(request.body))

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
