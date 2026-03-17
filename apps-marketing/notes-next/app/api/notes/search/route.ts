import { NextResponse } from "next/server"
import {
  getNotesAppErrorStatus,
  parseSearchRequest,
  searchNotesForNotesApp,
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

const toErrorResponse = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Unexpected server error." },
    { status: getNotesAppErrorStatus(error) },
  )

export async function POST(request: Request) {
  try {
    const result = await searchNotesForNotesApp(
      parseSearchRequest(await readJsonObject(request)),
    )
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}
