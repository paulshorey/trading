import { NextRequest, NextResponse } from "next/server"
import { findUserByIdentifier, getUserById } from "@lib/db-marketing"

export const runtime = "nodejs"

const getPositiveInteger = (value: string | null, fieldName: string) => {
  if (!value) {
    throw new Error(`${fieldName} is required.`)
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`)
  }

  return parsed
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

export async function GET(request: NextRequest) {
  try {
    const userId = getPositiveInteger(request.nextUrl.searchParams.get("userId"), "userId")
    const user = await getUserById(userId)

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 })
    }

    return NextResponse.json({ user })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request)
    const identifier =
      typeof body.identifier === "string" ? body.identifier.trim() : ""

    const user = await findUserByIdentifier(identifier)

    if (!user) {
      return NextResponse.json(
        {
          error:
            "No matching user was found. Enter an existing username, email, or phone number.",
        },
        { status: 404 },
      )
    }

    return NextResponse.json({ user })
  } catch (error) {
    return toErrorResponse(error)
  }
}
