import type {
  MeetingChatResponse,
  MeetingSession,
  RagChunk,
} from "@/lib/types";
import { retrieveRelevantContext } from "@/lib/meeting-rag";

function formatContextChunk(chunk: RagChunk) {
  return [
    `[${chunk.id}]`,
    `source=${chunk.sourceType}`,
    `category=${chunk.category}`,
    chunk.speaker ? `speaker=${chunk.speaker}` : "",
    chunk.timestamp ? `timestamp=${chunk.timestamp}` : "",
    `text=${chunk.text}`,
    chunk.contextWindow ? `neighbors=${chunk.contextWindow}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function buildChatPrompt(
  session: MeetingSession,
  question: string,
  routeLabel: string,
  primaryChunks: RagChunk[],
  supportChunks: RagChunk[],
) {
  return `
You are a contextualized meeting assistant answering questions about one specific meeting.
Your retrieval system has already selected the most relevant chunks for the user's question.

Return valid JSON only with this exact shape:
{
  "answer": "string",
  "citations": ["chunk-id"]
}

Rules:
- Answer only from the provided meeting context.
- Do not invent details that are not present in the retrieved evidence.
- Use the primary chunks first. Use support chunks only to add surrounding clarification.
- If the evidence is incomplete, say that clearly.
- Keep the answer direct and practical.
- Cite only the chunk ids that support the final answer.

Meeting title: ${session.title}
Manual notes: ${session.notes || "No notes."}
Detected query route: ${routeLabel}
User question: ${question}

Primary evidence:
${primaryChunks.map(formatContextChunk).join("\n")}

Supporting evidence:
${supportChunks.length ? supportChunks.map(formatContextChunk).join("\n") : "None"}
`;
}

async function answerWithGemini(
  session: MeetingSession,
  question: string,
  routeLabel: string,
  primaryChunks: RagChunk[],
  supportChunks: RagChunk[],
  apiKey: string,
): Promise<MeetingChatResponse> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildChatPrompt(
                  session,
                  question,
                  routeLabel,
                  primaryChunks,
                  supportChunks,
                ),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini chat request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini returned an empty meeting-chat response.");
  }

  const parsed = JSON.parse(text) as Omit<MeetingChatResponse, "model">;

  return {
    answer: parsed.answer,
    citations: parsed.citations ?? [],
    model: "gemini-2.5-flash",
  };
}

function heuristicChatAnswer(routeLabel: string, chunks: RagChunk[]): MeetingChatResponse {
  if (!chunks.length) {
    return {
      answer:
        "I could not find enough relevant meeting context to answer that confidently from the stored transcript, summary, and notes.",
      citations: [],
      model: "heuristic-contextual-rag",
    };
  }

  return {
    answer: `For this ${routeLabel} question, the strongest retrieved evidence is: ${chunks[0].text}`,
    citations: [chunks[0].id],
    model: "heuristic-contextual-rag",
  };
}

export async function answerMeetingQuestion(session: MeetingSession, question: string) {
  const trimmedQuestion = question.trim();

  if (!trimmedQuestion) {
    throw new Error("Please ask a question about the meeting.");
  }

  const retrieval = await retrieveRelevantContext(session, trimmedQuestion);
  const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  try {
    if (geminiApiKey) {
      return await answerWithGemini(
        session,
        trimmedQuestion,
        retrieval.route.intent,
        retrieval.primaryChunks,
        retrieval.supportChunks,
        geminiApiKey,
      );
    }
  } catch {
    return heuristicChatAnswer(retrieval.route.intent, retrieval.allChunks);
  }

  return heuristicChatAnswer(retrieval.route.intent, retrieval.allChunks);
}
