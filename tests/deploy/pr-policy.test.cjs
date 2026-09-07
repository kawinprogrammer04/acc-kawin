const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { checkRoute, readPatterns, protectedPaths } = require('../../.github/scripts/pr-policy.cjs');
const bases = readPatterns(fs.readFileSync('.github/valid-pr-bases.txt', 'utf8'));
const patterns = readPatterns(fs.readFileSync('.github/protected-files.txt', 'utf8'));
function pr(base, head, labels = [], same = true) {
  return { base: { ref: base, repo: { full_name: 'team/acc' } },
    head: { ref: head, repo: same ? { full_name: 'team/acc' } : { full_name: 'fork/acc' } },
    labels: labels.map(name => ({ name })) };
}
for (const [base, head, labels, same, allowed] of [
  ['main', 'feature/5-new', [], true, true],
  ['main', 'fix/5-bug', [], false, true],
  ['main', 'production', [], true, true],
  ['main', 'production', [], false, false],
  ['main', 'Whan', [], true, false],
  ['Whan', 'fix/5-bug', [], true, false],
  ['Production', 'main', [], true, false],
  ['production', 'main', [], true, true],
  ['production', 'main', [], false, false],
  ['production', 'fix/5-bug', [], true, false],
  ['production', 'fix/5-bug', ['emergency-hotfix'], true, true],
  ['production', 'fix/5-rollback', ['emergency-rollback'], true, true],
  ['production', 'fix/5-bug', ['emergency-hotfix'], false, false],
  ['production', 'feature/5-new', ['emergency-hotfix'], true, false],
]) test(`route ${head} → ${base} labels=${labels} sameRepo=${same}`, () => {
  assert.equal(checkRoute(pr(base, head, labels, same), bases) === null, allowed);
});
test('missing fork repo is handled and rejected for release', () => {
  const value = pr('production', 'main'); value.head.repo = null;
  assert.ok(checkRoute(value, bases));
});
test('empty configuration fails closed', () => assert.throws(() => readPatterns('# empty\n')));
for (const path of ['.env', 'backend/.env.production', 'hr-sync.env', 'hr-sync.env.local',
  'new.xlsx', 'old/REPORT.XLSX', 'data.xls', 'pre-deploy.dump', 'keys/id_ed25519',
  'server.pem', 'backup.sql', 'exports/temporary.csv', 'nested/backups/customer.csv']) {
  test(`protected ${path}`, () => assert.deepEqual(protectedPaths([{ filename: path }], patterns), [path]));
}
for (const path of ['.env.example', '.env.production.example', 'hr-sync.env.example',
  'backend/.env.example', 'db/01_schema.sql', 'frontend/src/App.tsx', 'scripts/backup.sh']) {
  test(`allowed ${path}`, () => assert.deepEqual(protectedPaths([{ filename: path }], patterns), []));
}
test('removal of a legacy spreadsheet is blocked without deleting it locally', () => {
  assert.deepEqual(protectedPaths([{ filename: 'legacy.xlsx', status: 'removed' }], patterns), ['legacy.xlsx']);
});
test('renaming a protected file cannot hide it from the guard', () => {
  assert.deepEqual(protectedPaths([{ filename: 'safe.txt', previous_filename: 'legacy.xlsx', status: 'renamed' }], patterns), ['legacy.xlsx']);
});
