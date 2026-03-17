import { NextRequest, NextResponse } from "next/server"
import {
  createNoteForNotesApp,
  deleteNoteForNotesApp,
  getNotesAppErrorStatus,
  listNotesForNotesApp,
  NOTES_APP_NOTE_NOT_FOUND_ERROR,
  parseCreateNoteRequest,
  parseDeleteNoteRequest,
  parseNotesRequest,
  parseUpdateNoteRequest,
  updateNoteForNotesApp,
} from "@lib/db-marketing/services/notes-app"

export const runtime = "nodejs"

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

export async function GET(request: NextRequest) {
  try {
    const result = await listNotesForNotesApp(
      parseNotesRequest(request.nextUrl.searchParams.get("userId")),
    )
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const result = await createNoteForNotesApp(
      parseCreateNoteRequest(await readJsonObject(request)),
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return toErrorResponse(error, getNotesAppErrorStatus(error))
  }
}

export async function PATCH(request: Request) {
  try {
    const result = await updateNoteForNotesApp(
      parseUpdateNoteRequest(await readJsonObject(request)),
    )

    if (!result) {
      return NextResponse.json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error, getNotesAppErrorStatus(error))
  }
}

export async function DELETE(request: Request) {
  try {
    const result = await deleteNoteForNotesApp(
      parseDeleteNoteRequest(await readJsonObject(request)),
    )

    if (!result) {
      return NextResponse.json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}
