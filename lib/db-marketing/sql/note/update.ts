import type { UserNoteV1Row } from "../../generated/typescript/db-types";
import { getDb } from "../../lib/db/postgres";
import { mapNote, toNullableText } from "./shared";
import type { NoteEmbeddingWriteInput, NoteInput } from "./types";

export const updateNoteForUser = async (
  noteId: number,
  userId: number,
  note: NoteInput,
  embeddings: NoteEmbeddingWriteInput
) => {
  const embeddingUpdatedAt = embeddings.embeddingModel
    ? new Date().toISOString()
    : null;
  const { rows } = await getDb().query<UserNoteV1Row>(
    `
      UPDATE public.user_note_v1
      SET
        title = $3,
        summary = $4,
        description = $5,
        time_due = $6,
        time_remind = $7,
        title_embedding = $8::vector,
        content_embedding = $9::vector,
        embedding_model = $10,
        embedding_updated_at = $11,
        time_modified = CURRENT_TIMESTAMP
      WHERE id = $1
        AND user_id = $2
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
      noteId,
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

  return rows[0] ? mapNote(rows[0]) : null;
};

export const updateNoteEmbeddingsForUser = async (
  noteId: number,
  userId: number,
  embeddings: NoteEmbeddingWriteInput
) => {
  const embeddingUpdatedAt = embeddings.embeddingModel
    ? new Date().toISOString()
    : null;

  await getDb().query(
    `
      UPDATE public.user_note_v1
      SET
        title_embedding = $3::vector,
        content_embedding = $4::vector,
        embedding_model = $5,
        embedding_updated_at = $6
      WHERE id = $1
        AND user_id = $2
    `,
    [
      noteId,
      userId,
      embeddings.titleEmbedding,
      embeddings.contentEmbedding,
      embeddings.embeddingModel,
      embeddingUpdatedAt,
    ]
  );
};
