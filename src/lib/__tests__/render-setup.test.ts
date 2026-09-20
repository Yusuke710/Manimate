import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { setupRendering } from '../../../scripts/render-setup.mjs';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(answer: string, fail = false) {
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
    return { status: fail ? 1 : 0, stdout: JSON.stringify({ status: loggedIn ? 'connected' : 'disconnected' }) };
  };
  return { root, calls, options: { env: { MANIMATE_LOCAL_ROOT: root, PATH: process.env.PATH }, input, output, run } };
}
it('local setup installs dependencies without OAuth and preserves settings', async () => {
  const f = await fixture('\r'); await setupRendering(f.options);
  expect(f.calls).toHaveLength(1); expect(f.calls[0][0]).toBe('bash'); expect(f.calls[0].at(-1)).toBe('local');
  expect(JSON.parse(await fs.readFile(path.join(f.root, 'config.json'), 'utf8'))).toEqual({ keep: 42, render_mode: 'local' });
});
it('cloud setup waits for login and verifies it before saving', async () => {
  const f = await fixture('\u001b[B\r'); await setupRendering(f.options);
  expect(f.calls.map(c => c[1])).toEqual(['auth-status', 'login', 'auth-status', expect.stringContaining('setup-dependencies.sh')]);
  expect(f.calls.at(-1)?.at(-1)).toBe('cloud');
});
it('failed setup leaves the mode unset', async () => {
  const f = await fixture('\r', true); await expect(setupRendering(f.options)).rejects.toThrow('did not complete');
  expect(JSON.parse(await fs.readFile(path.join(f.root, 'config.json'), 'utf8'))).toEqual({ keep: 42 });
});
it('noninteractive fresh startup fails with instructions instead of hanging', async () => {
  const f = await fixture('\r'); f.options.input.isTTY = false;
  await expect(setupRendering(f.options)).rejects.toThrow('Run manimate in a terminal');
  expect(f.calls).toEqual([]);
});
it('configured startup does not prompt or reinstall', async () => {
  const f = await fixture('\r'); await fs.writeFile(path.join(f.root, 'config.json'), '{"render_mode":"local"}');
  expect(await setupRendering(f.options)).toBe(false); expect(f.calls).toEqual([['manim', '--version']]);
});

it('arrow keys only choose after Enter', async () => {
  const f = await fixture('\u001b[B');
  const pending = setupRendering(f.options);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(f.calls).toEqual([]);
  f.options.input.write('\u001b[A\r');
  await pending;
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].at(-1)).toBe('local');
});
it('Ctrl+C cancels without installing or saving a mode', async () => {
  const f = await fixture('\u0003');
  await expect(setupRendering(f.options)).rejects.toThrow('Setup cancelled');
  expect(f.calls).toEqual([]);
  expect(JSON.parse(await fs.readFile(path.join(f.root, 'config.json'), 'utf8'))).toEqual({ keep: 42 });
});

it('upgrades an older Manim on configured local startup', async () => {
  const f = await fixture('\r');
  await fs.writeFile(path.join(f.root, 'config.json'), '{"render_mode":"local"}');
  f.options.run = (cmd, args) => { f.calls.push([cmd, ...args]); return { status: 0, stdout: 'Manim Community v0.19.1\n' }; };
  expect(await setupRendering(f.options)).toBe(true);
  expect(f.calls[1][0]).toBe('bash');
  expect(f.calls[1].at(-1)).toBe('local');
});
