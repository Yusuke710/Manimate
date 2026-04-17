function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const SESSION_FEEDBACK_MESSAGE_KIND = "session_feedback";
export const SESSION_FEEDBACK_ACTIVITY_TYPE = "feedback_submitted";
export const SESSION_FEEDBACK_SOURCE_LIBRARY = "library";
export const MAX_SESSION_FEEDBACK_LENGTH = 4000;

export type SessionFeedbackSource = typeof SESSION_FEEDBACK_SOURCE_LIBRARY;

export interface SessionFeedbackMetadata {
  kind: typeof SESSION_FEEDBACK_MESSAGE_KIND;
  source: SessionFeedbackSource;
  feedback_text: string;
  session_id: string;
  session_number: number;
  session_title: string;
  submitted_at: string;
}

export function isSessionFeedbackMetadata(
  metadata: Record<string, unknown> | null | undefined
): metadata is SessionFeedbackMetadata {
  if (!isRecord(metadata)) return false;
  return (
    metadata.kind === SESSION_FEEDBACK_MESSAGE_KIND &&
    typeof metadata.feedback_text === "string" &&
    typeof metadata.session_id === "string" &&
    typeof metadata.session_number === "number" &&
    Number.isFinite(metadata.session_number) &&
    typeof metadata.session_title === "string" &&
    typeof metadata.submitted_at === "string"
  );
}

export function isSessionFeedbackActivityType(type: string): boolean {
  return type === SESSION_FEEDBACK_ACTIVITY_TYPE;
}

export function normalizeSessionFeedbackContent(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim();
}

export function buildSessionFeedbackMessageContent(
  sessionNumber: number,
  feedbackText: string
): string {
  return `Library feedback for Session #${sessionNumber}\n\n${feedbackText}`;
}

export function buildSessionFeedbackActivityMessage(sessionNumber: number): string {
  return `Library feedback submitted for Session #${sessionNumber}`;
}
