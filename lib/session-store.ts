import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getDataPath } from "@/lib/data-root";
import { persistSessionRag } from "@/lib/meeting-rag";
import type { MeetingSession, MeetingSummary, SessionStatus, TranscriptEntry } from "@/lib/types";

type SessionStore = Map<string, MeetingSession>;

declare global {
  var __meetingSessions: SessionStore | undefined;
}

const SESSION_STORAGE_DIR = getDataPath("sessions");

function ensureSessionStorageDir() {
  mkdirSync(SESSION_STORAGE_DIR, { recursive: true });
}

function getSessionPath(sessionId: string) {
  return getDataPath("sessions", `${sessionId}.json`);
}

function persistSession(session: MeetingSession) {
  ensureSessionStorageDir();
  writeFileSync(getSessionPath(session.id), JSON.stringify(session, null, 2), "utf8");
  persistSessionRag(session);
}

function loadStoredSessions() {
  ensureSessionStorageDir();

  const store = new Map<string, MeetingSession>();

  for (const fileName of readdirSync(SESSION_STORAGE_DIR)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    const filePath = getDataPath("sessions", fileName);

    try {
      const payload = JSON.parse(readFileSync(filePath, "utf8")) as MeetingSession;

      if (payload?.id) {
        store.set(payload.id, {
          ...payload,
          title: payload.title || "Untitled meeting",
          notes: payload.notes || "",
        });
      }
    } catch {
      continue;
    }
  }

  return store;
}

function getStore() {
  if (!globalThis.__meetingSessions) {
    globalThis.__meetingSessions = existsSync(SESSION_STORAGE_DIR)
      ? loadStoredSessions()
      : new Map<string, MeetingSession>();
  }

  return globalThis.__meetingSessions;
}

export function createSession(meetUrl: string, ownerId: string, title?: string) {
  const now = new Date().toISOString();
  const session: MeetingSession = {
    id: randomUUID(),
    ownerId,
    title: title?.trim() || "Untitled meeting",
    notes: "",
    meetUrl,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    transcript: [],
    debugLog: [],
    summary: null,
    error: null,
  };

  getStore().set(session.id, session);
  persistSession(session);
  return session;
}

export function getSession(sessionId: string) {
  return getStore().get(sessionId) ?? null;
}

export function listSessions(ownerId?: string) {
  const sessions = [...getStore().values()];
  const filtered = ownerId
    ? sessions.filter((session) => session.ownerId === ownerId)
    : sessions;

  return filtered.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function updateSession(
  sessionId: string,
  patch: Partial<Omit<MeetingSession, "id" | "createdAt">>,
) {
  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  const updated: MeetingSession = {
    ...session,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  getStore().set(sessionId, updated);
  persistSession(updated);
  return updated;
}

export function updateSessionStatus(sessionId: string, status: SessionStatus) {
  return updateSession(sessionId, { status });
}

export function appendTranscriptEntry(
  sessionId: string,
  entry: Omit<TranscriptEntry, "id" | "timestamp">,
) {
  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  const transcriptEntry: TranscriptEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };

  return updateSession(sessionId, {
    transcript: [...session.transcript, transcriptEntry],
  });
}

export function setSummary(sessionId: string, summary: MeetingSummary) {
  return updateSession(sessionId, { summary });
}

export function appendDebugLog(sessionId: string, message: string) {
  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  const entry = `[${new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}] ${message}`;

  return updateSession(sessionId, {
    debugLog: [...session.debugLog, entry].slice(-20),
  });
}

export function failSession(sessionId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown bot error.";
  return updateSession(sessionId, {
    status: "failed",
    error: message,
  });
}
