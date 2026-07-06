import { NextRequest, NextResponse } from "next/server";
import { queueLocalCloudSync } from "@/lib/local/cloud-sync";
import {
  buildSessionFeedbackMessageContent,
  MAX_SESSION_FEEDBACK_LENGTH,
  normalizeSessionFeedbackContent,
  SESSION_FEEDBACK_MESSAGE_KIND,
  SESSION_FEEDBACK_SOURCE_LIBRARY,
} from "@/lib/local/feedback";
import {
  getLocalSession,
  insertLocalMessage,
} from "@/lib/local/session-store";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const { sessionId } = await context.params;
  const session = getLocalSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let feedbackText = "";
  try {
    const body = await request.json();
    feedbackText =
      typeof body?.feedback === "string" ? normalizeSessionFeedbackContent(body.feedback) : "";
  } catch {
    feedbackText = "";
  }

  if (!feedbackText) {
    return NextResponse.json(
      { error: "Feedback cannot be empty." },
      { status: 400 }
    );
  }

  if (feedbackText.length > MAX_SESSION_FEEDBACK_LENGTH) {
    return NextResponse.json(
      {
        error: `Feedback must be ${MAX_SESSION_FEEDBACK_LENGTH} characters or less.`,
      },
      { status: 400 }
    );
  }

  const submittedAt = new Date().toISOString();
  const feedbackMetadata = {
    kind: SESSION_FEEDBACK_MESSAGE_KIND,
    source: SESSION_FEEDBACK_SOURCE_LIBRARY,
    feedback_text: feedbackText,
    session_id: session.id,
    session_number: session.session_number,
    session_title: session.title,
    submitted_at: submittedAt,
  };

  insertLocalMessage({
    session_id: session.id,
    role: "user",
    content: buildSessionFeedbackMessageContent(session.session_number, feedbackText),
    metadata: feedbackMetadata,
  });

  queueLocalCloudSync(session.id);

  return NextResponse.json({
    ok: true,
    session_id: session.id,
    session_number: session.session_number,
    submitted_at: submittedAt,
  });
}
