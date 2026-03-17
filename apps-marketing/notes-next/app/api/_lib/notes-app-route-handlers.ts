import { NextRequest, NextResponse } from "next/server"
import {
  NOTES_APP_LOGIN_NOT_FOUND_ERROR,
  NOTES_APP_NOTE_NOT_FOUND_ERROR,
  NOTES_APP_USER_NOT_FOUND_ERROR,
  notesAppService,
  parseCreateNoteRequest,
  parseDeleteNoteRequest,
  parseNotesRequest,
  parseSearchRequest,
  parseSessionLookupRequest,
  parseSessionRequest,
  parseUpdateNoteRequest,
  type NotesAppService,
} from "@lib/db-marketing/services/notes-app"

const readJsonObject = async (request: Request) => {
  try {
    const body = await request.json()

    if (typeof body !== "object" || body === null) {
      throw new Error("Request body must be a JSON object.")
    }

    return body as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }

    throw new Error("Request body must be valid JSON.")
  }
}

const toErrorResponse = (error: unknown, status = 400) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Unexpected server error." },
    { status },
  )

export const createSessionRouteHandlers = (service: NotesAppService = notesAppService) => ({
  GET: async (request: NextRequest) => {
    try {
      const result = await service.getNotesAppSession(
        parseSessionRequest(request.nextUrl.searchParams.get("userId")),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_USER_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  POST: async (request: Request) => {
    try {
      const result = await service.findNotesAppSession(
        parseSessionLookupRequest(await readJsonObject(request)),
      )

      if (!result) {
        return NextResponse.json(
          {
            error: NOTES_APP_LOGIN_NOT_FOUND_ERROR,
          },
          { status: 404 },
        )
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createNotesRouteHandlers = (service: NotesAppService = notesAppService) => ({
  GET: async (request: NextRequest) => {
    try {
      const result = await service.listNotesForNotesApp(
        parseNotesRequest(request.nextUrl.searchParams.get("userId")),
      )
      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  POST: async (request: Request) => {
    try {
      const result = await service.createNoteForNotesApp(
        parseCreateNoteRequest(await readJsonObject(request)),
      )
      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const result = await service.updateNoteForNotesApp(
        parseUpdateNoteRequest(await readJsonObject(request)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
  DELETE: async (request: Request) => {
    try {
      const result = await service.deleteNoteForNotesApp(
        parseDeleteNoteRequest(await readJsonObject(request)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createSearchRouteHandlers = (service: NotesAppService = notesAppService) => ({
  POST: async (request: Request) => {
    try {
      const result = await service.searchNotesForNotesApp(
        parseSearchRequest(await readJsonObject(request)),
      )
      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
})
