import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ derive: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/local/config", () => ({getLocalSessionPaths: () => ({projectDir: "/project"})}));
vi.mock("@/lib/local/session-store", () => ({getLocalSession: () => ({id: "test"})}));
vi.mock("@/lib/local/voiceover", () => ({readLocalProjectSubtitles: mocks.derive}));
vi.mock("node:fs/promises", () => ({default: {readFile: mocks.read, writeFile: mocks.write}}));
import { GET } from "./route";
beforeEach(() => { vi.resetAllMocks(); });
const request = () => new NextRequest("http://localhost/api/subtitles?session_id=test");
it("serves supplied subtitles when source narration and clips are absent", async () => {
  mocks.derive.mockResolvedValue(null);
  mocks.read.mockResolvedValue("1\n00:00:00,000 --> 00:00:01,000\nHello\n");
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Hello");
  expect(mocks.write).not.toHaveBeenCalled();
});
it("prefers fresh derived subtitles over a saved copy", async () => {
  mocks.derive.mockResolvedValue("new subtitles");
  mocks.read.mockResolvedValue("old subtitles");
  mocks.write.mockResolvedValue(undefined);
  expect(await (await GET(request())).text()).toBe("new subtitles");
  expect(mocks.write).toHaveBeenCalledWith("/project/subtitles.srt", "new subtitles", "utf8");
});
it("returns 404 when neither derived nor saved subtitles exist", async () => {
  mocks.derive.mockResolvedValue(null);
  mocks.read.mockRejectedValue(new Error("missing"));
  expect((await GET(request())).status).toBe(404);
});
