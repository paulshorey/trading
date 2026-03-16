import type { UserNoteV1Row } from "../../generated/typescript/db-types";
import { getDb } from "../../lib/db/postgres";
import { mapNote, toNullableText } from "./shared";
import type { NoteEmbeddingWriteInput, NoteInput } from "./types";

export const createNoteForUser = async (
  userId: number,
  note: NoteInput,
  embeddings: NoteEmbeddingWriteInput
) => {
  const embeddingUpdatedAt = embeddings.embeddingModel
    ? new Date().toISOString()
    : null;
  const { rows } = await getDb().query<UserNoteV1Row>(
    `
      INSERT INTO public.user_note_v1 (
        user_id,
        title,
        summary,
        description,
        time_due,
        time_remind,
        title_embedding,
        content_embedding,
        embedding_model,
        embedding_updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8::vector, $9, $10)
      RETURNING
        id,
        user_id,
        title,
        summary,
        description,
        time_due,
        time_remind,
        time_created,
        time_modified
    `,
    [
      userId,
      toNullableText(note.title),
      toNullableText(note.summary),
      toNullableText(note.description),
      note.timeDue,
      note.timeRemind,
      embeddings.titleEmbedding,
      embeddings.contentEmbedding,
      embeddings.embeddingModel,
      embeddingUpdatedAt,
    ]
  );

  if (!rows[0]) {
    throw new Error("Failed to create note.");
  }

  return mapNote(rows[0]);
};
