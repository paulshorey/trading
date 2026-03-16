import { NextResponse } from "next/server"
import {
  listNotesMissingEmbeddingsByUser,
  searchNotesByEmbedding,
  updateNoteEmbeddingsForUser,
} from "@lib/db-marketing"
import {
  EmbeddingConfigurationError,
  EmbeddingRequestError,
  createBackfillEmbeddingInputs,
  createQueryEmbedding,
} from "../../../../lib/note-embeddings"

export const runtime = "nodejs"

const getPositiveInteger = (
  value: unknown,
  fieldName: string,
  { min = 1, max }: { min?: number; max?: number } = {},
) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= min && (typeof max !== "number" || value <= max)) {
      return value
    }
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10)

    if (
      Number.isInteger(parsed) &&
      parsed >= min &&
      (typeof max !== "number" || parsed <= max)
    ) {
      return parsed
    }
  }

  const maxText = typeof max === "number" ? ` and at most ${max}` : ""
  throw new Error(`${fieldName} must be an integer of at least ${min}${maxText}.`)
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

const getErrorStatus = (error: unknown) => {
  if (error instanceof EmbeddingConfigurationError) {
    return 500
  }

  if (error instanceof EmbeddingRequestError) {
    return error.status >= 400 && error.status < 500 ? 502 : error.status
  }

  return 400
}

const toErrorResponse = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Unexpected server error." },
    { status: getErrorStatus(error) },
  )

const syncMissingEmbeddingsForUser = async (userId: number) => {
  const notes = await listNotesMissingEmbeddingsByUser(userId)

  if (notes.length === 0) {
    return
  }

  const jobs = await createBackfillEmbeddingInputs(notes)

  for (const job of jobs) {
    await updateNoteEmbeddingsForUser(job.noteId, userId, job.input)
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request)
    const userId = getPositiveInteger(body.userId, "userId")
    const query = typeof body.query === "string" ? body.query.trim() : ""
    const limit = getPositiveInteger(body.limit ?? 12, "limit", { min: 1, max: 25 })

    if (query === "") {
      throw new Error("Search query is required.")
    }

    await syncMissingEmbeddingsForUser(userId)

    const queryEmbedding = await createQueryEmbedding(query)
    const results = await searchNotesByEmbedding(userId, queryEmbedding, limit)

    return NextResponse.json({ results })
  } catch (error) {
    return toErrorResponse(error)
  }
}
