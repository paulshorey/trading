import type { NoteInput, NoteRecord, SemanticSearchResult } from "../sql/note";
import type { UserSummary } from "../sql/user";

export interface SessionLookupRequest {
  identifier: string;
}

export interface SessionRequest {
  userId: number;
}

export interface NotesRequest {
  userId: number;
}

export interface CreateNoteRequest {
  userId: number;
  note: NoteInput;
}

export interface UpdateNoteRequest {
  userId: number;
  noteId: number;
  note: NoteInput;
}

export interface DeleteNoteRequest {
  userId: number;
  noteId: number;
}

export interface SearchRequest {
  userId: number;
  query: string;
  limit: number;
}

export interface SessionResponse {
  user: UserSummary;
}

export interface NotesResponse {
  notes: NoteRecord[];
}

export interface NoteResponse {
  note: NoteRecord;
}

export interface SearchResponse {
  results: SemanticSearchResult[];
}

export interface DeleteResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}
