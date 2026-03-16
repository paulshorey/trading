import type { Response } from "express"

export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected server error."

export const parsePositiveInteger = (
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

export const sendError = (response: Response, error: unknown, status = 400) =>
  response.status(status).json({ error: getErrorMessage(error) })

export const toBodyObject = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.")
  }

  return value as Record<string, unknown>
}
