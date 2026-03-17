import cors from "cors"
import express from "express"
import type { Express } from "express"
import { notesAppService, type NotesAppService } from "@lib/db-marketing/services/notes-app"
import { createNotesRouter } from "@/routes/notes"
import { createSearchRouter } from "@/routes/search"
import { createSessionRouter } from "@/routes/session"

export const createApp = (
  service: NotesAppService = notesAppService,
): Express => {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "256kb" }))

  app.get("/health", (_request, response) => {
    response.json({ ok: true })
  })

  app.use("/api/session", createSessionRouter(service))
  app.use("/api/notes", createNotesRouter(service))
  app.use("/api/notes/search", createSearchRouter(service))

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const err = error as { type?: string; message?: string }

      if (err?.type === "request.aborted") {
        return response.status(400).json({ error: "Request was aborted by client." })
      }

      if (err?.type === "entity.too.large") {
        return response.status(413).json({ error: "Request body is too large." })
      }

      if (err?.type === "entity.parse.failed") {
        return response.status(400).json({ error: "Invalid request body." })
      }

      console.error("Unhandled express error:", error)
      return response.status(500).json({ error: "Internal server error." })
    },
  )

  return app
}
