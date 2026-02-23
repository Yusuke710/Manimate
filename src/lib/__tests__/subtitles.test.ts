import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSceneVideoPaths, parseConcatFile } from "../subtitles";

type CommandResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

function createSandbox(options: {
  files?: Record<string, string>;
  run?: (cmd: string) => CommandResult;
}) {
  const files = options.files ?? {};
  const commands: string[] = [];

  const sandbox = {
    files: {
      read: vi.fn(async (path: string) => {
        if (Object.hasOwn(files, path)) {
          return files[path];
        }
        throw new Error(`ENOENT: ${path}`);
      }),
    },
    commands: {
      run: vi.fn(async (cmd: string) => {
        commands.push(cmd);
        const result = options.run?.(cmd) ?? { exitCode: 1, stdout: "", stderr: "" };
        return {
          exitCode: result.exitCode,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        };
      }),
    },
  };

  return {
    sandbox,
    commands,
  };
}

describe("parseConcatFile", () => {
  it("parses single-quoted, double-quoted, and unquoted entries", () => {
    const content = [
      "file 'media/videos/script/480p15/Scene1.mp4'",
      'file "media/videos/script/854p15/Scene2.mp4"',
      "file media/videos/script/854p15/Scene3.mp4",
      "# comment",
      "",
    ].join("\n");

    expect(parseConcatFile(content)).toEqual([
      "media/videos/script/480p15/Scene1.mp4",
      "media/videos/script/854p15/Scene2.mp4",
      "media/videos/script/854p15/Scene3.mp4",
    ]);
  });
});

describe("getSceneVideoPaths", () => {
  const projectPath = "/home/user/sbx";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses concat.txt order when all listed files exist", async () => {
    const concatPath = `${projectPath}/concat.txt`;
    const concatContent = [
      'file "media/videos/script/854p15/Scene2.mp4"',
      "file media/videos/script/854p15/Scene10.mp4",
    ].join("\n");

    const { sandbox, commands } = createSandbox({
      files: {
        [concatPath]: concatContent,
      },
      run: (cmd) => {
        if (cmd.startsWith("test -f ")) {
          return { exitCode: 0 };
        }
        return { exitCode: 1 };
      },
    });

    const paths = await getSceneVideoPaths(sandbox as never, projectPath);

    expect(paths).toEqual([
      "media/videos/script/854p15/Scene2.mp4",
      "media/videos/script/854p15/Scene10.mp4",
    ]);
    expect(commands.some((cmd) => cmd.includes("find \""))).toBe(false);
  });

  it("falls back to deterministic render_subdir from script.py when concat is missing", async () => {
    const scriptPath = `${projectPath}/script.py`;

    const { sandbox } = createSandbox({
      files: {
        [scriptPath]: [
          "from manim import *",
          "config.pixel_height = 854",
          "config.frame_rate = 15",
        ].join("\n"),
      },
      run: (cmd) => {
        if (cmd.includes('-path "*/854p15/*.mp4"')) {
          return {
            exitCode: 0,
            stdout: [
              `${projectPath}/media/videos/script/854p15/Scene10.mp4`,
              `${projectPath}/media/videos/script/854p15/Scene2.mp4`,
            ].join("\n"),
          };
        }
        return { exitCode: 1 };
      },
    });

    const paths = await getSceneVideoPaths(sandbox as never, projectPath);

    expect(paths).toEqual([
      "media/videos/script/854p15/Scene2.mp4",
      "media/videos/script/854p15/Scene10.mp4",
    ]);
  });

  it("falls back to newest render directory when concat is stale", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const concatPath = `${projectPath}/concat.txt`;
    const concatContent = [
      "file 'media/videos/script/480p15/Scene1.mp4'",
      "file 'media/videos/script/480p15/Scene2.mp4'",
    ].join("\n");

    const { sandbox } = createSandbox({
      files: {
        [concatPath]: concatContent,
      },
      run: (cmd) => {
        if (cmd.startsWith("test -f ")) {
          return { exitCode: 1 };
        }
        if (cmd.includes("-printf \"%T@ %p\\n\"")) {
          return {
            exitCode: 0,
            stdout: [
              `1700000002 ${projectPath}/media/videos/script/854p15/Scene2.mp4`,
              `1700000001 ${projectPath}/media/videos/script/854p15/Scene1.mp4`,
              `1699999999 ${projectPath}/media/videos/script/480p15/Scene2.mp4`,
            ].join("\n"),
          };
        }
        return { exitCode: 1 };
      },
    });

    const paths = await getSceneVideoPaths(sandbox as never, projectPath);

    expect(paths).toEqual([
      "media/videos/script/854p15/Scene1.mp4",
      "media/videos/script/854p15/Scene2.mp4",
    ]);
    expect(warnSpy).toHaveBeenCalled();
  });
});
