import { NextRequest, NextResponse } from "next/server"
import {
  findNotesAppSession,
  getNotesAppSession,
  NOTES_APP_LOGIN_NOT_FOUND_ERROR,
  NOTES_APP_USER_NOT_FOUND_ERROR,
  parseSessionLookupRequest,
  parseSessionRequest,
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
    const result = await getNotesAppSession(
      parseSessionRequest(request.nextUrl.searchParams.get("userId")),
    )

    if (!result) {
      return NextResponse.json({ error: NOTES_APP_USER_NOT_FOUND_ERROR }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const result = await findNotesAppSession(
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
}
