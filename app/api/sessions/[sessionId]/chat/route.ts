import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { answerMeetingQuestion } from "@/lib/meeting-chat";
import { getSession } from "@/lib/session-store";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

type ChatPayload = {
  question?: string;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Please log in to use the meeting chatbot." },
      { status: 401 },
    );
  }

  const { sessionId } = await context.params;
  const session = getSession(sessionId);

  if (!session || session.ownerId !== user.id) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const body = (await request.json()) as ChatPayload;

  try {
    const response = await answerMeetingQuestion(session, body.question ?? "");
    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to answer the meeting question.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
