import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { captureGoogleMeetCaptions } from "@/lib/google-meet-bot";

type CaptureRequestBody = {
  meetUrl?: string;
};

type CapturedCaption = {
  speaker: string;
  text: string;
};

function getPort() {
  const parsed = Number(process.env.PORT ?? "3001");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3001;
}

function getServiceToken() {
  return process.env.PLAYWRIGHT_BOT_SERVICE_TOKEN?.trim() || "";
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request: IncomingMessage) {
  const token = getServiceToken();

  if (!token) {
    return true;
  }

  const authHeader = request.headers.authorization || "";
  return authHeader === `Bearer ${token}`;
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {} as CaptureRequestBody;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as CaptureRequestBody;
}

function isValidMeetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "meet.google.com";
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if ((request.url === "/" || request.url === "/health") && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      service: "playwright-bot",
      headless: process.env.MEET_BOT_HEADLESS ?? "true",
    });
    return;
  }

  if (request.url === "/capture" && request.method === "POST") {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const meetUrl = body.meetUrl?.trim();

      if (!meetUrl || !isValidMeetUrl(meetUrl)) {
        sendJson(response, 400, { error: "Please provide a valid Google Meet link." });
        return;
      }

      const captions: CapturedCaption[] = [];
      const debugLog: string[] = [];

      await captureGoogleMeetCaptions(
        meetUrl,
        async (caption) => {
          captions.push(caption);
        },
        async (message) => {
          debugLog.push(message);
        },
      );

      sendJson(response, 200, {
        ok: true,
        captions,
        debugLog,
      });
      return;
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Playwright bot error.",
      });
      return;
    }
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(getPort(), () => {
  console.log(`[playwright-bot] listening on port ${getPort()}`);
});
