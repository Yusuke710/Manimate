import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { select, isCancel } from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function setupRendering({ force = false, env = process.env, run = spawnSync, input = process.stdin, output = process.stderr } = {}) {
  const root = env.MANIMATE_LOCAL_ROOT || path.join(os.homedir(), '.manimate');
  const configPath = path.join(root, 'config.json');
  env.PATH = [path.join(root, 'tools/bin'), path.join(os.homedir(), '.local/bin'), '/Library/TeX/texbin', env.PATH].filter(Boolean).join(path.delimiter);
  let config;
  try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; config = {}; }
  let mode = env.MANIMATE_RENDER_MODE || config.render_mode;
  if (mode && !['local', 'cloud'].includes(mode)) throw new Error('Render mode must be local or cloud.');
  if (mode && !force) {
    if (mode === 'local') {
      const version = run('manim', ['--version'], { env, encoding: 'utf8', timeout: 30000 });
      if (version.status !== 0 || !version.stdout?.split(/\r?\n/).includes('Manim Community v0.21.0')) {
        output.write('Local rendering requires Manim 0.21.0. Updating…\n');
        const installed = run('bash', [fileURLToPath(new URL('./setup-dependencies.sh', import.meta.url)), 'local'], { env, stdio: 'inherit' });
        if (installed.error || installed.status !== 0) throw new Error('Manim 0.21.0 setup did not complete. Check the output above and run manimate again.');
        return true;
      }
    }
    return false;
  }
  if (!input.isTTY || !output.isTTY) throw new Error('Run manimate in a terminal to choose Local or Cloud and finish setup.');
  if (force && env.MANIMATE_RENDER_MODE) throw new Error('Unset MANIMATE_RENDER_MODE before changing rendering with --setup.');
  output.write('\n∑ Manimate\n\n');
  mode = await select({
    message: 'Select a rendering environment:',
    options: [
      { value: 'local', label: 'Local — Install Manim and render on this machine' },
      { value: 'cloud', label: 'Cloud — Connect to Manim-Cloud' },
    ],
    initialValue: mode || 'local',
    input,
    output,
  });
  if (isCancel(mode)) throw new Error('Setup cancelled.');
  const execute = (command, args, capture = false) => {
    const result = run(command, args, { env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`${command} did not complete. ${result.error?.message || 'Check the output above and run manimate again.'}`);
    return result.stdout;
  };
  // Check the cloud client before installing shared native dependencies.
  if (mode === 'cloud') {
    const result = run('manim-cloud', ['auth-status'], { env, encoding: 'utf8', timeout: 35000 });
    if (result.error?.code === 'ENOENT') throw new Error('Install the Manim Cloud CLI first: https://github.com/Yusuke710/manim-cloud#use-the-cli');
    let connected = false;
    try { connected = result.status === 0 && JSON.parse(result.stdout).status === 'connected'; } catch {}
    if (!connected) {
      output.write('\nOpening Google sign-in…\n');
      execute('manim-cloud', ['login']);
      const status = JSON.parse(execute('manim-cloud', ['auth-status'], true));
      if (status.status !== 'connected') throw new Error('Google sign-in did not finish. Run manimate again.');
    }
  }
  execute('bash', [fileURLToPath(new URL('./setup-dependencies.sh', import.meta.url)), mode]);
  // Preserve unrelated settings; only save the selection after successful setup.
  try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ ...config, render_mode: mode }, null, 2) + '\n');
  output.write(`\n${mode === 'local' ? 'Local' : 'Cloud'} rendering is ready.\n`);
  return true;
}
