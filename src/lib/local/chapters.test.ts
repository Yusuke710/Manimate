import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getLocalSceneVideoPaths, readLocalProjectChapters } from './chapters';
import { normalizeChaptersToVideoDuration } from '@/lib/timeline';

let root: string;
async function write(name: string, contents: string) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}
function video(name: string, duration: number, color = 'blue') {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=32x32:r=10`, '-t', String(duration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, name)]);
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'manimate-chapters-'));
  await fs.mkdir(path.join(root, 'clips'));
  // Arbitrary Manim class names and declaration order must not set playback order.
  await write('script.py', 'from manim import *\nclass Apple(Scene):\n    pass\nclass ZebraOrbit(Scene):\n    pass\n');
  video('clips/ZebraOrbit.mp4', 2, 'red');
  video('clips/Apple.mp4', 3);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('detects an arbitrary manifest name and nested relative paths in assembly order', async () => {
  await write('edits/assembly.data', "ffconcat version 1.0\nfile '../clips/ZebraOrbit.mp4'\nfile '../clips/Apple.mp4'\n");
  expect(await readLocalProjectChapters(root)).toEqual([
    { name: 'Zebra Orbit', start: 0, duration: 2 },
    { name: 'Apple', start: 2, duration: 3 },
  ]);
});
it('does not guess order from Python classes or alphabetically sorted media', async () => {
  expect(await getLocalSceneVideoPaths(root)).toEqual([]);
  expect(await readLocalProjectChapters(root)).toEqual([]);
});
it('rejects incomplete lists instead of silently dropping missing clips', async () => {
  await write('list.txt', "file 'clips/ZebraOrbit.mp4'\nfile 'missing.mp4'\nfile 'clips/Apple.mp4'\n");
  expect(await readLocalProjectChapters(root)).toEqual([]);
});
it('deduplicates identical lists but rejects competing orders', async () => {
  const list = "file 'clips/ZebraOrbit.mp4'\nfile 'clips/Apple.mp4'\n";
  await write('list.txt', list);
  await write('concat.txt', list);
  expect(await readLocalProjectChapters(root)).toHaveLength(2);
  await write('concat.txt', "file 'clips/Apple.mp4'\nfile 'clips/ZebraOrbit.mp4'\n");
  expect(await readLocalProjectChapters(root)).toEqual([]);
});
it('invalidates cached durations when a clip is regenerated', async () => {
  await write('list.txt', "file 'clips/ZebraOrbit.mp4'\nfile 'clips/Apple.mp4'\n");
  expect((await readLocalProjectChapters(root))[1].start).toBe(2);
  video('clips/ZebraOrbit.mp4', 4, 'red');
  expect((await readLocalProjectChapters(root))[1].start).toBe(4);
});
it('rejects trimming directives rather than calculating wrong chapter boundaries', async () => {
  await write('list.txt', "file 'clips/ZebraOrbit.mp4'\noutpoint 1\nfile 'clips/Apple.mp4'\n");
  expect(await readLocalProjectChapters(root)).toEqual([]);
});

it('lets the existing UI map a uniformly sped-up video onto clip durations', async () => {
  await write('list.txt', "file 'clips/ZebraOrbit.mp4'\nfile 'clips/Apple.mp4'\n");
  const chapters = await readLocalProjectChapters(root);
  const timeline = normalizeChaptersToVideoDuration(chapters, 2.5);
  expect(timeline?.chapters).toEqual([
    {name: 'Zebra Orbit', start: 0, duration: 1},
    {name: 'Apple', start: 1, duration: 1.5},
  ]);
});
it('invalidates cached chapters when only the assembly order changes', async () => {
  await write('list.txt', "file 'clips/ZebraOrbit.mp4'\nfile 'clips/Apple.mp4'\n");
  expect((await readLocalProjectChapters(root))[0].name).toBe('Zebra Orbit');
  await write('list.txt', "file 'clips/Apple.mp4'\nfile 'clips/ZebraOrbit.mp4'\n");
  expect((await readLocalProjectChapters(root))[0].name).toBe('Apple');
});
