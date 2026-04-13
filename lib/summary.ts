import type { MeetingSummary, TranscriptEntry } from "@/lib/types";
import { summarizeWithGemini } from "@/lib/gemini-summary";

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function heuristicSummary(transcript: TranscriptEntry[]): MeetingSummary {
  const lines = transcript.map((entry) => entry.text.trim()).filter(Boolean);
  const keyPoints = unique(lines.slice(0, 4));

  const actionItems = unique(
    lines.filter((line) =>
      /will|follow up|send|share|need to|prepare|review|next step/i.test(line),
    ),
  ).slice(0, 4);

  const decisions = unique(
    lines.filter((line) =>
      /decided|finalize|go with|ship|launch|approved|let's/i.test(line),
    ),
  ).slice(0, 4);

  const overview =
    lines.length > 0
      ? `The meeting focused on ${lines
          .slice(0, 2)
          .map((line) => line.replace(/\.$/, ""))
          .join(" and ")}.`
      : "The meeting transcript is empty, so there is nothing to summarize yet.";

  return {
    overview,
    keyPoints:
      keyPoints.length > 0
        ? keyPoints
        : ["No strong key points were detected from the current transcript."],
    actionItems:
      actionItems.length > 0
        ? actionItems
        : ["No explicit action items were identified."],
    decisions:
      decisions.length > 0
        ? decisions
        : ["No explicit decisions were identified."],
    model: "heuristic-fallback",
  };
}

async function summarizeWithOpenAI(
  transcript: TranscriptEntry[],
  apiKey: string,
): Promise<MeetingSummary> {
  const transcriptText = transcript
    .map((entry) => `${entry.speaker}: ${entry.text}`)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Summarize meeting transcripts. Return compact JSON with overview, keyPoints, actionItems, and decisions.",
        },
        {
          role: "user",
          content: `Transcript:\n${transcriptText}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "meeting_summary",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              overview: { type: "string" },
              keyPoints: {
                type: "array",
                items: { type: "string" },
              },
              actionItems: {
                type: "array",
                items: { type: "string" },
              },
              decisions: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["overview", "keyPoints", "actionItems", "decisions"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
  };

  if (!payload.output_text) {
    throw new Error("OpenAI returned an empty summary response.");
  }

  const parsed = JSON.parse(payload.output_text) as Omit<MeetingSummary, "model">;

  return {
    ...parsed,
    model: "gpt-4.1-mini",
  };
}

export async function generateMeetingSummary(transcript: TranscriptEntry[]) {
  if (transcript.length === 0) {
    return heuristicSummary(transcript);
  }

  const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const openAiApiKey = process.env.OPENAI_API_KEY;

  try {
    if (geminiApiKey) {
      return await summarizeWithGemini(transcript, geminiApiKey);
    }

    if (openAiApiKey) {
      return await summarizeWithOpenAI(transcript, openAiApiKey);
    }
  } catch {
    return heuristicSummary(transcript);
  }

  return heuristicSummary(transcript);
}
