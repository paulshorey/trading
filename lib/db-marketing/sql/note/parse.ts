import type { NoteInput } from "./types";

const toIsoTimestamp = (value: unknown, fieldName: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required.`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  return date.toISOString();
};

export const parseNoteInput = (value: unknown): NoteInput => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Note payload is required.");
  }

  const record = value as Record<string, unknown>;

  return {
    title: typeof record.title === "string" ? record.title : "",
    summary: typeof record.summary === "string" ? record.summary : "",
    description:
      typeof record.description === "string" ? record.description : "",
    timeDue: toIsoTimestamp(record.timeDue, "Due time"),
    timeRemind: toIsoTimestamp(record.timeRemind, "Reminder time"),
  };
};
