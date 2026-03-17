import {
  notesAppService,
  parseSearchRequest,
  type NotesAppService,
} from "@lib/db-marketing/services/notes-app"
import { Router } from "express"
import type { Router as ExpressRouter } from "express"
import { sendError } from "@/lib/http"

export const createSearchRouter = (
  service: NotesAppService = notesAppService,
): ExpressRouter => {
  const router = Router()

  router.post("/", async (request, response) => {
    try {
      const result = await service.searchNotesForNotesApp(parseSearchRequest(request.body))
      return response.json(result)
    } catch (error) {
      return sendError(response, error, service.getNotesAppErrorStatus(error))
    }
  })

  return router
}
