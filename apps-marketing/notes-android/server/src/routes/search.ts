import {
  getNotesAppErrorStatus,
  parseSearchRequest,
  searchNotesForNotesApp,
} from "@lib/db-marketing/services/notes-app"
import { Router } from "express"
import type { Router as ExpressRouter } from "express"
import { sendError } from "@/lib/http"

export const createSearchRouter = (): ExpressRouter => {
  const router = Router()

  router.post("/", async (request, response) => {
    try {
      const result = await searchNotesForNotesApp(parseSearchRequest(request.body))
      return response.json(result)
    } catch (error) {
      return sendError(response, error, getNotesAppErrorStatus(error))
    }
  })

  return router
}
