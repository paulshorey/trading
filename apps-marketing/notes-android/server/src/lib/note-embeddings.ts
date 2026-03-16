import type { NoteEmbeddingWriteInput } from "@lib/db-marketing"

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
const OPENAI_EMBEDDING_DIMENSIONS = 1536

type EmbedSource = {
  title: string | null
  summary: string | null
  description: string | null
}

interface OpenAiEmbeddingItem {
  index: number
  embedding: number[]
}

interface OpenAiEmbeddingsResponse {
  data?: OpenAiEmbeddingItem[]
  error?: {
    message?: string
  }
}

interface NoteEmbeddingJob {
  noteId: number
  input: NoteEmbeddingWriteInput
}

export class EmbeddingConfigurationError extends Error {}

export class EmbeddingRequestError extends Error {
  status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = "EmbeddingRequestError"
    this.status = status
  }
}

const normalizeText = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return ""
  }

  return value.replace(/\r\n/g, "\n").trim()
}

const buildTitleText = (note: EmbedSource) => {
  const title = normalizeText(note.title)
  return title === "" ? null : title
}

const buildContentText = (note: EmbedSource) => {
  const title = normalizeText(note.title)
  const summary = normalizeText(note.summary)
  const description = normalizeText(note.description)
  const sections = [
    title !== "" ? `Title: ${title}` : null,
    summary !== "" ? `Summary: ${summary}` : null,
    description !== "" ? `Description:\n${description}` : null,
  ].filter((value): value is string => value !== null)

  return sections.length === 0 ? null : sections.join("\n\n")
}

const toVectorLiteral = (embedding: number[]) => JSON.stringify(embedding)

const assertEmbeddingDimensions = (embedding: number[]) => {
  if (embedding.length !== OPENAI_EMBEDDING_DIMENSIONS) {
    throw new EmbeddingRequestError(
      `OpenAI returned ${embedding.length} dimensions, expected ${OPENAI_EMBEDDING_DIMENSIONS}.`,
    )
  }
}

const getApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY?.trim()

  if (!apiKey) {
    throw new EmbeddingConfigurationError("OPENAI_API_KEY environment variable not set.")
  }

  return apiKey
}

const fetchEmbeddings = async (inputs: string[]) => {
  if (inputs.length === 0) {
    return []
  }

  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: inputs,
      encoding_format: "float",
      dimensions: OPENAI_EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  const payload = (await response.json().catch(() => null)) as OpenAiEmbeddingsResponse | null

  if (!response.ok) {
    throw new EmbeddingRequestError(
      payload?.error?.message ?? "OpenAI embeddings request failed.",
      response.status,
    )
  }

  if (!payload?.data || payload.data.length !== inputs.length) {
    throw new EmbeddingRequestError("OpenAI returned an unexpected embeddings payload.")
  }

  const embeddings = [...payload.data]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding)

  embeddings.forEach(assertEmbeddingDimensions)

  return embeddings
}

const toInputTexts = (note: EmbedSource) => {
  const titleText = buildTitleText(note)
  const contentText = buildContentText(note)

  return {
    titleText,
    contentText,
  }
}

export const createNoteEmbeddingInput = async (
  note: EmbedSource,
): Promise<NoteEmbeddingWriteInput> => {
  const { titleText, contentText } = toInputTexts(note)
  const pendingInputs = [titleText, contentText].filter(
    (value): value is string => value !== null,
  )

  if (pendingInputs.length === 0) {
    return {
      titleEmbedding: null,
      contentEmbedding: null,
      embeddingModel: null,
    }
  }

  const embeddings = await fetchEmbeddings(pendingInputs)
  let cursor = 0

  const nextEmbedding = () => {
    const embedding = embeddings[cursor]

    if (!embedding) {
      throw new EmbeddingRequestError("OpenAI returned too few embeddings.")
    }

    cursor += 1
    return toVectorLiteral(embedding)
  }

  return {
    titleEmbedding: titleText ? nextEmbedding() : null,
    contentEmbedding: contentText ? nextEmbedding() : null,
    embeddingModel: OPENAI_EMBEDDING_MODEL,
  }
}

export const createQueryEmbedding = async (query: string) => {
  const trimmed = normalizeText(query)

  if (trimmed === "") {
    throw new Error("Search query is required.")
  }

  const embeddings = await fetchEmbeddings([trimmed])
  const embedding = embeddings[0]

  if (!embedding) {
    throw new EmbeddingRequestError("OpenAI returned no embedding for the search query.")
  }

  return toVectorLiteral(embedding)
}

export const createBackfillEmbeddingInputs = async (
  notes: Array<EmbedSource & { id: number }>,
): Promise<NoteEmbeddingJob[]> => {
  const requests: string[] = []
  const mappings: Array<{
    noteId: number
    field: "titleEmbedding" | "contentEmbedding"
  }> = []

  for (const note of notes) {
    const { titleText, contentText } = toInputTexts(note)

    if (titleText) {
      requests.push(titleText)
      mappings.push({ noteId: note.id, field: "titleEmbedding" })
    }

    if (contentText) {
      requests.push(contentText)
      mappings.push({ noteId: note.id, field: "contentEmbedding" })
    }
  }

  if (requests.length === 0) {
    return notes.map((note) => ({
      noteId: note.id,
      input: {
        titleEmbedding: null,
        contentEmbedding: null,
        embeddingModel: null,
      },
    }))
  }

  const embeddings = await fetchEmbeddings(requests)
  const jobs = new Map<number, NoteEmbeddingWriteInput>()

  for (const note of notes) {
    jobs.set(note.id, {
      titleEmbedding: null,
      contentEmbedding: null,
      embeddingModel: null,
    })
  }

  mappings.forEach((mapping, index) => {
    const embedding = embeddings[index]

    if (!embedding) {
      throw new EmbeddingRequestError("OpenAI returned too few embeddings during backfill.")
    }

    const job = jobs.get(mapping.noteId)

    if (!job) {
      return
    }

    job[mapping.field] = toVectorLiteral(embedding)
    job.embeddingModel = OPENAI_EMBEDDING_MODEL
  })

  return notes.map((note) => ({
    noteId: note.id,
    input: jobs.get(note.id) ?? {
      titleEmbedding: null,
      contentEmbedding: null,
      embeddingModel: null,
    },
  }))
}
