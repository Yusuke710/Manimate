import { describe, expect, it } from "vitest";
import {
  buildConversationRecoveryContext,
  type SessionHistoryMessage,
} from "@/lib/conversation-recovery";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

function makeMessage(
  partial: Partial<SessionHistoryMessage> & Pick<SessionHistoryMessage, "id" | "role">
): SessionHistoryMessage {
  return {
    id: partial.id,
    role: partial.role,
    content: partial.content ?? "",
    metadata: (partial.metadata ?? null) as JsonValue,
    created_at: partial.created_at ?? new Date().toISOString(),
  };
}

describe("conversation recovery for fresh sandbox fallback", () => {
  it("reconstructs prior messages and persisted images when sandbox resume is unavailable", () => {
    const messages: SessionHistoryMessage[] = [
      makeMessage({
        id: "m1",
        role: "user",
        content: "Create a bouncing ball animation.",
      }),
      makeMessage({
        id: "m2",
        role: "assistant",
        content: "I created script.py and rendered a draft.",
      }),
      makeMessage({
        id: "m3",
        role: "user",
        content: "Use this logo in the corner.",
        metadata: {
          images: [
            {
              id: "13eab665-778a-4e37-a4f4-bf5245f75050",
              path: "user-1/session-1/logo.png",
              name: "logo.png",
              size: 1234,
              type: "image/png",
            },
          ],
        },
      }),
      makeMessage({
        id: "m4",
        role: "user",
        content: "Now make the background white.",
      }),
    ];

    const result = buildConversationRecoveryContext({
      messages,
      projectPath: "/home/user/sandbox-new",
      userId: "user-1",
      sessionId: "session-1",
      excludeMessageId: "m4",
    });

    expect(result.historyMessageCount).toBe(3);
    expect(result.historyPrompt).toContain(
      "Recovered conversation context from persisted history"
    );
    expect(result.historyPrompt).toContain("Create a bouncing ball animation.");
    expect(result.historyPrompt).toContain("I created script.py and rendered a draft.");
    expect(result.historyPrompt).toContain("Use this logo in the corner.");
    expect(result.historyPrompt).toContain("/home/user/sandbox-new/inputs/history/");
    expect(result.images).toHaveLength(1);
    expect(result.images[0].path).toBe("user-1/session-1/logo.png");
    expect(result.images[0].sandboxPath).toContain("/home/user/sandbox-new/inputs/history/");
  });

  it("ignores images that do not belong to the current user/session", () => {
    const result = buildConversationRecoveryContext({
      messages: [
        makeMessage({
          id: "m1",
          role: "user",
          content: "Please use this reference image.",
          metadata: {
            images: [
              {
                id: "13eab665-778a-4e37-a4f4-bf5245f75050",
                path: "attacker/other-session/evil.png",
                name: "evil.png",
                size: 1,
                type: "image/png",
              },
            ],
          },
        }),
      ],
      projectPath: "/home/user/sandbox-new",
      userId: "user-1",
      sessionId: "session-1",
    });

    expect(result.images).toHaveLength(0);
    expect(result.historyPrompt).not.toContain("attacker/other-session");
  });
});
