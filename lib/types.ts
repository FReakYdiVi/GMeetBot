export type SessionStatus =
  | "queued"
  | "launching"
  | "joining"
  | "capturing"
  | "summarizing"
  | "completed"
  | "failed";

export type TranscriptEntry = {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
};

export type RagChunk = {
  id: string;
  sessionId: string;
  sourceType: "transcript" | "summary" | "notes";
  category:
    | "decision"
    | "action_item"
    | "speaker_specific"
    | "timeline"
    | "general_discussion";
  text: string;
  contextualText: string;
  meetingTitle: string;
  contextWindow: string;
  neighborIds: string[];
  speaker?: string;
  timestamp?: string;
  keywords: string[];
  embedding?: number[];
};

export type SessionRagIndex = {
  sessionId: string;
  updatedAt: string;
  strategyVersion: string;
  chunks: RagChunk[];
};

export type MeetingQueryIntent =
  | "decisions"
  | "action_items"
  | "speaker"
  | "timeline"
  | "general";

export type MeetingChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  citations?: string[];
};

export type MeetingChatResponse = {
  answer: string;
  citations: string[];
  model: string;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type MeetingSummary = {
  overview: string;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
  model: string;
};

export type MeetingSession = {
  id: string;
  ownerId: string;
  title: string;
  notes: string;
  meetUrl: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  transcript: TranscriptEntry[];
  debugLog: string[];
  summary: MeetingSummary | null;
  error: string | null;
};
