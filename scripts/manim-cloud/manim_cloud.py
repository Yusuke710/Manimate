#!/usr/bin/env python3
"""Manim-style entry point for the remote rendering service."""
import argparse
import json
import os
from pathlib import Path
import sys
import render
import cloud_auth

EXCLUDED = {'media', 'partial_movie_files', '__pycache__', 'node_modules', 'venv', 'env', 'dist', 'build'}


def bundle(root, includes=()):
    """Select project Python/config and assets without executing scene code."""
    root = root.resolve()
    selected = {}

    def add(path):
        if not path.resolve().is_relative_to(root):
            raise ValueError(f'File points outside project: {path.relative_to(root)}. Copy it into the project first.')
        if not path.is_file():
            raise ValueError(f'Not a regular file: {path}')
        selected[path.relative_to(root).as_posix()] = path

    def walk(folder, explicit=False):
        for current, dirs, names in os.walk(folder, followlinks=False):
            current = Path(current)
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in EXCLUDED)
            for d in dirs:
                if (current / d).is_symlink():
                    raise ValueError(f'Symlink directory is not supported: {(current / d).relative_to(root)}. Copy it into the project first.')
            for name in sorted(names):
                if name.startswith('.'):
                    continue
                path = current / name
                in_assets = 'assets' in path.relative_to(root).parts[:-1]
                if explicit or in_assets or path.suffix == '.py' or name == 'manim.cfg':
                    add(path)

    walk(root)
    for name in includes:
        path = root / name
        if not path.resolve().is_relative_to(root):
            raise ValueError('--remote-include must point inside the project root')
        if path.is_dir():
            walk(path, explicit=True)
        else:
            add(path)
    if len(selected) > 128:
        raise ValueError(f'Bundle has {len(selected)} files (maximum 128). Run from a smaller scene project, or use render.py for explicit file selection.')
    # Reject oversize bundles before reading/encoding all files.
    estimate = sum(4 * ((p.stat().st_size + 2) // 3) + len(n.encode()) + 32 for n, p in selected.items())
    if estimate > render.MAX_BODY - 65536:
        raise ValueError('Bundle exceeds the 12 MiB request limit. Use a smaller assets folder or render.py for explicit file selection.')
    return selected


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ['restore-session']:
        if len(argv) != 3:
            raise ValueError('Usage: manim-cloud restore-session ID SESSIONS_DIRECTORY')
        from session_download import restore_session
        restore_session(argv[1], argv[2])
        return 0
    if argv == ['library']:
        settings = render.config()
        base = settings.get('RENDER_URL', 'https://cloud.manimate.ai').rstrip('/')
        bearer = cloud_auth.token(base) if cloud_auth.load(base) else settings.get('RENDER_TOKEN')
        if not bearer:
            raise RuntimeError('Run manim-cloud login first.')
        print(json.dumps(render.request(base + '/videos', bearer)))
        return 0
    if argv[:1] == ['upload-session']:
        if len(argv) != 2:
            raise ValueError('Usage: manim-cloud upload-session SESSION_DIRECTORY')
        from session_upload import upload_session
        upload_session(argv[1])
        return 0
    if argv in (['login'], ['auth-status']):
        settings = render.config()
        base = settings.get('RENDER_URL', 'https://cloud.manimate.ai').rstrip('/')
        if argv == ['login']:
            cloud_auth.login(base)
        else:
            bearer = cloud_auth.token(base) if cloud_auth.load(base) else settings.get('RENDER_TOKEN')
            if not bearer:
                print(json.dumps({'status': 'disconnected'}))
            else:
                account = render.request(base + '/account', bearer)
                print(json.dumps({'status': 'connected', 'user_email': account.get('email')}))
        return 0
    parser = argparse.ArgumentParser(prog='manim-cloud', add_help=False, allow_abbrev=False)
    parser.add_argument('--remote-root', default='.')
    parser.add_argument('--remote-include', action='append', default=[])
    parser.add_argument('--remote-dry-run', action='store_true')
    args, command = parser.parse_known_args(argv)
    if not command or '--help' in command or '-h' in command:
        print('''Usage: manim-cloud [remote options] [manim arguments]

  manim-cloud login
  manim-cloud -ql scene.py Scene1
  manim-cloud -qk scene.py Scene1
  manim-cloud --remote-include audio/voice.wav -ql scene.py Scene1

Automatically sends Python files, manim.cfg, and assets/ beneath the current
working directory, preserving relative paths. Hidden files, media/, caches,
environments, build output and node_modules are excluded.

Remote options:
  --remote-root DIR       Project directory (default: current directory)
  --remote-include PATH   Include an additional file/directory; repeat as needed
  --remote-dry-run        Show command and filenames without uploading/rendering

Other arguments go to Manim Community 0.21.0. Absolute Mac asset paths are not
available remotely. Use project-relative paths. Desktop preview (-p/--preview)
returns a video URL instead of opening a local player. Confirmed SIGTERM/SIGKILL
interruptions retry at most twice; scene code must be safe to repeat.

Prints result JSON with files[].url. Run manim-cloud login for Google sign-in.
Service owners can also configure RENDER_URL / RENDER_TOKEN in .env or the environment. Download with curl -fL URL -o scene.mp4.''')
        return 0
    if command[0] == '--':
        command = command[1:]
    # Preview is represented by the returned URL in a headless remote runtime.
    preview = False
    forwarded_command = []
    for arg in command:
        if arg in ('-p', '--preview'):
            preview = True
            continue
        if arg.startswith('-') and not arg.startswith('--') and 'p' in arg[1:] and all(c in 'pqlmhk' for c in arg[1:]):
            preview = True
            arg = '-' + arg[1:].replace('p', '')
        forwarded_command.append(arg)
    command = forwarded_command
    root = Path(args.remote_root).resolve()
    if not root.is_dir():
        raise ValueError(f'Project directory does not exist: {root}')
    for i, arg in enumerate(command):
        if arg.endswith('.py') and not arg.startswith('-'):
            path = (root / arg).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError(f'Scene file must exist inside project root: {arg}')
            command[i] = path.relative_to(root).as_posix()
    selected = bundle(root, args.remote_include)
    if args.remote_dry_run:
        print(json.dumps({'root': str(root), 'command': ['manim', *command], 'files': sorted(selected), 'input_bytes': sum(p.stat().st_size for p in selected.values())}, indent=2))
        return 0
    # Reuse the existing submission, idempotency, polling and credential handling.
    print(f'Uploading {len(selected)} files from {root}', file=sys.stderr)
    if preview:
        print('Remote preview: use the video URL in the result.', file=sys.stderr)
    forwarded = ['--retry-interrupted', '--dir', str(root)]
    for name in sorted(selected):
        forwarded.extend(['--file', name])
    return render.main([*forwarded, '--', 'manim', *command])


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
