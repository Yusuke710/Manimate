import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({begin: vi.fn(() => false), end: vi.fn()}));
vi.mock("@/lib/local/runtime", () => ({beginLocalRunStart: mocks.begin, endLocalRunStart: mocks.end}));
vi.mock("@/lib/local/config", async importOriginal => ({...await importOriginal<object>(), selectedRenderMode: () => "local", ensureLocalSessionLayout: () => ({projectDir: "/project"})}));
vi.mock("@/lib/local/session-store", () => ({getLocalSession: () => ({id: "test", model: "claude"})}));
import { handleLocalChatRequest } from "@/lib/local/chat";
it("does not release another request's startup lock when rejecting a duplicate run", async () => {
  const response = await handleLocalChatRequest(new Request("http://localhost/api/chat", {
    method: "POST", body: JSON.stringify({session_id: "test", prompt: "hello"}),
  }));
  expect(await response.text()).toContain("already in progress");
  expect(mocks.begin).toHaveBeenCalledWith("test");
  expect(mocks.end).not.toHaveBeenCalled();
});
