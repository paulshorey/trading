import "dotenv/config"

import cors from "cors"
import express from "express"
import type { Express } from "express"
import { getDb } from "@lib/db-marketing"
import { createNotesRouter } from "@/routes/notes"
import { createSearchRouter } from "@/routes/search"
import { createSessionRouter } from "@/routes/session"

export const createApp = (): Express => {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "256kb" }))

  app.get("/health", (_request, response) => {
    response.json({ ok: true })
  })

  app.use("/api/session", createSessionRouter())
  app.use("/api/notes", createNotesRouter())
  app.use("/api/notes/search", createSearchRouter())

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

if (process.env.NODE_ENV !== "test") {
  const app = createApp()
  const port = Number(process.env.PORT) || 8787
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Notes Android API server running on port ${port}`)
  })

  let shuttingDown = false

  const shutdown = async (reason: string, exitCode: number) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    console.error(`Shutting down Notes Android API server (${reason})`)

    const forceCloseTimer = setTimeout(() => {
      console.error("Forced shutdown timeout reached")
      process.exit(exitCode)
    }, 10_000)
    forceCloseTimer.unref()

    server.close(async () => {
      try {
        await getDb().end()
      } catch (error) {
        console.error("Error closing Postgres pool during shutdown:", error)
      } finally {
        clearTimeout(forceCloseTimer)
        process.exit(exitCode)
      }
    })
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM", 0)
  })
  process.on("SIGINT", () => {
    void shutdown("SIGINT", 0)
  })
  process.on("uncaughtException", (error) => {
    console.error("uncaughtException:", error)
    void shutdown("uncaughtException", 1)
  })
  process.on("unhandledRejection", (reason) => {
    console.error("unhandledRejection:", reason)
  })
}
