import contextlib
import base64
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup_acc', Path(__file__).resolve().parents[2] / 'scripts/deploy/configure_github.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class GitHubSetupTests(unittest.TestCase):
    def test_protection_requires_review_and_preserves_stricter_existing_settings(self):
        current = {
            'required_status_checks': {'contexts': ['existing-ci'], 'checks': [{'context': 'existing-ci', 'app_id': 42}]},
            'required_pull_request_reviews': {'required_approving_review_count': 2, 'require_code_owner_reviews': True},
            'restrictions': {'users': [{'login': 'owner'}], 'teams': [], 'apps': []},
        }
        result = setup.protection_payload(current, 123)
        self.assertTrue(result['enforce_admins'])
        self.assertFalse(result['allow_force_pushes'])
        self.assertFalse(result['allow_deletions'])
        self.assertEqual(result['required_pull_request_reviews']['required_approving_review_count'], 2)
        self.assertTrue(result['required_pull_request_reviews']['require_code_owner_reviews'])
        self.assertEqual(result['restrictions']['users'], ['owner'])
        checks = {c['context']: c['app_id'] for c in result['required_status_checks']['checks']}
        self.assertEqual(checks['existing-ci'], 42)
        for name in setup.CHECKS:
            self.assertEqual(checks[name], 123)
        self.assertTrue(result['required_status_checks']['strict'])

    def test_incompatible_existing_linear_history_requires_manual_review(self):
        with self.assertRaises(SystemExit):
            setup.protection_payload({'required_linear_history': {'enabled': True}}, 123)

    def test_write_account_cannot_apply_settings(self):
        with patch.object(setup, 'api', return_value={'permissions': {'admin': False}}) as api:
            with patch('sys.argv', ['configure_github.py', '--apply']), self.assertRaises(SystemExit):
                setup.main()
        self.assertEqual(api.call_count, 1)
        self.assertEqual(api.call_args.args, (f'repos/{setup.REPO}',))

    def preview_api(self, path, method='GET', data=None, missing_ok=False):
        self.assertEqual(method, 'GET', 'preview must never mutate GitHub')
        if path == f'repos/{setup.REPO}': return {'permissions': {'admin': True}}
        if '/check-runs?' in path: return {'check_runs': [{'app': {'id': 123, 'slug': 'github-actions'}}]}
        if path.endswith('/protection'): return None
        if '/branches/' in path: return {'protected': False}
        if '/contents/' in path: return {'content': base64.b64encode(b'pull_request_target:').decode()}
        if '/environments/' in path or '/labels/' in path: return None
        self.fail(f'unexpected API: {path}')

    def test_preview_is_read_only_and_targets_only_production_environment(self):
        with patch.object(setup, 'api', side_effect=self.preview_api), patch('sys.argv', ['configure_github.py']):
            output = io.StringIO()
            with contextlib.redirect_stdout(output): setup.main()
        self.assertIn('Preview only', output.getvalue())
        self.assertIn('"name": "production"', output.getvalue())
        self.assertNotIn('"context": "deploy"', output.getvalue())

    def test_unreadable_existing_protection_is_not_overwritten(self):
        def protected(path, **kwargs):
            if '/branches/' in path and not path.endswith('/protection'): return {'protected': True}
            return self.preview_api(path, **kwargs)
        with patch.object(setup, 'api', side_effect=protected), patch('sys.argv', ['configure_github.py', '--apply']):
            with self.assertRaisesRegex(SystemExit, 'unreadable'): setup.main()

    def test_existing_environment_keeps_review_rules_without_duplicate_policies_or_labels(self):
        def existing(path, **kwargs):
            if path.endswith('/environments/production'):
                return {'protection_rules': [
                    {'type': 'wait_timer', 'wait_timer': 10},
                    {'type': 'required_reviewers', 'prevent_self_review': True,
                     'reviewers': [{'type': 'User', 'reviewer': {'id': 456}}]},
                    {'type': 'branch_policy'},
                ], 'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}
            if '/deployment-branch-policies' in path:
                return {'branch_policies': [{'name': 'production', 'type': 'branch'}]}
            if '/labels/' in path: return {'name': path.rsplit('/', 1)[1]}
            return self.preview_api(path, **kwargs)
        with patch.object(setup, 'api', side_effect=existing), patch('sys.argv', ['configure_github.py']):
            output = io.StringIO()
            with contextlib.redirect_stdout(output): setup.main()
        self.assertNotIn('"POST"', output.getvalue())
        self.assertIn('"wait_timer": 10', output.getvalue())
        self.assertIn('"prevent_self_review": true', output.getvalue())
        self.assertIn('"id": 456', output.getvalue())

    def test_missing_production_policy_requires_explicit_bootstrap(self):
        def missing_production(path, **kwargs):
            if '/contents/' in path and path.endswith('?ref=production'): return None
            return self.preview_api(path, **kwargs)
        with patch.object(setup, 'api', side_effect=missing_production), patch('sys.argv', ['configure_github.py']):
            with self.assertRaisesRegex(SystemExit, 'no installed trusted PR policy'): setup.main()

    def test_bootstrap_defers_only_new_production_guards(self):
        def missing_production(path, **kwargs):
            if '/contents/' in path and path.endswith('?ref=production'): return None
            return self.preview_api(path, **kwargs)
        with patch.object(setup, 'api', side_effect=missing_production), patch('sys.argv', ['configure_github.py', '--bootstrap']):
            output = io.StringIO()
            with contextlib.redirect_stdout(output): setup.main()
        import json
        plan, _ = json.JSONDecoder().raw_decode(output.getvalue()[output.getvalue().index('[\n'):])
        main_checks = {c['context'] for c in plan[0][2]['required_status_checks']['checks']}
        prod_checks = {c['context'] for c in plan[1][2]['required_status_checks']['checks']}
        self.assertEqual(main_checks, set(setup.CHECKS))
        self.assertEqual(prod_checks, set(setup.CHECKS) - setup.TRUSTED_CHECKS)
        self.assertTrue(plan[1][2]['enforce_admins'])
        self.assertEqual(plan[1][2]['required_pull_request_reviews']['required_approving_review_count'], 1)

    def test_bootstrap_never_removes_existing_required_guards(self):
        def existing_guard(path, **kwargs):
            if path.endswith('/production/protection'):
                return {'required_status_checks': {'contexts': ['check-base-branch']}}
            if '/contents/' in path and path.endswith('?ref=production'): return None
            return self.preview_api(path, **kwargs)
        with patch.object(setup, 'api', side_effect=existing_guard), patch('sys.argv', ['configure_github.py', '--bootstrap']):
            with self.assertRaisesRegex(SystemExit, 'cannot be removed'): setup.main()
