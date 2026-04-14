import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { uploadJsonArtifact } from "@/lib/cloud-artifact-storage";
import { getDataPath } from "@/lib/data-root";
import type {
  MeetingQueryIntent,
  MeetingSession,
  RagChunk,
  SessionRagIndex,
  TranscriptEntry,
} from "@/lib/types";

const RAG_STORAGE_DIR = getDataPath("rag");
const STRATEGY_VERSION = "contextual-gemini-embeddings-bm25-v1";
const EMBEDDING_DIMENSION = 768;
const HYBRID_EMBEDDING_WEIGHT = 0.65;
const HYBRID_BM25_WEIGHT = 0.35;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your",
]);

type QueryRoute = {
  intent: MeetingQueryIntent;
  speaker?: string;
};

type RetrievedContext = {
  route: QueryRoute;
  primaryChunks: RagChunk[];
  supportChunks: RagChunk[];
  allChunks: RagChunk[];
};

function ensureRagDir() {
  mkdirSync(RAG_STORAGE_DIR, { recursive: true });
}

function getRagPath(sessionId: string) {
  return getDataPath("rag", `${sessionId}.json`);
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function uniqueKeywords(text: string) {
  return [...new Set(tokenize(text))].slice(0, 48);
}

function normalizeVector(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

  if (!magnitude) {
    return values;
  }

  return values.map((value) => value / magnitude);
}

function cosineSimilarity(left: number[] | undefined, right: number[] | undefined) {
  if (!left || !right || left.length !== right.length) {
    return 0;
  }

  let score = 0;

  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }

  return score;
}

function normalizeScores(values: number[]) {
  if (!values.length) {
    return [];
  }

  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);

  if (maxValue === minValue) {
    return values.map(() => (maxValue === 0 ? 0 : 1));
  }

  return values.map((value) => (value - minValue) / (maxValue - minValue));
}

function computeBm25Scores(chunks: RagChunk[], query: string) {
  const queryTokens = tokenize(query);

  if (!queryTokens.length || !chunks.length) {
    return chunks.map(() => 0);
  }

  const documents = chunks.map((chunk) => tokenize(`${chunk.meetingTitle} ${chunk.contextualText}`));
  const averageDocumentLength =
    documents.reduce((sum, document) => sum + document.length, 0) / documents.length || 1;

  return documents.map((document) => {
    const termCounts = new Map<string, number>();

    for (const term of document) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }

    return queryTokens.reduce((score, term) => {
      const frequency = termCounts.get(term) ?? 0;

      if (!frequency) {
        return score;
      }

      const documentFrequency = documents.reduce(
        (count, current) => count + (current.includes(term) ? 1 : 0),
        0,
      );

      const idf = Math.log(
        1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );

      const denominator =
        frequency +
        BM25_K1 *
          (1 - BM25_B + BM25_B * (document.length / averageDocumentLength));

      return score + (idf * frequency * (BM25_K1 + 1)) / denominator;
    }, 0);
  });
}

function inferChunkCategory(text: string): RagChunk["category"] {
  const normalized = text.toLowerCase();

  if (/decided|approved|finalized|go with|ship|launch|reject|chosen/.test(normalized)) {
    return "decision";
  }

  if (/follow up|will |send |share |prepare |review |next step|need to|owner|action/.test(normalized)) {
    return "action_item";
  }

  if (/today|then|after|before|timeline|earlier|later|first|second|next/.test(normalized)) {
    return "timeline";
  }

  return "general_discussion";
}

function buildTranscriptChunkId(sessionId: string, startIndex: number) {
  return `${sessionId}-transcript-${startIndex}`;
}

function buildTranscriptWindow(entries: TranscriptEntry[], startIndex: number, endIndex: number) {
  const previous = entries[startIndex - 1];
  const next = entries[endIndex + 1];
  return [previous, next]
    .filter(Boolean)
    .map((entry) => `${entry?.speaker}: ${entry?.text}`)
    .join(" ");
}

function buildContextualTranscriptChunks(session: MeetingSession) {
  const chunks: RagChunk[] = [];

  for (let index = 0; index < session.transcript.length; index += 2) {
    const slice = session.transcript.slice(index, index + 2);
    const text = slice.map((entry) => `${entry.speaker}: ${entry.text}`).join(" ");
    const contextWindow = buildTranscriptWindow(session.transcript, index, index + slice.length - 1);
    const category = inferChunkCategory(text);
    const chunkId = buildTranscriptChunkId(session.id, index);

    chunks.push({
      id: chunkId,
      sessionId: session.id,
      sourceType: "transcript",
      category,
      text,
      contextualText: [
        `Meeting title: ${session.title}.`,
        `Chunk type: transcript.`,
        `Category: ${category}.`,
        `Speakers: ${slice.map((entry) => entry.speaker).join(", ")}.`,
        `Start timestamp: ${slice[0]?.timestamp ?? "unknown"}.`,
        contextWindow ? `Neighboring context: ${contextWindow}` : "",
        `Transcript chunk: ${text}`,
      ]
        .filter(Boolean)
        .join(" "),
      meetingTitle: session.title,
      contextWindow,
      neighborIds: [
        buildTranscriptChunkId(session.id, index - 2),
        buildTranscriptChunkId(session.id, index + 2),
      ].filter((value) => !value.endsWith("--2")),
      speaker: slice.map((entry) => entry.speaker).join(", "),
      timestamp: slice[0]?.timestamp,
      keywords: uniqueKeywords(`${session.title} ${contextWindow} ${text}`),
    });
  }

  return chunks;
}

function buildSummaryChunks(session: MeetingSession) {
  if (!session.summary) {
    return [] as RagChunk[];
  }

  const sections = [
    {
      id: `${session.id}-summary-overview`,
      category: "general_discussion" as const,
      text: session.summary.overview,
      label: "overview",
    },
    {
      id: `${session.id}-summary-key-points`,
      category: "general_discussion" as const,
      text: session.summary.keyPoints.join(" "),
      label: "key points",
    },
    {
      id: `${session.id}-summary-action-items`,
      category: "action_item" as const,
      text: session.summary.actionItems.join(" "),
      label: "action items",
    },
    {
      id: `${session.id}-summary-decisions`,
      category: "decision" as const,
      text: session.summary.decisions.join(" "),
      label: "decisions",
    },
  ].filter((item) => item.text.trim());

  return sections.map(
    (section): RagChunk => ({
      id: section.id,
      sessionId: session.id,
      sourceType: "summary",
      category: section.category,
      text: section.text,
      contextualText: [
        `Meeting title: ${session.title}.`,
        `Chunk type: summary ${section.label}.`,
        `Category: ${section.category}.`,
        `Summary content: ${section.text}`,
      ].join(" "),
      meetingTitle: session.title,
      contextWindow: "",
      neighborIds: [],
      keywords: uniqueKeywords(`${session.title} ${section.label} ${section.text}`),
    }),
  );
}

function buildNotesChunks(session: MeetingSession) {
  if (!session.notes.trim()) {
    return [] as RagChunk[];
  }

  return [
    {
      id: `${session.id}-notes`,
      sessionId: session.id,
      sourceType: "notes" as const,
      category: "general_discussion" as const,
      text: session.notes.trim(),
      contextualText: [
        `Meeting title: ${session.title}.`,
        "Chunk type: manual notes.",
        "Category: general discussion.",
        `Notes content: ${session.notes.trim()}`,
      ].join(" "),
      meetingTitle: session.title,
      contextWindow: "",
      neighborIds: [],
      keywords: uniqueKeywords(`${session.title} ${session.notes}`),
    },
  ];
}

function buildContextualChunks(session: MeetingSession) {
  return [
    ...buildSummaryChunks(session),
    ...buildNotesChunks(session),
    ...buildContextualTranscriptChunks(session),
  ];
}

function persistRagIndex(index: SessionRagIndex) {
  ensureRagDir();
  writeFileSync(getRagPath(index.sessionId), JSON.stringify(index, null, 2), "utf8");
  void uploadJsonArtifact(`rag/${index.sessionId}.json`, index, {
    artifactType: "rag",
    sessionId: index.sessionId,
    strategyVersion: index.strategyVersion,
  }).catch(() => null);
}

export function persistSessionRag(session: MeetingSession) {
  const existing = getSessionRagIndex(session.id);
  const baseChunks = buildContextualChunks(session);
  const chunkMap = new Map(existing?.chunks.map((chunk) => [chunk.id, chunk]));

  const index: SessionRagIndex = {
    sessionId: session.id,
    updatedAt: session.updatedAt,
    strategyVersion: STRATEGY_VERSION,
    chunks: baseChunks.map(
      (chunk): RagChunk => ({
        ...chunk,
        embedding:
          chunkMap.get(chunk.id)?.contextualText === chunk.contextualText
            ? chunkMap.get(chunk.id)?.embedding
            : undefined,
      }),
    ),
  };

  persistRagIndex(index);
  return index;
}

export function getSessionRagIndex(sessionId: string) {
  try {
    return JSON.parse(readFileSync(getRagPath(sessionId), "utf8")) as SessionRagIndex;
  } catch {
    return null;
  }
}

async function embedTextWithGemini(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  title?: string,
) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
        taskType,
        title,
        outputDimensionality: EMBEDDING_DIMENSION,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini embedding request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    embedding?: { values?: number[] };
    embeddings?: Array<{ values?: number[] }>;
  };

  const values = payload.embedding?.values ?? payload.embeddings?.[0]?.values;
  return values ? normalizeVector(values) : null;
}

export async function ensureSessionRagIndex(session: MeetingSession) {
  const existing = getSessionRagIndex(session.id);
  const requiresRefresh =
    !existing ||
    existing.updatedAt !== session.updatedAt ||
    existing.strategyVersion !== STRATEGY_VERSION ||
    existing.chunks.some((chunk) => !chunk.embedding?.length);

  if (!requiresRefresh) {
    return existing;
  }

  const index = persistSessionRag(session);

  try {
    const embeddedChunks = await Promise.all(
      index.chunks.map(async (chunk) => ({
        ...chunk,
        embedding:
          chunk.embedding ??
          (await embedTextWithGemini(chunk.contextualText, "RETRIEVAL_DOCUMENT", chunk.meetingTitle)) ??
          undefined,
      })),
    );

    const enrichedIndex: SessionRagIndex = {
      ...index,
      chunks: embeddedChunks,
    };

    persistRagIndex(enrichedIndex);
    return enrichedIndex;
  } catch {
    return index;
  }
}

export function routeMeetingQuery(session: MeetingSession, query: string): QueryRoute {
  const normalized = query.toLowerCase();

  const speakerMatch = session.transcript
    .map((entry) => entry.speaker)
    .find((speaker) => normalized.includes(speaker.toLowerCase()));

  if (speakerMatch || /who said|what did .* say/.test(normalized)) {
    return { intent: "speaker", speaker: speakerMatch };
  }

  if (/decision|decide|final|finalize|approved|agreed|choose|chosen|reject/.test(normalized)) {
    return { intent: "decisions" };
  }

  if (/action|follow up|todo|next step|task|owner|assigned|deliver/.test(normalized)) {
    return { intent: "action_items" };
  }

  if (/when|timeline|earlier|later|before|after|first|then|chronolog/.test(normalized)) {
    return { intent: "timeline" };
  }

  return { intent: "general" };
}

function matchesRoute(chunk: RagChunk, route: QueryRoute) {
  switch (route.intent) {
    case "decisions":
      return chunk.category === "decision" || chunk.sourceType === "summary";
    case "action_items":
      return chunk.category === "action_item" || chunk.sourceType === "summary";
    case "speaker":
      return chunk.sourceType === "transcript";
    case "timeline":
      return chunk.sourceType === "transcript" || chunk.category === "timeline";
    default:
      return chunk.sourceType === "summary" || chunk.sourceType === "transcript" || chunk.sourceType === "notes";
  }
}

function lexicalBonus(chunk: RagChunk, query: string, route: QueryRoute) {
  const normalized = query.toLowerCase();
  let bonus = 0;

  for (const token of tokenize(query)) {
    if (chunk.keywords.includes(token)) {
      bonus += 0.03;
    }
  }

  if (route.speaker && chunk.speaker?.toLowerCase().includes(route.speaker.toLowerCase())) {
    bonus += 0.2;
  }

  if (normalized && chunk.contextualText.toLowerCase().includes(normalized)) {
    bonus += 0.08;
  }

  return bonus;
}

function queryTaskType(route: QueryRoute) {
  if (route.intent === "decisions" || route.intent === "action_items") {
    return "RETRIEVAL_QUERY" as const;
  }

  return "RETRIEVAL_QUERY" as const;
}

function fallbackScore(chunk: RagChunk, query: string, route: QueryRoute) {
  let score = lexicalBonus(chunk, query, route);

  if (matchesRoute(chunk, route)) {
    score += 0.12;
  }

  return score;
}

export async function retrieveRelevantContext(
  session: MeetingSession,
  query: string,
): Promise<RetrievedContext> {
  const route = routeMeetingQuery(session, query);
  const index = await ensureSessionRagIndex(session);
  const queryEmbedding = await embedTextWithGemini(query, queryTaskType(route), session.title);
  const routedChunks = index.chunks.filter((chunk) => matchesRoute(chunk, route));
  const candidateChunks = routedChunks.length ? routedChunks : index.chunks;
  const bm25Scores = computeBm25Scores(candidateChunks, query);
  const embeddingScores = candidateChunks.map((chunk) =>
    queryEmbedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0,
  );
  const normalizedBm25 = normalizeScores(bm25Scores);
  const normalizedEmbeddings = normalizeScores(embeddingScores);

  const scored = candidateChunks
    .map((chunk, index) => ({
      chunk,
      score: queryEmbedding
        ? normalizedEmbeddings[index] * HYBRID_EMBEDDING_WEIGHT +
          normalizedBm25[index] * HYBRID_BM25_WEIGHT +
          lexicalBonus(chunk, query, route)
        : fallbackScore(chunk, query, route) + normalizedBm25[index] * HYBRID_BM25_WEIGHT,
      embeddingScore: normalizedEmbeddings[index],
      bm25Score: normalizedBm25[index],
    }))
    .sort((left, right) => right.score - left.score);

  const primaryChunks = scored.slice(0, 4).map((item) => item.chunk);
  const chunkLookup = new Map(index.chunks.map((chunk) => [chunk.id, chunk]));
  const supportChunks = primaryChunks
    .flatMap((chunk) => chunk.neighborIds)
    .map((id) => chunkLookup.get(id))
    .filter((chunk): chunk is RagChunk => Boolean(chunk))
    .filter(
      (chunk, position, list) =>
        !primaryChunks.some((primary) => primary.id === chunk.id) &&
        list.findIndex((item) => item.id === chunk.id) === position,
    )
    .slice(0, 4);

  return {
    route,
    primaryChunks,
    supportChunks,
    allChunks: [...primaryChunks, ...supportChunks],
  };
}
