import type {
  CreateNoteRequest,
  DeleteNoteRequest,
  DeleteResponse,
  NotesRequest,
  NotesResponse,
  NoteResponse,
  SearchRequest,
  SearchResponse,
  SessionLookupRequest,
  SessionRequest,
  SessionResponse,
  UpdateNoteRequest,
} from "../contracts/notes-app";
import {
  createNoteForUser,
  deleteNoteForUser,
  listNotesByUser,
  listNotesMissingEmbeddingsByUser,
  parseNoteInput,
  searchNotesByEmbedding,
  updateNoteEmbeddingsForUser,
  updateNoteForUser,
} from "../sql/note";
import { findUserByIdentifier, getUserById } from "../sql/user";
import {
  createBackfillEmbeddingInputs,
  createNoteEmbeddingInput,
  createQueryEmbedding,
  EmbeddingConfigurationError,
  EmbeddingRequestError,
} from "./notes-embeddings";

export const NOTES_APP_NOTE_NOT_FOUND_ERROR = "Note not found.";
export const NOTES_APP_USER_NOT_FOUND_ERROR = "User not found.";
export const NOTES_APP_LOGIN_NOT_FOUND_ERROR =
  "No matching user was found. Enter an existing username, email, or phone number.";

const toRequestObject = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
};

export const parsePositiveInteger = (
  value: unknown,
  fieldName: string,
  { min = 1, max }: { min?: number; max?: number } = {}
) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= min && (typeof max !== "number" || value <= max)) {
      return value;
    }
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);

    if (
      Number.isInteger(parsed) &&
      parsed >= min &&
      (typeof max !== "number" || parsed <= max)
    ) {
      return parsed;
    }
  }

  const maxText = typeof max === "number" ? ` and at most ${max}` : "";
  throw new Error(`${fieldName} must be an integer of at least ${min}${maxText}.`);
};

export const getNotesAppErrorStatus = (error: unknown) => {
  if (error instanceof EmbeddingConfigurationError) {
    return 500;
  }

  if (error instanceof EmbeddingRequestError) {
    return error.status >= 400 && error.status < 500 ? 502 : error.status;
  }

  return 400;
};

export const parseSessionRequest = (userId: unknown): SessionRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
});

export const parseNotesRequest = (userId: unknown): NotesRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
});

export const parseSessionLookupRequest = (value: unknown): SessionLookupRequest => {
  const body = toRequestObject(value);

  return {
    identifier: typeof body.identifier === "string" ? body.identifier.trim() : "",
  };
};

export const parseCreateNoteRequest = (value: unknown): CreateNoteRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    note: parseNoteInput(body.note),
  };
};

export const parseUpdateNoteRequest = (value: unknown): UpdateNoteRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    noteId: parsePositiveInteger(body.noteId, "noteId"),
    note: parseNoteInput(body.note),
  };
};

export const parseDeleteNoteRequest = (value: unknown): DeleteNoteRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    noteId: parsePositiveInteger(body.noteId, "noteId"),
  };
};

export const parseSearchRequest = (value: unknown): SearchRequest => {
  const body = toRequestObject(value);
  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (query === "") {
    throw new Error("Search query is required.");
  }

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    query,
    limit: parsePositiveInteger(body.limit ?? 12, "limit", {
      min: 1,
      max: 25,
    }),
  };
};

export const getNotesAppSession = async (
  request: SessionRequest
): Promise<SessionResponse | null> => {
  const user = await getUserById(request.userId);

  return user ? { user } : null;
};

export const findNotesAppSession = async (
  request: SessionLookupRequest
): Promise<SessionResponse | null> => {
  const user = await findUserByIdentifier(request.identifier);

  return user ? { user } : null;
};

export const listNotesForNotesApp = async (
  request: NotesRequest
): Promise<NotesResponse> => ({
  notes: await listNotesByUser(request.userId),
});

export const createNoteForNotesApp = async (
  request: CreateNoteRequest
): Promise<NoteResponse> => {
  const embeddings = await createNoteEmbeddingInput(request.note);
  const note = await createNoteForUser(request.userId, request.note, embeddings);

  return { note };
};

export const updateNoteForNotesApp = async (
  request: UpdateNoteRequest
): Promise<NoteResponse | null> => {
  const embeddings = await createNoteEmbeddingInput(request.note);
  const note = await updateNoteForUser(
    request.noteId,
    request.userId,
    request.note,
    embeddings
  );

  return note ? { note } : null;
};

export const deleteNoteForNotesApp = async (
  request: DeleteNoteRequest
): Promise<DeleteResponse | null> => {
  const deleted = await deleteNoteForUser(request.noteId, request.userId);

  return deleted ? { ok: true } : null;
};

const syncMissingEmbeddingsForUser = async (userId: number) => {
  const notes = await listNotesMissingEmbeddingsByUser(userId);

  if (notes.length === 0) {
    return;
  }

  const jobs = await createBackfillEmbeddingInputs(notes);

  for (const job of jobs) {
    await updateNoteEmbeddingsForUser(job.noteId, userId, job.input);
  }
};

export const searchNotesForNotesApp = async (
  request: SearchRequest
): Promise<SearchResponse> => {
  await syncMissingEmbeddingsForUser(request.userId);

  const queryEmbedding = await createQueryEmbedding(request.query);
  const results = await searchNotesByEmbedding(
    request.userId,
    queryEmbedding,
    request.limit
  );

  return { results };
};

export const notesAppService = {
  getNotesAppErrorStatus,
  getNotesAppSession,
  findNotesAppSession,
  listNotesForNotesApp,
  createNoteForNotesApp,
  updateNoteForNotesApp,
  deleteNoteForNotesApp,
  searchNotesForNotesApp,
};

export type NotesAppService = typeof notesAppService;

export {
  EmbeddingConfigurationError,
  EmbeddingRequestError,
} from "./notes-embeddings";
