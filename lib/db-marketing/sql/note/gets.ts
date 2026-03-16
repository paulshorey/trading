import type { UserNoteV1Row } from "../../generated/typescript/db-types";
import { getDb } from "../../lib/db/postgres";
import { mapNote, noteColumns, noteSelect } from "./shared";
import type {
  NoteEmbeddingBackfillRow,
  SemanticSearchResult,
} from "./types";

interface SemanticSearchRow extends UserNoteV1Row {
  semantic_similarity: number;
  title_similarity: number | null;
  content_similarity: number | null;
}

export const listNotesByUser = async (userId: number) => {
  const { rows } = await getDb().query<UserNoteV1Row>(
    `
      ${noteSelect}
      WHERE user_id = $1
      ORDER BY time_due ASC, id ASC
    `,
    [userId]
  );

  return rows.map(mapNote);
};

export const listNotesMissingEmbeddingsByUser = async (userId: number) => {
  const { rows } = await getDb().query<NoteEmbeddingBackfillRow>(
    `
      SELECT
        id,
        title,
        summary,
        description
      FROM public.user_note_v1
      WHERE user_id = $1
        AND (
          (
            NULLIF(btrim(title), '') IS NOT NULL
            AND title_embedding IS NULL
          )
          OR (
            NULLIF(
              btrim(
                concat_ws(
                  ' ',
                  coalesce(title, ''),
                  coalesce(summary, ''),
                  coalesce(description, '')
                )
              ),
              ''
            ) IS NOT NULL
            AND content_embedding IS NULL
          )
        )
      ORDER BY id ASC
    `,
    [userId]
  );

  return rows;
};

export const searchNotesByEmbedding = async (
  userId: number,
  queryEmbedding: string,
  limit: number,
  candidateLimit = Math.max(limit * 4, 12)
) => {
  const { rows } = await getDb().query<SemanticSearchRow>(
    `
      WITH ranked_candidates AS (
        SELECT
          ${noteColumns},
          CASE
            WHEN title_embedding IS NULL THEN NULL
            ELSE 1 - (title_embedding <=> $2::vector)
          END AS title_similarity,
          CASE
            WHEN content_embedding IS NULL THEN NULL
            ELSE 1 - (content_embedding <=> $2::vector)
          END AS content_similarity
        FROM public.user_note_v1
        WHERE user_id = $1
          AND content_embedding IS NOT NULL
        ORDER BY content_embedding <=> $2::vector
        LIMIT $4
      )
      SELECT
        *,
        CASE
          WHEN title_similarity IS NULL THEN content_similarity
          ELSE (content_similarity * 0.8) + (title_similarity * 0.2)
        END AS semantic_similarity
      FROM ranked_candidates
      ORDER BY semantic_similarity DESC, time_modified DESC
      LIMIT $3
    `,
    [userId, queryEmbedding, limit, candidateLimit]
  );

  return rows.map<SemanticSearchResult>((row) => ({
    note: mapNote(row),
    similarity: row.semantic_similarity,
    titleSimilarity: row.title_similarity,
    contentSimilarity: row.content_similarity,
  }));
};
