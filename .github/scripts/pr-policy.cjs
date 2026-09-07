'use strict';

function checkRoute(pr, validBases) {
  const base = pr.base.ref;
  const head = pr.head.ref;
  const sameRepo = pr.head.repo?.full_name === pr.base.repo.full_name;
  const labels = new Set(pr.labels.map(label => label.name));
  if (!validBases.includes(base)) return `Base ${base} ไม่ได้รับอนุญาต; ระบุ --base main หรือ --base production`;
  if (base === 'main') {
    if (/^(feature|fix)\/.+/.test(head) || (sameRepo && head === 'production')) return null;
    return 'งานทั่วไปต้องมาจาก feature/* หรือ fix/*; production → main ใช้ back-merge เท่านั้น';
  }
  if (base === 'production') {
    if (sameRepo && head === 'main') return null;
    if (sameRepo && /^fix\/.+/.test(head) &&
        (labels.has('emergency-hotfix') || labels.has('emergency-rollback'))) return null;
    return 'Release ต้องเป็น main → production ใน repo เดียวกัน; กรณีฉุกเฉินใช้ fix/* พร้อม label emergency-hotfix/emergency-rollback และผ่าน review';
  }
  return 'ไม่มีกฎสำหรับ base นี้';
}

function readPatterns(text) {
  const patterns = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!patterns.length) throw new Error('Policy config ว่าง: หยุดตรวจแบบ fail closed');
  return patterns;
}

// A pattern without '/' matches a basename at any depth. '*' also spans '/'
// in path patterns, so backup directories are protected recursively.
function matches(path, pattern) {
  const candidate = pattern.includes('/') ? path : path.split('/').pop();
  const regex = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${regex}$`, 'i').test(candidate);
}

function protectedPaths(files, patterns) {
  const denies = patterns.filter(pattern => !pattern.startsWith('!'));
  const allows = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));
  return [...new Set(files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean)))]
    .filter(path => denies.some(pattern => matches(path, pattern)) && !allows.some(pattern => matches(path, pattern)));
}

module.exports = { checkRoute, readPatterns, protectedPaths };
