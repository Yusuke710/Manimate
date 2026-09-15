import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/components/ChatMessages";
import type { ActivityEvent, Message } from "@/lib/types";

describe("conversation ordering", () => {
  it("does not hide earlier commentary because another turn has the same final reply", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: "First" },
      { id: "a1", role: "assistant", content: "Finished first" },
      { id: "u2", role: "user", content: "Second" },
      { id: "a2", role: "assistant", content: "Checking" },
    ];
    const activity: ActivityEvent = { id: "event", turnId: "u1", timestamp: new Date(), type: "assistant_text", message: "Checking" };
    expect(buildTimeline(messages, [activity]).map(item => item.data.id)).toEqual(["u1", "event", "a1", "u2", "a2"]);
  });
  it("preserves different replies sharing a long opening, while suppressing the saved final duplicate", () => {
    const prefix = "x".repeat(210);
    const messages: Message[] = [{ id: "u", role: "user", content: "Go" }, { id: "a", role: "assistant", content: prefix + "final" }];
    const activities: ActivityEvent[] = ["commentary", "final"].map((suffix, i) => ({ id: suffix, turnId: "u", timestamp: new Date(i), type: "assistant_text", message: prefix + suffix }));
    expect(buildTimeline(messages, activities).map(item => item.data.id)).toEqual(["u", "commentary", "a"]);
  });
});


import { chatReducer, initialState } from "@/components/ChatPanel";

describe("live turn reconciliation", () => {
  it("keeps streamed activity attached when polling replaces the temporary user message", () => {
    const activity: ActivityEvent = { id: "e", type: "assistant_text", message: "Working", turnId: "temporary", timestamp: new Date() };
    const state = { ...initialState, messages: [{ id: "saved", role: "user" as const, content: "Go" }], activityEvents: [activity] };
    const next = chatReducer(state, { type: "RECONCILE_TURN", from: "temporary", to: "saved" });
    expect(next.messages).toEqual(state.messages);
    expect(next.activityEvents[0].turnId).toBe("saved");
    expect(buildTimeline(next.messages, next.activityEvents).map(item => item.data.id)).toEqual(["saved", "e"]);
  });
  it("renames an optimistic message without adding a second user bubble", () => {
    const state = { ...initialState, messages: [{ id: "temporary", role: "user" as const, content: "Go" }] };
    expect(chatReducer(state, { type: "RECONCILE_TURN", from: "temporary", to: "saved" }).messages).toEqual([{ id: "saved", role: "user", content: "Go" }]);
  });
});


it("updates the connection model in place when the CLI resolves its model alias", () => {
  const init: ActivityEvent = { id: "init", turnId: "u", timestamp: new Date(0), type: "system_init", message: "Manimate connected · opus" };
  const state = { ...initialState, activityEvents: [init] };
  const next = chatReducer(state, { type: "ADD_ACTIVITY", event: { ...init, id: "resolved", timestamp: new Date(1), message: "Manimate connected · resolved-model" } });
  expect(next.activityEvents).toEqual([{ ...init, message: "Manimate connected · resolved-model" }]);
});
