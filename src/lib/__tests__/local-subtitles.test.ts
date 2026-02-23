import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../local/command", () => ({
  runLocalCommand: vi.fn(),
}));

import { runLocalCommand } from "../local/command";
import { readLocalProjectSubtitles } from "../local/subtitles";

const mockedRunLocalCommand = vi.mocked(runLocalCommand);
const tempDirs: string[] = [];

async function makeProjectDir(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "manimate-local-subtitles-"));
  tempDirs.push(root);
  await fsp.mkdir(root, { recursive: true });
  return root;
}

afterEach(async () => {
  mockedRunLocalCommand.mockReset();
  await Promise.all(
    tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true }))
  );
});

describe("readLocalProjectSubtitles", () => {
  it("returns project/subtitles.srt when available", async () => {
    const projectDir = await makeProjectDir();
    const subtitlePath = path.join(projectDir, "subtitles.srt");
    const content = "1\n00:00:00,000 --> 00:00:01,000\nRoot subtitle\n";
    await fsp.writeFile(subtitlePath, content);

    const result = await readLocalProjectSubtitles(projectDir);
    expect(result).toBe(content);
    expect(mockedRunLocalCommand).not.toHaveBeenCalled();
  });

  it("concatenates scene subtitles from concat.txt with duration offsets", async () => {
    const projectDir = await makeProjectDir();
    const scene1Video = path.join(projectDir, "scene1.mp4");
    const scene2Video = path.join(projectDir, "scene2.mp4");
    await fsp.writeFile(scene1Video, "");
    await fsp.writeFile(scene2Video, "");
    await fsp.writeFile(
      path.join(projectDir, "scene1.srt"),
      "1\n00:00:00,000 --> 00:00:01,000\nScene one\n"
    );
    await fsp.writeFile(
      path.join(projectDir, "scene2.srt"),
      "1\n00:00:00,500 --> 00:00:01,500\nScene two\n"
    );
    await fsp.writeFile(
      path.join(projectDir, "concat.txt"),
      "file scene1.mp4\nfile scene2.mp4\n"
    );

    mockedRunLocalCommand.mockImplementation(async (input) => {
      const target = input.args[input.args.length - 1];
      if (target.endsWith("scene1.mp4")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ format: { duration: "2.0" } }),
          stderr: "",
        };
      }
      if (target.endsWith("scene2.mp4")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ format: { duration: "3.0" } }),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "missing" };
    });

    const result = await readLocalProjectSubtitles(projectDir);

    expect(result).toBe(
      [
        "1",
        "00:00:00,000 --> 00:00:01,000",
        "Scene one",
        "",
        "2",
        "00:00:02,500 --> 00:00:03,500",
        "Scene two",
        "",
      ].join("\n")
    );
  });

  it("returns null when no subtitle sources exist", async () => {
    const projectDir = await makeProjectDir();
    const result = await readLocalProjectSubtitles(projectDir);
    expect(result).toBeNull();
  });
});
