"""Exercise the real deploy shell flow with fake Git/Docker/SSH-free services."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'scripts/deploy/deploy-acc-kawin.sh'
SHA = 'a' * 40
STUB = r'''
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['FIXTURE'])
with (root / 'calls').open('a') as log:
    log.write(json.dumps([name, *args]) + '\n')
mode = os.environ.get('FAIL_AT', '')
if name == 'git':
    if args[:1] == ['fetch']:
        p = root / 'fetches'; p.write_text(str(int(p.read_text() if p.exists() else '0') + 1))
    elif args == ['rev-parse', 'refs/remotes/origin/production']:
        count = int((root / 'fetches').read_text())
        print('b' * 40 if mode == 'stale' or (mode == 'stale-after-build' and count > 1) else 'a' * 40)
    elif args == ['rev-parse', 'HEAD']: print('c' * 40)
    elif args[:1] == ['diff'] and mode == 'dirty': sys.exit(1)
    elif args[:1] == ['ls-files'] and mode == 'untracked': print('unexpected.py')
elif name == 'docker':
    text = ' '.join(args)
    if 'pg_dump' in text:
        if mode == 'backup': sys.exit(1)
        if mode != 'empty-backup': print('PGDMP fixture')
    if 'pg_restore' in text:
        data = sys.stdin.read()
        if mode == 'invalid-backup' or not data.startswith('PGDMP'): sys.exit(1)
    if args[-1:] == ['build'] and mode == 'build': sys.exit(1)
    if 'up' in args and mode == 'up': sys.exit(1)
elif name == 'stat':
    print(('501' if mode == 'config-owner' else '0') if args[1] == '%u' else ('666' if mode == 'config-mode' else '600'))
elif name == 'realpath': print(os.path.realpath(args[-1]))
elif name == 'flock' and mode == 'lock': sys.exit(1)
elif name == 'curl' and mode == 'health': sys.exit(1)
'''


class DeployTests(unittest.TestCase):
    def run_deploy(self, fail_at='', sha=SHA, arguments=()):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / 'app'; project.mkdir()
            (project / '.git').mkdir(); (project / '.env').write_text('')
            (project / 'docker-compose.plesk.yml').write_text('services: {}')
            config = root / 'config'
            config.write_text(f'PROJECT_DIR={shlex.quote(str(project))}\nBACKUP_DIR={shlex.quote(str(root / "backups"))}\nCOMPOSE_PROJECT_NAME=existing-acc\nHEALTH_URL=http://127.0.0.1:18080/api/health\n')
            stub = root / 'stub'
            stub.write_text(f'#!{sys.executable}\n' + STUB); stub.chmod(0o755)
            for tool in ['git', 'docker', 'curl', 'flock', 'sleep', 'stat', 'realpath']:
                (root / tool).symlink_to(stub)
            # Only redirect host integration points in a temporary copy. No
            # testing switches or bypasses exist in the production script.
            script = SOURCE.read_text().replace(
                'export PATH=/usr/sbin:/usr/bin:/sbin:/bin',
                f'export PATH={shlex.quote(str(root))}:/usr/bin:/bin',
            ).replace('readonly CONFIG=/etc/acc-kawin-deploy.conf', f'readonly CONFIG={shlex.quote(str(config))}').replace(
                'readonly LOCK_FILE=/run/lock/acc-kawin-deploy.lock', f'readonly LOCK_FILE={shlex.quote(str(root / "lock"))}')
            target = root / 'deploy.sh'; target.write_text(script)
            result = subprocess.run(['bash', str(target), *arguments], input=sha + '\n',
                text=True, capture_output=True, timeout=20,
                env={**os.environ, 'FIXTURE': tmp, 'FAIL_AT': fail_at})
            calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()] if (root / 'calls').exists() else []
            return result, calls

    def test_success_backs_up_before_reset_then_builds_and_starts_exact_sha(self):
        result, calls = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        dump = next(i for i, c in enumerate(calls) if 'pg_dump' in ' '.join(c))
        restore = next(i for i, c in enumerate(calls) if 'pg_restore' in c)
        reset = calls.index(['git', 'reset', '--hard', SHA])
        build = next(i for i, c in enumerate(calls) if c[0] == 'docker' and c[-1] == 'build')
        up = next(i for i, c in enumerate(calls) if c[0] == 'docker' and 'up' in c)
        self.assertTrue(dump < restore < reset < build < up)
        self.assertIn(SHA, result.stdout)
        self.assertEqual(sum(c[:2] == ['git', 'fetch'] for c in calls), 2)
        self.assertFalse(any('down' in c or 'clean' in c or 'prune' in c for c in calls))

    def test_failures_before_checkout_never_reset_or_start_services(self):
        for failure in ['config-owner', 'config-mode', 'lock', 'dirty', 'untracked', 'stale', 'backup', 'empty-backup', 'invalid-backup']:
            with self.subTest(failure=failure):
                result, calls = self.run_deploy(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(c[:2] == ['git', 'reset'] or (c[0] == 'docker' and 'up' in c) for c in calls))

    def test_build_failure_or_new_release_does_not_restart_containers(self):
        for failure in ['build', 'stale-after-build']:
            with self.subTest(failure=failure):
                result, calls = self.run_deploy(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(c[0] == 'docker' and 'up' in c for c in calls))

    def test_unhealthy_deployment_never_reports_success_or_restores_data(self):
        for failure in ['up', 'health']:
            with self.subTest(failure=failure):
                result, calls = self.run_deploy(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('Deploy OK', result.stdout)
                self.assertFalse(any('pg_restore' in c and '--list' not in c for c in calls))

    def test_invalid_input_never_reaches_git_or_docker(self):
        for sha, args in [('', ()), ('main', ()), ('a' * 39, ()), ('a' * 40 + ';whoami', ()), (SHA, ('--force',))]:
            with self.subTest(sha=sha, args=args):
                result, calls = self.run_deploy(sha=sha, arguments=args)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
