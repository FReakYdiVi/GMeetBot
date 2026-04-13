import type { MeetingSummary, TranscriptEntry } from "@/lib/types";

function buildTranscriptText(transcript: TranscriptEntry[]) {
  return transcript.map((entry) => `${entry.speaker}: ${entry.text}`).join("\n");
}

const SUMMARY_CONTRACT = `
Return valid JSON only with this exact shape:
{
  "overview": "string",
  "keyPoints": ["string"],
  "actionItems": ["string"],
  "decisions": ["string"]
}
`;

const SECTION_RULES = `
Write each section using these exact rules:

- overview:
  A 2-4 sentence executive summary of the meeting.
  Explain the main topic, outcome, and overall direction.
  Do not turn overview into bullets.

- keyPoints:
  Main discussion themes only.
  Include topics, constraints, risks, or ideas that were discussed.
  Do not include tasks assigned to specific people.
  Do not include final decisions unless they were heavily discussed as part of context.
  Keep each point short, distinct, and non-repetitive.
  Prefer 3-5 bullets.

- actionItems:
  Only include concrete follow-up tasks.
  Each item should describe who needs to do what, when that is explicit.
  If no owner is stated, write the task without inventing an owner.
  Do not include vague observations or background discussion.
  Prefer 1-5 bullets.

- decisions:
  Only include things that were clearly agreed, chosen, finalized, approved, or rejected.
  If something was merely suggested or discussed, keep it out of decisions.
  Keep each decision crisp and outcome-focused.
  Prefer 1-4 bullets.

Additional rules:
- Avoid repeating the same idea across keyPoints, actionItems, and decisions.
- Keep wording clean and professional.
- Do not invent facts that are not supported by the transcript.
- If a section has no strong content, return an empty array for that section.
`;

function buildGeminiPrompt(transcript: TranscriptEntry[]) {
  return `
You are an expert meeting summarizer for a Google Meet assistant.
Your job is to turn the transcript into a clean, structured summary where each section has a distinct purpose.

${SUMMARY_CONTRACT}

${SECTION_RULES}

Transcript:
${buildTranscriptText(transcript)}
`;
}

export async function summarizeWithGemini(
  transcript: TranscriptEntry[],
  apiKey: string,
): Promise<MeetingSummary> {
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
            parts: [{ text: buildGeminiPrompt(transcript) }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}.`);
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
    throw new Error("Gemini returned an empty summary response.");
  }

  const parsed = JSON.parse(text) as Omit<MeetingSummary, "model">;

  return {
    ...parsed,
    model: "gemini-2.5-flash",
  };
}
