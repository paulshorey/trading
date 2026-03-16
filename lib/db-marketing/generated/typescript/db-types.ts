// AUTO-GENERATED FILE. DO NOT EDIT.
// Run: pnpm --filter @lib/db-marketing db:types:generate

export interface UserNoteV1Row {
  "id": number;
  "user_id": number;
  "title": string | null;
  "summary": string | null;
  "description": string | null;
  "time_due": Date;
  "time_remind": Date;
  "time_created": Date;
  "time_modified": Date;
  "title_embedding": string | null;
  "content_embedding": string | null;
  "embedding_model": string | null;
  "embedding_updated_at": Date | null;
}

export interface UserV1Row {
  "id": number;
  "username": string;
  "email": string | null;
  "phone": string | null;
  "time_created": Date;
  "time_modified": Date;
}

export interface PostgresDbSchema {
  "user_note_v1": UserNoteV1Row;
  "user_v1": UserV1Row;
}
