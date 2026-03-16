import type { UserNoteV1Row } from "../../generated/typescript/db-types";
import type { NoteRecord } from "./types";

export const noteColumns = `
  id,
  user_id,
  title,
  summary,
  description,
  time_due,
  time_remind,
  time_created,
  time_modified
`;

export const noteSelect = `
  SELECT
    ${noteColumns}
  FROM public.user_note_v1
`;

export const toNullableText = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export const mapNote = (row: UserNoteV1Row): NoteRecord => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  summary: row.summary,
  description: row.description,
  timeDue: row.time_due.toISOString(),
  timeRemind: row.time_remind.toISOString(),
  timeCreated: row.time_created.toISOString(),
  timeModified: row.time_modified.toISOString(),
});
