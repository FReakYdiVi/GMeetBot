import {
  appendTranscriptEntry,
  appendDebugLog,
  failSession,
  getSession,
  setSummary,
  updateSessionStatus,
} from "@/lib/session-store";
import { captureGoogleMeetCaptions } from "@/lib/google-meet-bot";
import { generateMeetingSummary } from "@/lib/summary";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRemoteBotServiceUrl() {
  return process.env.PLAYWRIGHT_BOT_SERVICE_URL?.trim() || "";
}

function getRemoteBotServiceToken() {
  return process.env.PLAYWRIGHT_BOT_SERVICE_TOKEN?.trim() || "";
}

async function captureMockTranscript(sessionId: string) {
  const transcript = [
    {
      speaker: "Aarav",
      text: "Thanks everyone for joining. The goal today is to finalize the MVP scope for the Google Meet AI scribe.",
    },
    {
      speaker: "Neha",
      text: "Let us keep the first version focused on joining the meeting, capturing captions, and generating a clean summary.",
    },
    {
      speaker: "Aarav",
      text: "I will wire the bot lifecycle and status updates so the UI reflects launch, join, capture, and summary stages.",
    },
    {
      speaker: "Riya",
      text: "We should store transcript chunks incrementally because that will make the app feel more live and safer if the process stops.",
    },
    {
      speaker: "Neha",
      text: "For the deadline, we will skip audio routing and keep the architecture caption-first.",
    },
    {
      speaker: "Aarav",
      text: "Let us ship the MVP with a mock bot first, then replace the capture layer with Playwright-based Meet automation.",
    },
  ];

  for (const item of transcript) {
    appendTranscriptEntry(sessionId, item);
    await wait(1400);
  }
}

async function captureMeetCaptions(sessionId: string) {
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("Session not found while starting caption capture.");
  }

  appendDebugLog(sessionId, "Starting real Meet caption capture.");

  const remoteBotServiceUrl = getRemoteBotServiceUrl();

  if (remoteBotServiceUrl) {
    appendDebugLog(sessionId, "Using remote Playwright bot service.");

    const response = await fetch(`${remoteBotServiceUrl.replace(/\/+$/, "")}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getRemoteBotServiceToken()
          ? { Authorization: `Bearer ${getRemoteBotServiceToken()}` }
          : {}),
      },
      body: JSON.stringify({
        meetUrl: session.meetUrl,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      captions?: Array<{ speaker: string; text: string }>;
      debugLog?: string[];
      error?: string;
    };

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Remote Playwright bot failed with status ${response.status}.`);
    }

    for (const message of payload.debugLog ?? []) {
      appendDebugLog(sessionId, `[remote-bot] ${message}`);
    }

    for (const caption of payload.captions ?? []) {
      appendTranscriptEntry(sessionId, caption);
      appendDebugLog(sessionId, `Captured caption from ${caption.speaker}: ${caption.text}`);
    }

    return;
  }

  await captureGoogleMeetCaptions(
    session.meetUrl,
    async (caption) => {
      appendTranscriptEntry(sessionId, caption);
      appendDebugLog(sessionId, `Captured caption from ${caption.speaker}: ${caption.text}`);
    },
    async (message) => {
      appendDebugLog(sessionId, message);
    },
  );
}

async function captureTranscript(sessionId: string) {
  const mode = process.env.MEET_BOT_MODE ?? "captions";

  if (mode === "mock") {
    await captureMockTranscript(sessionId);
    return;
  }

  if (mode === "captions") {
    await captureMeetCaptions(sessionId);
    return;
  }

  throw new Error(`Unsupported MEET_BOT_MODE: ${mode}`);
}

export async function runMeetingPipeline(sessionId: string) {
  try {
    updateSessionStatus(sessionId, "launching");
    appendDebugLog(sessionId, "Bot launching.");
    await wait(1200);

    updateSessionStatus(sessionId, "joining");
    appendDebugLog(sessionId, "Bot moving into join flow.");
    await wait(1600);

    updateSessionStatus(sessionId, "capturing");
    appendDebugLog(sessionId, "Bot entered capture stage.");
    await captureTranscript(sessionId);

    updateSessionStatus(sessionId, "summarizing");
    appendDebugLog(sessionId, "Generating summary from captured transcript.");
    const session = getSession(sessionId);

    if (!session) {
      throw new Error("Session disappeared before summary generation.");
    }

    const summary = await generateMeetingSummary(session.transcript);
    setSummary(sessionId, summary);
    updateSessionStatus(sessionId, "completed");
    appendDebugLog(sessionId, "Session completed.");
  } catch (error) {
    failSession(sessionId, error);
  }
}
