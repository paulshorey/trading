export { getDb } from "./lib/db/postgres";

export {
  createNoteForUser,
  deleteNoteForUser,
  listNotesByUser,
  listNotesMissingEmbeddingsByUser,
  parseNoteInput,
  searchNotesByEmbedding,
  updateNoteEmbeddingsForUser,
  updateNoteForUser,
} from "./sql/note";
export { findUserByIdentifier, getUserById } from "./sql/user";

export type {
  PostgresDbSchema,
  UserNoteV1Row,
  UserV1Row,
} from "./generated/typescript/db-types";
export type {
  CreateNoteRequest,
  DeleteNoteRequest,
  DeleteResponse,
  ErrorResponse,
  NoteResponse,
  NotesRequest,
  NotesResponse,
  SearchRequest,
  SearchResponse,
  SessionLookupRequest,
  SessionRequest,
  SessionResponse,
  UpdateNoteRequest,
} from "./contracts/notes-app";
export type {
  NoteEmbeddingBackfillRow,
  NoteEmbeddingWriteInput,
  NoteInput,
  NoteRecord,
  SemanticSearchResult,
} from "./sql/note";
export type { UserSummary } from "./sql/user";
