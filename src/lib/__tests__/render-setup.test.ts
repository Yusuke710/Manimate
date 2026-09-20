import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { setupRendering } from '../../../scripts/render-setup.mjs';
// The injected streams and process runner are deliberately minimal test doubles.
const configure = setupRendering as unknown as (options: Awaited<ReturnType<typeof fixture>>["options"]) => Promise<boolean>;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(answer: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manimate-setup-')); roots.push(root);
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ keep: 42 }));
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  let sent = false;
  const output = Object.assign(new Writable({ write(chunk, _encoding, callback) {
    if (!sent && chunk.toString().includes('Select a rendering environment:')) { sent = true; setTimeout(() => input.write(answer), 5); }
    callback();
  } }), { isTTY: true });
  const calls: string[][] = [];
  let loggedIn = false;
  const run = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'login') loggedIn = true;
    if (cmd === 'manim') return { status: 0, stdout: 'Manim Community v0.21.0\n' };
    return { status: 0, stdout: JSON.stringify({ status: loggedIn ? 'connected' : 'disconnected' }) };
  };
  return { root, calls, options: { env: { MANIMATE_LOCAL_ROOT: root, PATH: process.env.PATH }, input, output, run } };
}
it('local setup installs dependencies without OAuth and preserves settings', async () => {
  const f = await fixture('\r'); await configure(f.options);
  expect(f.calls).toHaveLength(1); expect(f.calls[0][0]).toBe('bash'); expect(f.calls[0].at(-1)).toBe('local');
  expect(JSON.parse(await fs.readFile(path.join(f.root, 'config.json'), 'utf8'))).toEqual({ keep: 42, render_mode: 'local' });
});
it('cloud setup waits for login and verifies it before saving', async () => {
  const f = await fixture('\u001b[B\r');
  const run = f.options.run;
  f.options.run = (cmd, args) => {
    expect(JSON.parse(readFileSync(path.join(f.root, 'config.json'), 'utf8')).render_mode).toBeUndefined();
    return run(cmd, args);
  };
  await configure(f.options);
  expect(JSON.parse(await fs.readFile(path.join(f.root, 'config.json'), 'utf8'))).toEqual({keep: 42, render_mode: 'cloud'});
  expect(f.calls).toContainEqual(['manim-cloud', 'login']);
  expect(f.calls.at(-1)?.at(-1)).toBe('cloud');
});
it('failed setup leaves the mode unset', async () => {
  const f = await fixture('\u001b[B\r');
  f.options.run = () => ({status: 0, stdout: JSON.stringify({status: 'disconnected'})});
  await expect(configure(f.options)).rejects.toThrow('Google sign-in did not finish');
  expect(JSON.parse(await fs.readFile(path.join(f.root, 'config.json'), 'utf8'))).toEqual({ keep: 42 });
});
