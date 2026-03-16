import { findUserByIdentifier, getUserById } from "@lib/db-marketing"
import { Router } from "express"
import type { Router as ExpressRouter } from "express"
import { parsePositiveInteger, sendError, toBodyObject } from "@/lib/http"

export const createSessionRouter = (): ExpressRouter => {
  const router = Router()

  router.get("/", async (request, response) => {
    try {
      const userId = parsePositiveInteger(request.query.userId, "userId")
      const user = await getUserById(userId)

      if (!user) {
        return response.status(404).json({ error: "User not found." })
      }

      return response.json({ user })
    } catch (error) {
      return sendError(response, error)
    }
  })

  router.post("/", async (request, response) => {
    try {
      const body = toBodyObject(request.body)
      const identifier =
        typeof body.identifier === "string" ? body.identifier.trim() : ""
      const user = await findUserByIdentifier(identifier)

      if (!user) {
        return response.status(404).json({
          error:
            "No matching user was found. Enter an existing username, email, or phone number.",
        })
      }

      return response.json({ user })
    } catch (error) {
      return sendError(response, error)
    }
  })

  return router
}
