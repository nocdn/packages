#!/usr/bin/env python3
"""Optional macOS/Linux terminal tests; Python is only the test driver.

Each case creates disposable stores and replaces pbcopy with a temporary file
writer. This never reads real chats or writes the real system clipboard.
"""
import argparse
import errno
import fcntl
import hashlib
import json
import os
import pty
import re
import select
import shlex
import shutil
import signal
import sqlite3
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
ANSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")


def run_case(runtime, picker, provider, *, cancel=None, refresh=False, rapid=False, immediate=False, cli=None):
    name = f"{Path(runtime).name}:{picker}:{provider}:{cancel or ('refresh' if refresh else 'copy')}{':rapid' if rapid else ''}{':immediate-enter' if immediate else ''}"
    with tempfile.TemporaryDirectory(prefix="chat-ts-pty-") as directory:
        root = Path(directory)
        options = json.loads(subprocess.check_output([runtime, str(PACKAGE / 'scripts/make-fixture.js'), str(root)], text=True))
        copied = root / "clipboard bytes.txt"
        fake_bin = root / "bin"
        fake_bin.mkdir()
        pbcopy = fake_bin / "pbcopy"
        pbcopy.write_text("#!/bin/sh\n/bin/cat > " + shlex.quote(str(copied)) + "\n")
        pbcopy.chmod(0o700)
        hook = root / "UNEXPECTED-HOOK"
        env = os.environ.copy()
        env.update({
            "TERM": "xterm-256color",
            "CODEX_HOME": options['codexHome'],
            "XDG_DATA_HOME": str(root / 'data'),
            "T3CODE_HOME": str(root / 't3'),
            "PATH": str(fake_bin) if picker == 'auto-fallback' else str(fake_bin) + os.pathsep + env['PATH'],
            "FZF_DEFAULT_OPTS": "--bind=start:execute(touch " + str(hook) + ")",
            "FZF_DEFAULT_OPTS_FILE": str(root / 'MUST-NOT-BE-READ'),
        })
        if cancel == 'source':
            env['CODEX_HOME'] = str(root / 'ABSENT-CODEX')
            env['XDG_DATA_HOME'] = str(root / 'ABSENT-DATA')
            env['T3CODE_HOME'] = str(root / 'ABSENT-T3')
        argv = [runtime, str(cli or PACKAGE / 'bin/cli.js'), '--picker', 'auto' if picker == 'auto-fallback' else picker]
        pid, fd = pty.fork()
        if pid == 0:
            os.execve(runtime, argv, env)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 35, 170, 0, 0))
        output = bytearray()
        started = time.monotonic()
        ready = 0
        stage = 0
        native = picker == 'fzf'
        expected = ('Codex question 🦉\n\n\n\nBefore ' + options['phrase'] + ' after') if provider == 'codex' else ('OpenCode question 🦉\n\n\n\nOpenCode answer' if provider == 'opencode' else 'T3 question 🦉\n\n\n\nT3 answer')
        db_path = Path(options['t3CodeDb'] if provider == 't3code' else options['openCodeDb'])
        db_before = hashlib.sha256(db_path.read_bytes()).hexdigest()
        try:
            while time.monotonic() - started < 25:
                readable, _, _ = select.select([fd], [], [], 0.05)
                if readable:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise
                        chunk = b''
                    output.extend(chunk)
                    if b'\x1b[6n' in chunk:
                        os.write(fd, b'\x1b[1;1R')
                cleaned = ANSI.sub(b'', bytes(output))
                if stage == 0 and b'Chat source' in cleaned:
                    if cancel == 'source':
                        os.write(fd, b'\x1b')
                        stage = 4
                    else:
                        if native:
                            os.write(fd, {'codex': 'Codex', 'opencode': 'OpenCode', 't3code': 'T3 Code'}[provider].encode())
                        else:
                            os.write(fd, b'\x1b[B' * ['codex', 'opencode', 't3code'].index(provider))
                        ready = time.monotonic() + 0.2
                        stage = 1
                if stage == 1 and time.monotonic() >= ready:
                    os.write(fd, b'\r')
                    stage = 2
                marker = ({'codex': 'Codex', 'opencode': 'OpenCode', 't3code': 'T3 Code'}[provider] + ' conversation').encode()
                if stage == 2 and marker in cleaned and immediate:
                    ready = time.monotonic() + 0.4
                    stage = 5
                if (stage == 2 and marker in cleaned and not immediate) or (stage == 5 and time.monotonic() >= ready):
                    if cancel == 'chat':
                        os.write(fd, b'\x1b')
                        stage = 4
                    else:
                        query = ('"' + options['phrase'] + '"') if provider == 'codex' else ('opencodequestion' if provider == 'opencode' else 't3question')
                        # A paste is one edit; a separate case types all keys
                        # rapidly to exercise delayed-search acceptance.
                        if native and not rapid:
                            os.write(fd, b'\x1b[200~' + query.encode() + b'\x1b[201~')
                        else:
                            os.write(fd, query.encode())
                        if immediate:
                            os.write(fd, b'\r')
                        ready = time.monotonic() + (1.2 if rapid else 0.8)
                        stage = 3
                if stage == 3 and time.monotonic() >= ready:
                    # The picker shows a preview of the highlighted chat.
                    assert '\u258dYou'.encode() in cleaned, (name, 'preview missing', bytes(output[-1600:]))
                    if immediate and copied.exists():
                        assert copied.read_bytes() == expected.encode(), 'stale selection was copied'
                    if refresh and provider == 'codex':
                        store = Path(options['codexHome'])
                        (store / 'archived_sessions').mkdir()
                        (store / 'sessions/main.jsonl').rename(store / 'archived_sessions/main.jsonl')
                        rows = [
                            {"type":"session_meta","payload":{"id":"main","timestamp":"2026-09-02T10:00:00Z","cwd":"/test/project"}},
                            {"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","content":[{"text":"Added during picker"}]}}},
                        ]
                        (store / 'sessions/new.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows))
                        expected += '\n\n\n\nAdded during picker'
                    elif refresh and provider == 'opencode':
                        with sqlite3.connect(db_path) as db:
                            db.execute('UPDATE part SET data=? WHERE id=?', (json.dumps({"type":"text","text":"OpenCode answer updated during picker"}), 'a1'))
                        expected += ' updated during picker'
                    elif refresh:
                        with sqlite3.connect(db_path) as db:
                            db.execute("UPDATE projection_thread_messages SET text=? WHERE message_id=?", ('T3 answer updated during picker', 'a1'))
                        expected += ' updated during picker'
                    os.write(fd, b'\r')
                    stage = 4
                finished, status = os.waitpid(pid, os.WNOHANG)
                if finished:
                    break
            else:
                raise AssertionError(f'{name}: timeout stage={stage}; tail={bytes(output[-1600:])!r}')
            code = os.waitstatus_to_exitcode(status)
            if cancel:
                assert code == 130, (name, code, bytes(output[-900:]))
                assert not copied.exists(), 'clipboard was invoked on cancellation'
            else:
                assert code == 0, (name, code, bytes(output[-1400:]))
                assert copied.read_bytes() == expected.encode(), (name, 'incorrect clipboard bytes')
            assert not hook.exists(), 'inherited fzf command hook was executed'
            if not refresh or provider == 'codex':
                assert hashlib.sha256(db_path.read_bytes()).hexdigest() == db_before, 'fixture database changed'
            print(json.dumps({'case':name,'passed':True,'exit':code,'seconds':round(time.monotonic()-started,3)}), flush=True)
        finally:
            try:
                ended, _ = os.waitpid(pid, os.WNOHANG)
                if not ended:
                    os.kill(pid, signal.SIGINT)
                    os.waitpid(pid, 0)
            except ChildProcessError:
                pass
            os.close(fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', choices=['node','bun'], action='append')
    parser.add_argument('--picker', choices=['fzf','auto-fallback'], action='append')
    parser.add_argument('--cli', type=Path)
    parser.add_argument('--provider', choices=['codex', 'opencode', 't3code'], action='append')
    args = parser.parse_args()
    for runtime_name in args.runtime or ['node','bun']:
        runtime = shutil.which(runtime_name)
        if not runtime:
            raise SystemExit(f'{runtime_name} is not installed')
        for picker in args.picker or ['fzf','auto-fallback']:
            for provider in args.provider or ['codex','opencode','t3code']:
                run_case(runtime,picker,provider,refresh=True,cli=args.cli)
            run_case(runtime,picker,'codex',cancel='source',cli=args.cli)
            run_case(runtime,picker,'opencode',cancel='chat',cli=args.cli)
        run_case(runtime,(args.picker or ['fzf'])[0],'codex',rapid=True,cli=args.cli)
        if not args.picker or 'auto-fallback' in args.picker:
            run_case(runtime,'auto-fallback','codex',immediate=True,cli=args.cli)
