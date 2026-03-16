import { getDb } from "../../lib/db/postgres";

export const deleteNoteForUser = async (noteId: number, userId: number) => {
  const result = await getDb().query(
    `
      DELETE FROM public.user_note_v1
      WHERE id = $1
        AND user_id = $2
    `,
    [noteId, userId]
  );

  return (result.rowCount ?? 0) > 0;
};
