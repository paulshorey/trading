export interface NoteRecord {
  id: number;
  userId: number;
  title: string | null;
  summary: string | null;
  description: string | null;
  timeDue: string;
  timeRemind: string;
  timeCreated: string;
  timeModified: string;
}

export interface NoteEmbeddingWriteInput {
  titleEmbedding: string | null;
  contentEmbedding: string | null;
  embeddingModel: string | null;
}

export interface SemanticSearchResult {
  note: NoteRecord;
  similarity: number;
  titleSimilarity: number | null;
  contentSimilarity: number | null;
}

export interface NoteInput {
  title: string;
  summary: string;
  description: string;
  timeDue: string;
  timeRemind: string;
}

export interface NoteEmbeddingBackfillRow {
  id: number;
  title: string | null;
  summary: string | null;
  description: string | null;
}
