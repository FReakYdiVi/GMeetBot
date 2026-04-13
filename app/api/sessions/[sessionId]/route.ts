import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSession, updateSession } from "@/lib/session-store";
import type { MeetingSummary } from "@/lib/types";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Please log in to view this session." }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const session = getSession(sessionId);

  if (!session || session.ownerId !== user.id) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ session });
}

type UpdateSessionPayload = {
  title?: string;
  notes?: string;
  summary?: MeetingSummary;
};

function sanitizeSummary(summary: MeetingSummary | undefined | null) {
  if (!summary) {
    return undefined;
  }

  return {
    overview: summary.overview?.trim() ?? "",
    keyPoints: Array.isArray(summary.keyPoints)
      ? summary.keyPoints.map((item) => item.trim()).filter(Boolean)
      : [],
    actionItems: Array.isArray(summary.actionItems)
      ? summary.actionItems.map((item) => item.trim()).filter(Boolean)
      : [],
    decisions: Array.isArray(summary.decisions)
      ? summary.decisions.map((item) => item.trim()).filter(Boolean)
      : [],
    model: summary.model?.trim() || "edited-manually",
  } satisfies MeetingSummary;
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Please log in to edit this session." }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const session = getSession(sessionId);

  if (!session || session.ownerId !== user.id) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const body = (await request.json()) as UpdateSessionPayload;

  const updated = updateSession(sessionId, {
    title: body.title?.trim() || session.title,
    notes: body.notes ?? session.notes,
    summary: sanitizeSummary(body.summary) ?? session.summary,
  });

  return NextResponse.json({ session: updated });
}
