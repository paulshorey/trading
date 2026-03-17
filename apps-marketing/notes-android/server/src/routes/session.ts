import {
  findNotesAppSession,
  getNotesAppSession,
  NOTES_APP_LOGIN_NOT_FOUND_ERROR,
  NOTES_APP_USER_NOT_FOUND_ERROR,
  parseSessionLookupRequest,
  parseSessionRequest,
} from "@lib/db-marketing/services/notes-app"
import { Router } from "express"
import type { Router as ExpressRouter } from "express"
import { sendError } from "@/lib/http"

export const createSessionRouter = (): ExpressRouter => {
  const router = Router()

  router.get("/", async (request, response) => {
    try {
      const result = await getNotesAppSession(parseSessionRequest(request.query.userId))

      if (!result) {
        return response.status(404).json({ error: NOTES_APP_USER_NOT_FOUND_ERROR })
      }

      return response.json(result)
    } catch (error) {
      return sendError(response, error)
    }
  })

  router.post("/", async (request, response) => {
    try {
      const result = await findNotesAppSession(parseSessionLookupRequest(request.body))

      if (!result) {
        return response.status(404).json({
          error: NOTES_APP_LOGIN_NOT_FOUND_ERROR,
        })
      }

      return response.json(result)
    } catch (error) {
      return sendError(response, error)
    }
  })

  return router
}
