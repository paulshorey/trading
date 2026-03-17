import "dotenv/config"

import { getDb } from "@lib/db-marketing"
import { createApp } from "@/app"

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
