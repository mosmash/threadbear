"""Integration proofs for the actual native filesystem/credential boundary."""
import importlib.util
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launch.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class NativeBoundary(unittest.TestCase):
    def test_each_role_sees_only_its_state_and_no_host_home_or_sockets(self):
        with tempfile.TemporaryDirectory(prefix='threadbear-boundary-') as temp:
            root = Path(temp)
            for name in ['native/runtime', 'runner', 'home', 'workspace', 'private/enrollment',
                         'relay-state', 'cloud/home', 'cloud/work']:
                (root/name).mkdir(parents=True, exist_ok=True)
            for name in ['private/model-token', 'private/relay-config.json', 'private/enrollment-auth.json',
                         'private/enrollment/index.html', 'runner/runner.json', 'cloud/work/.cloud-deploy.env']:
                (root/name).touch()
            (root/'native/cloud-site-origin').write_text('https://example.convex.site')
            grants = {
                'runner': (['/data/runner.json', '/workspace', '/run/secrets/model-token'], ['/state', '/work', '/enrollment', '/run/secrets/relay-config']),
                'model-relay': (['/state', '/run/secrets/relay-config'], ['/data', '/workspace', '/work', '/enrollment']),
                'site-edge': (['/enrollment/index.html', '/run/secrets/enrollment-auth'], ['/data', '/workspace', '/state', '/work']),
                'cloud-cli': (['/work/.cloud-deploy.env'], ['/data', '/workspace', '/state', '/enrollment', '/run/secrets/model-token']),
            }
            for role, (yes, no) in grants.items():
                with self.subTest(role=role):
                    argv = launcher.command(role, root)
                    argv = argv[:argv.index('--')+1]
                    no += [str(Path.home()), '/mnt/c', '/run/docker.sock', '/run/user/' + str(os.getuid()), str(root)]
                    checks = ['test -e ' + p for p in yes] + ['test ! -e ' + p for p in no]
                    checks += ['test -z "${SSH_AUTH_SOCK:-}"', 'test -z "${CONVEX_DEPLOY_KEY:-}"',
                               '/usr/bin/bwrap --ro-bind / / --dev-bind /dev /dev --proc /proc --unshare-user --unshare-pid /bin/true']
                    env = {**os.environ, 'CONVEX_DEPLOY_KEY': 'poison-fixture', 'SSH_AUTH_SOCK': '/run/host-agent'}
                    done = subprocess.run(argv + ['/bin/sh', '-c', ' && '.join(checks)], env=env, capture_output=True, text=True)
                    self.assertEqual(done.returncode, 0, done.stderr)

if __name__ == '__main__': unittest.main()
