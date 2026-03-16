CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.user_note_v1
  ADD COLUMN title_embedding vector(1536),
  ADD COLUMN content_embedding vector(1536),
  ADD COLUMN embedding_model text,
  ADD COLUMN embedding_updated_at timestamp with time zone;

CREATE INDEX user_note_v1_title_embedding_hnsw_idx
  ON public.user_note_v1
  USING hnsw (title_embedding vector_cosine_ops);

CREATE INDEX user_note_v1_content_embedding_hnsw_idx
  ON public.user_note_v1
  USING hnsw (content_embedding vector_cosine_ops);
