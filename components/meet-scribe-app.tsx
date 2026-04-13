"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { exportSessionAsPdf, exportSessionAsText } from "@/lib/export-session";
import type {
  AuthUser,
  MeetingChatMessage,
  MeetingChatResponse,
  MeetingSession,
  MeetingSummary,
} from "@/lib/types";

const DEFAULT_LINK = "https://meet.google.com/abc-defg-hij";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toTitleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summaryItemsToText(items: string[] | undefined) {
  return items?.join("\n") ?? "";
}

function textToSummaryItems(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

const SUMMARY_SECTION_COPY = {
  keyPoints: "Main discussion themes, constraints, and important context. Avoid tasks and finalized choices here.",
  actionItems:
    "Concrete follow-up tasks. Prefer one task per line, with owner or next step when known.",
  decisions:
    "Only finalized choices, approvals, or rejections. Do not include loose suggestions.",
} as const;

type MeetScribeAppProps = {
  currentUser: AuthUser;
};

export function MeetScribeApp({ currentUser }: MeetScribeAppProps) {
  const [meetUrl, setMeetUrl] = useState(DEFAULT_LINK);
  const [launchTitle, setLaunchTitle] = useState("");
  const [session, setSession] = useState<MeetingSession | null>(null);
  const [savedSessions, setSavedSessions] = useState<MeetingSession[]>([]);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [overviewDraft, setOverviewDraft] = useState("");
  const [keyPointsDraft, setKeyPointsDraft] = useState("");
  const [actionItemsDraft, setActionItemsDraft] = useState("");
  const [decisionsDraft, setDecisionsDraft] = useState("");
  const [chatMessages, setChatMessages] = useState<MeetingChatMessage[]>([]);
  const [chatQuestion, setChatQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSaving, startSavingTransition] = useTransition();
  const [isChatting, startChatTransition] = useTransition();
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);

  function applySessionDrafts(nextSession: MeetingSession | null) {
    if (!nextSession) {
      setSessionTitle("");
      setSessionNotes("");
      setOverviewDraft("");
      setKeyPointsDraft("");
      setActionItemsDraft("");
      setDecisionsDraft("");
      return;
    }

    setSessionTitle(nextSession.title);
    setSessionNotes(nextSession.notes);
    setOverviewDraft(nextSession.summary?.overview ?? "");
    setKeyPointsDraft(summaryItemsToText(nextSession.summary?.keyPoints));
    setActionItemsDraft(summaryItemsToText(nextSession.summary?.actionItems));
    setDecisionsDraft(summaryItemsToText(nextSession.summary?.decisions));
  }

  function selectSession(nextSession: MeetingSession | null) {
    setSession(nextSession);
    applySessionDrafts(nextSession);
    setChatQuestion("");
    setChatMessages([]);
  }

  async function loadSavedSessions() {
    const response = await fetch("/api/sessions", {
      cache: "no-store",
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { sessions: MeetingSession[] };
    setSavedSessions(payload.sessions);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSavedSessions();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const poll = window.setInterval(async () => {
      const response = await fetch(`/api/sessions/${session.id}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { session: MeetingSession };
      setSession(payload.session);
      applySessionDrafts(payload.session);

      if (
        payload.session.status === "completed" ||
        payload.session.status === "failed"
      ) {
        void loadSavedSessions();
        window.clearInterval(poll);
      }
    }, 2000);

    return () => window.clearInterval(poll);
  }, [session?.id]);

  useEffect(() => {
    if (!transcriptRef.current) {
      return;
    }

    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [session?.transcript.length]);

  useEffect(() => {
    if (!chatRef.current) {
      return;
    }

    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages.length]);

  const stats = useMemo(() => {
    if (!session) {
      return null;
    }

    return {
      transcriptCount: session.transcript.length,
      durationLabel: `${Math.max(session.transcript.length * 18, 90)} sec`,
    };
  }, [session]);

  function buildEditedSummary(): MeetingSummary | null {
    if (!session?.summary) {
      return null;
    }

    return {
      overview: overviewDraft.trim(),
      keyPoints: textToSummaryItems(keyPointsDraft),
      actionItems: textToSummaryItems(actionItemsDraft),
      decisions: textToSummaryItems(decisionsDraft),
      model: "edited-manually",
    };
  }

  function buildExportSession() {
    if (!session) {
      return null;
    }

    return {
      ...session,
      title: sessionTitle.trim() || session.title,
      notes: sessionNotes,
      summary: buildEditedSummary() ?? session.summary,
    };
  }

  async function startSession() {
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetUrl,
          title: launchTitle.trim(),
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        session?: MeetingSession;
      };

      if (!response.ok || !payload.session) {
        setError(payload.error ?? "Unable to start the bot session.");
        return;
      }

      selectSession(payload.session);
      void loadSavedSessions();
    });
  }

  async function saveSessionEdits() {
    if (!session) {
      return;
    }

    setError(null);

    startSavingTransition(async () => {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: sessionTitle.trim(),
          notes: sessionNotes,
          summary: buildEditedSummary() ?? undefined,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        session?: MeetingSession;
      };

      if (!response.ok || !payload.session) {
        setError(payload.error ?? "Unable to save session edits.");
        return;
      }

      setSession(payload.session);
      applySessionDrafts(payload.session);
      void loadSavedSessions();
    });
  }

  async function askMeetingQuestion() {
    if (!session || !chatQuestion.trim()) {
      return;
    }

    const userMessage: MeetingChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: chatQuestion.trim(),
      timestamp: new Date().toISOString(),
    };

    setChatMessages((current) => [...current, userMessage]);
    const question = chatQuestion.trim();
    setChatQuestion("");

    startChatTransition(async () => {
      const response = await fetch(`/api/sessions/${session.id}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question }),
      });

      const payload = (await response.json()) as
        | ({ error?: string } & Partial<MeetingChatResponse>)
        | undefined;

      const assistantMessage: MeetingChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          response.ok && payload?.answer
            ? payload.answer
            : payload?.error ?? "I could not answer that meeting question right now.",
        timestamp: new Date().toISOString(),
        citations: response.ok ? payload?.citations ?? [] : [],
      };

      setChatMessages((current) => [...current, assistantMessage]);
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
    });

    window.location.reload();
  }

  const sessionStatusClass =
    session?.status === "completed"
      ? "status completed"
      : session?.status === "failed"
        ? "status failed"
        : "status";

  const exportSession = buildExportSession();

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-topbar">
          <span className="eyebrow">Caption-first Google Meet MVP</span>
          <div className="hero-user">
            <div>
              <strong>{currentUser.name}</strong>
              <span>{currentUser.email}</span>
            </div>
            <button className="ghost-button" onClick={logout} type="button">
              Log out
            </button>
          </div>
        </div>
        <h1>Meet AI Scribe</h1>
        <p>
          Start with a Meet link, let the bot run through join and caption
          capture stages, then refine the summary with your own edits, notes,
          and export-ready session details.
        </p>
      </section>

      <section className="grid" aria-label="Meet AI Scribe dashboard">
        <div className="stack">
          <article className="card stack">
            <div>
              <h2>Launch a session</h2>
              <p>
                Give the meeting a name up front, then let the Playwright bot
                handle join, captions, and summarization.
              </p>
            </div>

            <div className="field">
              <label htmlFor="meeting-title">Meeting title</label>
              <input
                id="meeting-title"
                className="input"
                onChange={(event) => setLaunchTitle(event.target.value)}
                placeholder="Weekly sync, Interview round, Product review..."
                value={launchTitle}
              />
            </div>

            <div className="field">
              <label htmlFor="meet-link">Google Meet link</label>
              <input
                id="meet-link"
                className="input"
                value={meetUrl}
                onChange={(event) => setMeetUrl(event.target.value)}
                placeholder="https://meet.google.com/..."
              />
            </div>

            <div className="pill-row">
              <span className="pill">Editable summary</span>
              <span className="pill">Meeting title</span>
              <span className="pill">Manual notes</span>
              <span className="pill">PDF and TXT export</span>
            </div>

            <button className="button" onClick={startSession} disabled={isPending}>
              {isPending ? "Starting bot..." : "Start MVP flow"}
            </button>

            {error ? <p className="note">{error}</p> : null}
          </article>

          <article className="card stack">
            <div>
              <h2>Session status</h2>
              <p>Track the bot pipeline from launch through summary generation.</p>
            </div>

            {session ? (
              <>
                <div className={sessionStatusClass}>
                  {toTitleCase(session.status)}
                </div>

                <div className="meta">
                  <div className="meta-item">
                    <strong>Meeting title</strong>
                    <span>{session.title}</span>
                  </div>
                  <div className="meta-item">
                    <strong>Created</strong>
                    <span>{formatDate(session.createdAt)}</span>
                  </div>
                  <div className="meta-item">
                    <strong>Transcript Entries</strong>
                    <span>{stats?.transcriptCount ?? 0}</span>
                  </div>
                  <div className="meta-item">
                    <strong>Estimated Coverage</strong>
                    <span>{stats?.durationLabel ?? "0 sec"}</span>
                  </div>
                </div>

                <div className="meta-item">
                  <strong>Meet URL</strong>
                  <span className="mono">{session.meetUrl}</span>
                </div>

                {session.error ? (
                  <p className="note">Bot error: {session.error}</p>
                ) : null}

                {session.debugLog.length ? (
                  <div className="summary-block">
                    <span className="section-label">Bot Debug</span>
                    <ul>
                      {session.debugLog.map((item) => (
                        <li key={item} className="mono">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty">
                Start a session to see the bot lifecycle, transcript progress,
                and final summary.
              </div>
            )}
          </article>

          <article className="card stack">
            <div>
              <h2>Saved sessions</h2>
              <p>
                Earlier runs stay available with their edited summary, notes,
                and exports.
              </p>
            </div>

            {savedSessions.length ? (
              <div className="history-list">
                {savedSessions.map((item) => (
                  <button
                    className="history-item"
                    key={item.id}
                    onClick={() => {
                      selectSession(item);
                    }}
                    type="button"
                  >
                    <div className="history-item-top">
                      <strong>{item.title}</strong>
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                    <div className="history-item-bottom">
                      <span>{item.summary?.overview ?? "Session in progress"}</span>
                      <span>{item.transcript.length} transcript entries</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty">
                Stored meeting sessions will appear here after the first run
                completes.
              </div>
            )}
          </article>
        </div>

        <div className="stack">
          <article className="card stack">
            <div>
              <h3>Session workspace</h3>
              <p>
                Adjust the meeting title, add manual notes, and keep the final
                record client-ready before you export it.
              </p>
            </div>

            {session ? (
              <>
                <div className="field">
                  <label htmlFor="session-title">Meeting title</label>
                  <input
                    id="session-title"
                    className="input"
                    onChange={(event) => setSessionTitle(event.target.value)}
                    placeholder="Untitled meeting"
                    value={sessionTitle}
                  />
                </div>

                <div className="field">
                  <label htmlFor="session-notes">Manual notes</label>
                  <textarea
                    id="session-notes"
                    className="textarea"
                    onChange={(event) => setSessionNotes(event.target.value)}
                    placeholder="Add context, personal notes, or follow-up remarks here..."
                    rows={5}
                    value={sessionNotes}
                  />
                </div>

                <div className="action-row">
                  <button className="ghost-button" onClick={saveSessionEdits} type="button">
                    {isSaving ? "Saving..." : "Save title and notes"}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty">
                Start or open a session to edit its title and notes.
              </div>
            )}
          </article>

          <article className="card stack transcript-card">
            <div>
              <h3>Transcript</h3>
              <p>Live caption chunks appear here as the bot captures them.</p>
            </div>

            <div className="transcript-panel">
              {session?.transcript.length ? (
                <div className="transcript" ref={transcriptRef}>
                  {session.transcript.map((entry) => (
                    <div className="transcript-entry" key={entry.id}>
                      <header>
                        <span>{entry.speaker}</span>
                        <span>{formatDate(entry.timestamp)}</span>
                      </header>
                      <div>{entry.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  The transcript will start filling in once the bot enters the
                  capture stage.
                </div>
              )}
            </div>
          </article>

          <article className="card stack">
            <div>
              <h3>Meeting chatbot</h3>
              <p>
                Ask focused questions about the selected meeting. Answers use a
                persisted RAG index built from transcript, summary, and notes.
              </p>
            </div>

            {session ? (
              <>
                <div className="chat-panel" ref={chatRef}>
                  {chatMessages.length ? (
                    chatMessages.map((message) => (
                      <div
                        className={
                          message.role === "assistant"
                            ? "chat-message assistant"
                            : "chat-message user"
                        }
                        key={message.id}
                      >
                        <span className="chat-role">
                          {message.role === "assistant" ? "Meeting bot" : "You"}
                        </span>
                        <p>{message.text}</p>
                        {message.citations?.length ? (
                          <div className="chat-citations">
                            {message.citations.map((citation) => (
                              <span className="citation-pill" key={citation}>
                                {citation.slice(0, 8)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="empty">
                      Try asking things like “What decisions were made?”, “What
                      follow-ups are assigned?”, or “What did Neha say about the
                      MVP?”.
                    </div>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="chat-question">Ask about this meeting</label>
                  <textarea
                    id="chat-question"
                    className="textarea chat-input"
                    onChange={(event) => setChatQuestion(event.target.value)}
                    placeholder="What was the final plan for the MVP?"
                    rows={3}
                    value={chatQuestion}
                  />
                </div>

                <div className="action-row">
                  <button
                    className="button"
                    disabled={isChatting || !chatQuestion.trim() || !session.transcript.length}
                    onClick={askMeetingQuestion}
                    type="button"
                  >
                    {isChatting ? "Thinking..." : "Ask meeting chatbot"}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty">
                Open a session first to ask meeting-specific questions.
              </div>
            )}
          </article>

          <article className="card stack">
            <div>
              <h3>Summary</h3>
              <p>
                Edit the AI output, then export the polished result as a text
                file or PDF.
              </p>
            </div>

            {session?.summary ? (
              <div className="summary-grid">
                <div className="summary-toolbar">
                  <div>
                    <span className="section-label">Current source</span>
                    <p>{session.summary.model}</p>
                  </div>
                  <div className="action-row">
                    <button
                      className="ghost-button"
                      disabled={!exportSession}
                      onClick={() => exportSession && exportSessionAsText(exportSession)}
                      type="button"
                    >
                      Download TXT
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!exportSession}
                      onClick={() => exportSession && exportSessionAsPdf(exportSession)}
                      type="button"
                    >
                      Download PDF
                    </button>
                  </div>
                </div>

                <div className="summary-block">
                  <span className="section-label">Overview</span>
                  <p className="helper-text">
                    Short executive summary of the meeting outcome and direction.
                  </p>
                  <textarea
                    className="textarea summary-textarea"
                    onChange={(event) => setOverviewDraft(event.target.value)}
                    rows={5}
                    value={overviewDraft}
                  />
                </div>

                <div className="summary-block summary-block-key">
                  <span className="section-label">Key Points</span>
                  <p className="helper-text">{SUMMARY_SECTION_COPY.keyPoints}</p>
                  <textarea
                    className="textarea summary-textarea summary-textarea-key"
                    onChange={(event) => setKeyPointsDraft(event.target.value)}
                    rows={6}
                    value={keyPointsDraft}
                  />
                </div>

                <div className="summary-block summary-block-action">
                  <span className="section-label">Action Items</span>
                  <p className="helper-text">{SUMMARY_SECTION_COPY.actionItems}</p>
                  <textarea
                    className="textarea summary-textarea summary-textarea-action"
                    onChange={(event) => setActionItemsDraft(event.target.value)}
                    rows={6}
                    value={actionItemsDraft}
                  />
                </div>

                <div className="summary-block summary-block-decision">
                  <span className="section-label">Decisions</span>
                  <p className="helper-text">{SUMMARY_SECTION_COPY.decisions}</p>
                  <textarea
                    className="textarea summary-textarea summary-textarea-decision"
                    onChange={(event) => setDecisionsDraft(event.target.value)}
                    rows={6}
                    value={decisionsDraft}
                  />
                </div>

                <div className="action-row">
                  <button className="button" onClick={saveSessionEdits} type="button">
                    {isSaving ? "Saving summary..." : "Save edited summary"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty">
                Summary output lands here after the transcript is processed.
              </div>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
