import { afterEach, describe, expect, it, vi } from "vitest";

import { generateTTSForCaption, getTTSModelCandidates } from "../elevenlabs";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("generateTTSForCaption fallback behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to turbo model on quota_exceeded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(401, {
          detail: {
            status: "quota_exceeded",
            message: "This request exceeds your quota",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "x-character-count": "12" },
        })
      );

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await generateTTSForCaption("hello", "test-key", "voice-id");

    expect(result.modelIdUsed).toBe("eleven_turbo_v2_5");
    expect(result.characterCount).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(firstBody.model_id).toBe("eleven_flash_v2_5");
    expect(secondBody.model_id).toBe("eleven_turbo_v2_5");
  });

  it("throws when all candidate models return quota_exceeded", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse(401, {
        detail: {
          status: "quota_exceeded",
          message: "This request exceeds your quota",
        },
      })
    );

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await expect(generateTTSForCaption("hello", "test-key", "voice-id")).rejects.toThrow(
      /exceeds your quota/i
    );
  });

  it("returns ordered unique model candidates", () => {
    expect(getTTSModelCandidates()).toEqual([
      "eleven_flash_v2_5",
      "eleven_turbo_v2_5",
      "eleven_multilingual_v2",
    ]);
    expect(getTTSModelCandidates("eleven_turbo_v2_5")).toEqual([
      "eleven_turbo_v2_5",
      "eleven_multilingual_v2",
    ]);
  });
});
