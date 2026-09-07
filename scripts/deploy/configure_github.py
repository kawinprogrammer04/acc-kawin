#!/usr/bin/env python3
"""Preview/apply ACC GitHub settings; requires gh authenticated as an admin."""
import argparse
import base64
import json
import subprocess
import tempfile

REPO = 'kawinprogrammer04/acc-kawin'
CHECKS = ['backend-lint', 'frontend-build', 'check-migrations', 'deployment-tests',
          'check-base-branch', 'check-protected-files', 'check-issue-reference']
TRUSTED_CHECKS = {'check-base-branch', 'check-protected-files'}


def api(path, method='GET', data=None, missing_ok=False):
    command = ['gh', 'api', path, '--method', method]
    if data is not None:
        command += ['--input', '-']
    result = subprocess.run(command, input=json.dumps(data) if data is not None else None,
                            text=True, capture_output=True)
    if result.returncode:
        if missing_ok and 'HTTP 404' in result.stderr:
            return None
        raise SystemExit(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else None


def protection_payload(current, app_id, check_names=CHECKS):
    current = current or {}
    if current.get('required_linear_history', {}).get('enabled'):
        raise SystemExit('Existing linear-history rule conflicts with Release merge commits. Review it manually before applying.')
    status = current.get('required_status_checks') or {}
    checks = {check['context']: {'context': check['context'], 'app_id': check.get('app_id', -1)}
              for check in status.get('checks', [])}
    for context in status.get('contexts', []):
        checks.setdefault(context, {'context': context, 'app_id': -1})
    for context in check_names:
        checks[context] = {'context': context, 'app_id': app_id}
    reviews = current.get('required_pull_request_reviews') or {}
    review_payload = {
        'dismiss_stale_reviews': True,
        'require_code_owner_reviews': reviews.get('require_code_owner_reviews', False),
        'required_approving_review_count': max(1, reviews.get('required_approving_review_count', 0)),
        'require_last_push_approval': True,
        'bypass_pull_request_allowances': {'users': [], 'teams': [], 'apps': []},
    }
    if reviews.get('dismissal_restrictions'):
        review_payload['dismissal_restrictions'] = actors(reviews['dismissal_restrictions'])
    return {
        'required_status_checks': {'strict': True, 'checks': list(checks.values())},
        'enforce_admins': True,
        'required_pull_request_reviews': review_payload,
        'restrictions': actors(current['restrictions']) if current.get('restrictions') else None,
        'required_linear_history': False,
        'allow_force_pushes': False,
        'allow_deletions': False,
        'required_conversation_resolution': True,
        'block_creations': current.get('block_creations', {}).get('enabled', False),
        'lock_branch': current.get('lock_branch', {}).get('enabled', False),
        'allow_fork_syncing': current.get('allow_fork_syncing', {}).get('enabled', False),
    }


def actors(value):
    return {kind: [actor['login' if kind == 'users' else 'slug'] for actor in value.get(kind, [])]
            for kind in ['users', 'teams', 'apps']}



def policy_installed(branch):
    paths = ['.github/scripts/pr-policy.cjs', '.github/workflows/check-pr-base-branch.yml',
             '.github/workflows/protected-files-check.yml']
    for path in paths:
        value = api(f'repos/{REPO}/contents/{path}?ref={branch}', missing_ok=True)
        if not value:
            return False
        if path.endswith('.yml') and 'pull_request_target:' not in base64.b64decode(value['content']).decode():
            return False
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply the displayed plan; default is read-only.')
    parser.add_argument('--bootstrap', action='store_true', help='First installation only: defer new trusted PR checks on production until the first Release installs them.')
    args = parser.parse_args()
    repo = api(f'repos/{REPO}')
    if not repo.get('permissions', {}).get('admin'):
        raise SystemExit('This gh account is not an ACC admin. Ask the administrator to run this script; no settings changed.')
    # Resolve the GitHub Actions app from real CI check runs, not a guessed ID.
    runs = api(f'repos/{REPO}/commits/main/check-runs?per_page=100')['check_runs']
    app_ids = {run['app']['id'] for run in runs if run['app']['slug'] == 'github-actions'}
    if len(app_ids) != 1:
        raise SystemExit('Cannot identify GitHub Actions checks on main; run/review CI before setup.')
    app_id = app_ids.pop()
    snapshots = {}
    plan = []
    required_names = {}
    for branch in ['main', 'production']:
        info = api(f'repos/{REPO}/branches/{branch}')
        current = api(f'repos/{REPO}/branches/{branch}/protection', missing_ok=True)
        if current is None and info['protected']:
            raise SystemExit(f'{branch} is protected but classic protection is unreadable; inspect rulesets manually first.')
        names = CHECKS
        if not policy_installed(branch):
            if branch != 'production' or not args.bootstrap:
                raise SystemExit(f'{branch} has no installed trusted PR policy. Merge this setup into main first; use --bootstrap only for the initial production Release.')
            existing = set(((current or {}).get('required_status_checks') or {}).get('contexts', []))
            if TRUSTED_CHECKS & existing:
                raise SystemExit('Existing trusted checks cannot be removed for bootstrap; reconcile the installed policy manually.')
            names = [name for name in CHECKS if name not in TRUSTED_CHECKS]
            print('BOOTSTRAP: production must receive the reviewed main Release first. Rerun without --bootstrap immediately afterward to require trusted PR checks.')
        required_names[branch] = names
        snapshots[branch] = current
        plan.append(('PUT', f'repos/{REPO}/branches/{branch}/protection', protection_payload(current, app_id, names)))
    plan.append(('PATCH', f'repos/{REPO}', {
        'default_branch': 'main', 'allow_merge_commit': True, 'delete_branch_on_merge': False,
    }))
    environment = api(f'repos/{REPO}/environments/production', missing_ok=True)
    snapshots['environment'] = environment
    env_payload = {'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}
    for rule in (environment or {}).get('protection_rules', []):
        if rule['type'] == 'wait_timer':
            env_payload['wait_timer'] = rule['wait_timer']
        elif rule['type'] == 'required_reviewers':
            env_payload['reviewers'] = [{'type': r['type'], 'id': r['reviewer']['id']} for r in rule['reviewers']]
            env_payload['prevent_self_review'] = rule.get('prevent_self_review', False)
        elif rule['type'] == 'branch_policy':
            pass  # Handled by deployment_branch_policy and the policy list below.
        else:
            raise SystemExit('Environment has custom protection rules; preserve/review these manually before setup.')
    if environment:
        policies = api(f'repos/{REPO}/environments/production/deployment-branch-policies?per_page=100')['branch_policies']
        if any(p['name'] != 'production' or p.get('type', 'branch') != 'branch' for p in policies):
            raise SystemExit('Environment permits other branches/tags; review and remove them manually before setup.')
    else:
        policies = []
    plan.append(('PUT', f'repos/{REPO}/environments/production', env_payload))
    if not policies:
        plan.append(('POST', f'repos/{REPO}/environments/production/deployment-branch-policies', {'name': 'production', 'type': 'branch'}))
    for label, color in [('emergency-hotfix', 'B60205'), ('emergency-rollback', 'D93F0B')]:
        if api(f'repos/{REPO}/labels/{label}', missing_ok=True) is None:
            plan.append(('POST', f'repos/{REPO}/labels', {'name': label, 'color': color,
                'description': 'Emergency production PR; review required, then back-merge to main'}))
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    if not args.apply:
        print('Preview only. After reviewing and installing the server script, rerun with --apply.')
        return
    snapshots['repository'] = {key: repo.get(key) for key in ['default_branch', 'allow_merge_commit', 'delete_branch_on_merge']}
    with tempfile.NamedTemporaryFile(mode='w', prefix='acc-github-settings-', suffix='.json', delete=False) as backup:
        json.dump(snapshots, backup, indent=2)
        print(f'Previous settings saved to {backup.name}')
    for method, path, payload in plan:
        api(path, method, payload)
        print(f'Applied {method} {path}')
    # Read back the settings: this does not imply that a production deploy ran.
    for branch in ['main', 'production']:
        result = api(f'repos/{REPO}/branches/{branch}/protection')
        assert result['enforce_admins']['enabled']
        assert not result['allow_force_pushes']['enabled']
        assert not result['allow_deletions']['enabled']
        assert set(required_names[branch]) <= set(result['required_status_checks']['contexts'])
        assert result['required_pull_request_reviews']['required_approving_review_count'] >= 1
    deployed_env = api(f'repos/{REPO}/environments/production')
    assert deployed_env['deployment_branch_policy'] == env_payload['deployment_branch_policy']
    deployed_policies = api(f'repos/{REPO}/environments/production/deployment-branch-policies?per_page=100')['branch_policies']
    assert len(deployed_policies) == 1 and deployed_policies[0]['name'] == 'production'
    assert deployed_policies[0].get('type', 'branch') == 'branch'
    print('GitHub settings verified. Complete the manual Release/health checklist in docs/deployment.md.')


if __name__ == '__main__':
    main()
