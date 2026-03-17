import type { AddressInfo } from "node:net"
import type { NotesAppService } from "@lib/db-marketing/services/notes-app"
import {
  registerNotesApiAdapterSuite,
  type NotesApiAdapter,
} from "@lib/db-marketing/testing/notes-api-adapter-suite"
import { createApp } from "../server/src/app"

const createExpressAdapter = async (
  service: NotesAppService,
): Promise<NotesApiAdapter> => {
  const app = createApp(service)
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const nextServer = app.listen(0, "127.0.0.1", () => {
      resolve(nextServer)
    })
  })
  const address = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    },
    request: async ({ body, headers, method, path }) => {
      const response = await fetch(`${origin}${path}`, {
        body: body == null ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        method,
      })
      const text = await response.text()

      return {
        body: text === "" ? null : JSON.parse(text),
        status: response.status,
      }
    },
  }
}

registerNotesApiAdapterSuite("notes-android", createExpressAdapter)
