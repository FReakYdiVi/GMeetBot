import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createSession, getSession, listSessions } from "@/lib/session-store";
import { runMeetingPipeline } from "@/lib/meet-bot";

type StartSessionPayload = {
  meetUrl?: string;
  title?: string;
};

function isValidMeetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "meet.google.com";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Please log in to start a session." }, { status: 401 });
  }

  const body = (await request.json()) as StartSessionPayload;
  const meetUrl = body.meetUrl?.trim();
  const title = body.title?.trim();

  if (!meetUrl || !isValidMeetUrl(meetUrl)) {
    return NextResponse.json(
      { error: "Please provide a valid Google Meet link." },
      { status: 400 },
    );
  }

  const session = createSession(meetUrl, user.id, title);

  void runMeetingPipeline(session.id);

  const freshSession = getSession(session.id);

  return NextResponse.json({ session: freshSession }, { status: 201 });
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Please log in to view sessions." }, { status: 401 });
  }

  return NextResponse.json({ sessions: listSessions(user.id) });
}
