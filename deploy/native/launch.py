#!/usr/bin/python3
"""Native Linux roles with explicit filesystem grants, no Docker or host login."""
import argparse
import os
import signal
import subprocess
from pathlib import Path


def command(role, root, args=()):
    root = Path(root).resolve(strict=True)
    runtime = root / 'native/runtime'
    node = '/opt/threadbear/runtime/node/bin/node'
    base = ['/usr/bin/bwrap', '--die-with-parent', '--new-session', '--unshare-all',
            '--share-net', '--cap-drop', 'ALL', '--clearenv']
    # No host /home, /mnt, /run, Docker/SSH/WSL interop sockets, or host /proc.
    # PID isolation also prevents /proc/<host pid>/root from bypassing grants.
    for name in ['/usr', '/bin', '/sbin', '/lib', '/lib64']:
        if Path(name).exists(): base += ['--ro-bind', name, name]
    for name in ['ssl', 'resolv.conf', 'hosts', 'nsswitch.conf', 'passwd', 'group', 'localtime']:
        host = Path('/etc') / name
        if host.exists(): base += ['--ro-bind', str(host), str(host)]
    base += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
             '--ro-bind', str(runtime), '/opt/threadbear']
    env = {'PATH': '/opt/threadbear/runtime/node/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8',
           'HOME': '/home/node', 'TMPDIR': '/tmp', 'NPM_CONFIG_UPDATE_NOTIFIER': 'false',
           'NPM_CONFIG_FUND': 'false', 'NPM_CONFIG_AUDIT': 'false'}
    def bind(source, target, readonly=False):
        base.extend(['--ro-bind' if readonly else '--bind', str(root / source), target])
    if role == 'runner':
        bind('runner', '/data'); bind('home', '/home/node'); bind('workspace', '/workspace')
        bind('private/model-token', '/run/secrets/model-token', True)
        env.update(THREADBEAR_HOME='/data', THREADBEAR_PORT='8797', THREADBEAR_BIND='127.0.0.1',
                   THREADBEAR_LOG='/proc/self/fd/2', THREADBEAR_LOG_STDERR='0',
                   THREADBEAR_FOLLOW_MAIN='0', THREADBEAR_CLI_UPDATES='off', THREADBEAR_SENTRY='off',
                   THREADBEAR_TOKEN_TALLY='off', THREADBEAR_MAC_SCREEN='off', THREADBEAR_CONNECTORS_URL='off',
                   THREADBEAR_CLAUDE_PATH='/opt/threadbear/deploy/docker/claude',
                   THREADBEAR_CODEX_PATH='/opt/threadbear/deploy/docker/codex/node_modules/.bin/codex',
                   ANTHROPIC_BASE_URL='http://127.0.0.1:18318', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',
                   DISABLE_TELEMETRY='1', DISABLE_ERROR_REPORTING='1', CLAUDE_CODE_MAX_OUTPUT_TOKENS='16384')
        cwd = '/workspace'
        program = ['/opt/threadbear/deploy/docker/entrypoint.sh', node, '/opt/threadbear/runner/src/main.ts']
    elif role == 'model-relay':
        bind('relay-state', '/state'); bind('private/relay-config.json', '/run/secrets/relay-config', True)
        env.update(THREADBEAR_RELAY_BIND='127.0.0.1', THREADBEAR_RELAY_PORT='18318',
                   THREADBEAR_UPSTREAM_ORIGIN='http://127.0.0.1:8317')
        cwd = '/tmp'; program = [node, '/opt/threadbear/deploy/docker/model-relay.mjs']
    elif role == 'site-edge':
        bind('private/enrollment-auth.json', '/run/secrets/enrollment-auth', True)
        bind('private/enrollment', '/enrollment', True)
        env.update(THREADBEAR_SITE_BIND='127.0.0.1', THREADBEAR_SITE_PORT='13211')
        # Operator-owned file contains only the fixed public Cloud site origin.
        env['THREADBEAR_CLOUD_SITE_ORIGIN'] = (root / 'native/cloud-site-origin').read_text().strip()
        cwd = '/tmp'; program = [node, '/opt/threadbear/deploy/docker/site-edge.mjs']
    elif role == 'cloud-cli':
        bind('cloud/home', '/home/node'); bind('cloud/work', '/work')
        cwd = '/work'
        program = [node, '/opt/threadbear/deploy/native/cloud-command.mjs', *args]
    else:
        raise ValueError('Unknown native role')
    for key, value in env.items(): base += ['--setenv', key, value]
    return base + ['--chdir', cwd, '--', *program]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=['runner', 'model-relay', 'site-edge', 'cloud-cli'])
    parser.add_argument('--root', required=True)
    parser.add_argument('args', nargs=argparse.REMAINDER)
    ns = parser.parse_args()
    # argparse.REMAINDER is intentionally after --root; parse known flags first.
    os.umask(0o077)
    argv = command(ns.role, ns.root, ns.args[1:] if ns.args[:1] == ['--'] else ns.args)
    if ns.role == 'cloud-cli':
        os.execv(argv[0], argv)
    # Keep only three 5 MiB log segments per long-lived service. Output never
    # goes through the journal or the operator's terminal.
    logs = Path(ns.root) / 'native/logs'
    logs.mkdir(mode=0o700, exist_ok=True)
    logfile = logs / (ns.role + '.log')
    child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda signum, frame: child.send_signal(signum) if child.poll() is None else None)
    output = logfile.open('ab', buffering=0)
    try:
        os.chmod(logfile, 0o600)
        while chunk := child.stdout.read1(65536):
            if output.tell() + len(chunk) > 5 * 1024 * 1024:
                output.close()
                logfile.with_suffix('.log.2').unlink(missing_ok=True)
                previous = logfile.with_suffix('.log.1')
                if previous.exists(): previous.rename(logfile.with_suffix('.log.2'))
                logfile.rename(previous)
                output = logfile.open('ab', buffering=0)
                os.chmod(logfile, 0o600)
            output.write(chunk)
    finally:
        output.close()
    raise SystemExit(child.wait())
