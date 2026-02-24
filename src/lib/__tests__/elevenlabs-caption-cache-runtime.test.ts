import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generateTTSForCaptionWithCache } from "../elevenlabs";

const tempDirs: string[] = [];

function makeAudioResponse(bytes: number, characterCount: number): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "x-character-count": String(characterCount) },
  });
}

async function makeCacheDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "manimate-elevenlabs-cache-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true }))
  );
});

describe("generateTTSForCaptionWithCache", () => {
  it("caches generated caption audio and reuses it on repeat calls", async () => {
    const cacheDir = await makeCacheDir();
    const fetchMock = vi.fn().mockResolvedValue(makeAudioResponse(256, 11));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const first = await generateTTSForCaptionWithCache(
      "Hello world",
      "test-key",
      "voice-id",
      cacheDir
    );
    const second = await generateTTSForCaptionWithCache(
      "Hello world",
      "test-key",
      "voice-id",
      cacheDir
    );

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(first.cachePath).toBe(second.cachePath);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("regenerates only captions whose text changed", async () => {
    const cacheDir = await makeCacheDir();
    const fetchMock = vi.fn().mockImplementation(async () => makeAudioResponse(256, 9));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const firstA = await generateTTSForCaptionWithCache(
      "Caption A",
      "test-key",
      "voice-id",
      cacheDir
    );
    const firstB = await generateTTSForCaptionWithCache(
      "Caption B",
      "test-key",
      "voice-id",
      cacheDir
    );
    const secondA = await generateTTSForCaptionWithCache(
      "Caption A",
      "test-key",
      "voice-id",
      cacheDir
    );

    expect(firstA.cached).toBe(false);
    expect(firstB.cached).toBe(false);
    expect(secondA.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats tiny cache files as corrupt and regenerates audio", async () => {
    const cacheDir = await makeCacheDir();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeAudioResponse(256, 9))
      .mockResolvedValueOnce(makeAudioResponse(256, 9));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const first = await generateTTSForCaptionWithCache(
      "Corrupt cache test",
      "test-key",
      "voice-id",
      cacheDir
    );
    await fsp.writeFile(first.cachePath, Buffer.from([1, 2, 3]));

    const second = await generateTTSForCaptionWithCache(
      "Corrupt cache test",
      "test-key",
      "voice-id",
      cacheDir
    );

    expect(second.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
