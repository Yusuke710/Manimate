// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ChatInput from "./ChatInput";

it("releases attachment preview URLs on send and unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let unmounted = false;
  try {
    await act(async () => root.render(createElement(ChatInput, {onSend: vi.fn()})));
    const add = () => window.dispatchEvent(new CustomEvent("chat-add-image", {detail: new File(["test"], "notes.txt", {type: "text/plain"})}));
    await act(async () => {add();});
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => {container.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!.click();});
    expect(revoke).toHaveBeenCalledWith("blob:first");
    await act(async () => {add();});
    await act(async () => root.unmount());
    unmounted = true;
    expect(revoke).toHaveBeenCalledWith("blob:second");
  } finally {
    if (!unmounted) await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
