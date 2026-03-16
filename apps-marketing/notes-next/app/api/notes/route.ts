import { NextRequest, NextResponse } from "next/server"
import {
  createNoteForUser,
  deleteNoteForUser,
  listNotesByUser,
  parseNoteInput,
  updateNoteForUser,
} from "@lib/db-marketing"
import {
  EmbeddingConfigurationError,
  EmbeddingRequestError,
  createNoteEmbeddingInput,
} from "../../../lib/note-embeddings"

export const runtime = "nodejs"

const getPositiveInteger = (value: unknown, fieldName: string) => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10)

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }

  throw new Error(`${fieldName} must be a positive integer.`)
}

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

const getErrorStatus = (error: unknown) => {
  if (error instanceof EmbeddingConfigurationError) {
    return 500
  }

  if (error instanceof EmbeddingRequestError) {
    return error.status >= 400 && error.status < 500 ? 502 : error.status
  }

  return 400
}

export async function GET(request: NextRequest) {
  try {
    const userId = getPositiveInteger(
      request.nextUrl.searchParams.get("userId"),
      "userId",
    )
    const notes = await listNotesByUser(userId)

    return NextResponse.json({ notes })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request)
    const userId = getPositiveInteger(body.userId, "userId")
    const noteInput = parseNoteInput(body.note)
    const embeddings = await createNoteEmbeddingInput(noteInput)
    const note = await createNoteForUser(userId, noteInput, embeddings)

    return NextResponse.json({ note }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error, getErrorStatus(error))
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJsonObject(request)
    const userId = getPositiveInteger(body.userId, "userId")
    const noteId = getPositiveInteger(body.noteId, "noteId")
    const noteInput = parseNoteInput(body.note)
    const embeddings = await createNoteEmbeddingInput(noteInput)
    const note = await updateNoteForUser(noteId, userId, noteInput, embeddings)

    if (!note) {
      return NextResponse.json({ error: "Note not found." }, { status: 404 })
    }

    return NextResponse.json({ note })
  } catch (error) {
    return toErrorResponse(error, getErrorStatus(error))
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJsonObject(request)
    const userId = getPositiveInteger(body.userId, "userId")
    const noteId = getPositiveInteger(body.noteId, "noteId")
    const deleted = await deleteNoteForUser(noteId, userId)

    if (!deleted) {
      return NextResponse.json({ error: "Note not found." }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
