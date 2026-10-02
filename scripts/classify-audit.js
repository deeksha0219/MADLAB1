const fs = require('fs');

const rootAudit = JSON.parse(fs.readFileSync('audit-root.json', 'utf8'));
const fnAudit = JSON.parse(fs.readFileSync('audit-functions.json', 'utf8'));

console.log('=== ROOT VULNERABILITIES ===');
for (const [pkg, info] of Object.entries(rootAudit.vulnerabilities || {})) {
  const titles = (info.via || []).map(v => typeof v === 'string' ? v : v.title).join('; ');
  console.log(`- ${pkg} [${info.severity}]: ${titles}`);
}

console.log('\n=== FUNCTIONS VULNERABILITIES ===');
for (const [pkg, info] of Object.entries(fnAudit.vulnerabilities || {})) {
  const titles = (info.via || []).map(v => typeof v === 'string' ? v : v.title).join('; ');
  console.log(`- ${pkg} [${info.severity}]: ${titles}`);
}
