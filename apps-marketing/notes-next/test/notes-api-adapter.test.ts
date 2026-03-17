import { NextRequest } from "next/server"
import type { NotesAppService } from "@lib/db-marketing/services/notes-app"
import {
  registerNotesApiAdapterSuite,
  type NotesApiAdapter,
} from "@lib/db-marketing/testing/notes-api-adapter-suite"
import {
  createNotesRouteHandlers,
  createSearchRouteHandlers,
  createSessionRouteHandlers,
} from "../app/api/_lib/notes-app-route-handlers"

const readResponseBody = async (response: Response) => {
  const text = await response.text()
  return text === "" ? null : JSON.parse(text)
}

const createNextAdapter = (service: NotesAppService): NotesApiAdapter => {
  const sessionHandlers = createSessionRouteHandlers(service)
  const notesHandlers = createNotesRouteHandlers(service)
  const searchHandlers = createSearchRouteHandlers(service)

  return {
    request: async ({ body, headers, method, path }) => {
      const url = new URL(path, "http://notes.test")
      const requestInit: RequestInit = {
        body: body == null ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        method,
      }

      let response: Response

      if (url.pathname === "/api/session") {
        response =
          method === "GET"
            ? await sessionHandlers.GET(new NextRequest(url, { method }))
            : await sessionHandlers.POST(new Request(url, requestInit))
      } else if (url.pathname === "/api/notes") {
        if (method === "GET") {
          response = await notesHandlers.GET(new NextRequest(url, { method }))
        } else if (method === "POST") {
          response = await notesHandlers.POST(new Request(url, requestInit))
        } else if (method === "PATCH") {
          response = await notesHandlers.PATCH(new Request(url, requestInit))
        } else {
          response = await notesHandlers.DELETE(new Request(url, requestInit))
        }
      } else if (url.pathname === "/api/notes/search" && method === "POST") {
        response = await searchHandlers.POST(new Request(url, requestInit))
      } else {
        throw new Error(`Unhandled test route: ${method} ${url.pathname}`)
      }

      return {
        body: await readResponseBody(response),
        status: response.status,
      }
    },
  }
}

registerNotesApiAdapterSuite("notes-next", createNextAdapter)
