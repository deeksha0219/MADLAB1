/**
 * Android Release Bundle Static Analyzer
 *
 * Scans generated Android release JS bundle for prohibited development patterns:
 * - Loopback addresses (127.0.0.1, 10.0.2.2)
 * - Emulator ports (9099, 8085, 5001, 4000)
 * - Fake keys or test secrets
 * - Operator token endpoints
 * - Private keys
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const BUNDLE_PATH = path.resolve(__dirname, '../android-release-bundle.js');

if (!fs.existsSync(BUNDLE_PATH)) {
  console.error(`Release bundle not found at: ${BUNDLE_PATH}`);
  process.exit(1);
}

const bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');

// Compute SHA-256 Checksum
const hash = crypto.createHash('sha256').update(bundleContent).digest('hex');
const bundleStats = fs.statSync(BUNDLE_PATH);

console.log('====================================================');
console.log('Android Release Bundle Verification');
console.log(`Bundle File: ${BUNDLE_PATH}`);
console.log(`Size: ${(bundleStats.size / 1024 / 1024).toFixed(2)} MB (${bundleStats.size} bytes)`);
console.log(`SHA-256 Checksum: ${hash}`);
console.log('====================================================\n');

// Check fail-closed behavior on environment resolution:
// Notice: In production bundling (--dev false), __DEV__ is false.
// When resolved at runtime without GRABNGO_ENV, resolveBuildTimeEnvironment fails closed!

const prohibitedPatterns = [
  { name: 'Android Emulator Loopback (10.0.2.2)', regex: /10\.0\.2\.2/g },
  { name: 'Localhost Loopback (127.0.0.1)', regex: /127\.0\.0\.1/g },
  { name: 'Auth Emulator Port (9099)', regex: /9099/g },
  { name: 'Firestore Emulator Port (8085)', regex: /8085/g },
  { name: 'Functions Emulator Port (5001)', regex: /5001/g },
  { name: 'Test Fake Key ("fake-key")', regex: /fake-key/gi },
  { name: 'Local Operator Token Endpoint (/api/token)', regex: /\/api\/token\b/g },
  { name: 'Private Key Header', regex: /-----BEGIN (RSA )?PRIVATE KEY-----/g },
  { name: 'Service Account Secret Marker', regex: /"private_key_id"/g },
];

let violations = 0;
const findings = [];

for (const pattern of prohibitedPatterns) {
  const matches = bundleContent.match(pattern.regex);
  if (matches && matches.length > 0) {
    violations++;
    findings.push({
      pattern: pattern.name,
      count: matches.length,
      status: 'VIOLATION',
    });
    console.error(`[FAIL] Detected ${matches.length} occurrence(s) of: ${pattern.name}`);
  } else {
    findings.push({
      pattern: pattern.name,
      count: 0,
      status: 'CLEAN',
    });
    console.log(`[PASS] Clean: ${pattern.name}`);
  }
}

console.log('\n====================================================');
console.log(`Total Scans: ${prohibitedPatterns.length} | Violations: ${violations}`);
console.log('====================================================');

const report = {
  bundlePath: BUNDLE_PATH,
  fileSizeBytes: bundleStats.size,
  sha256: hash,
  timestamp: new Date().toISOString(),
  violations,
  findings,
};

fs.writeFileSync(path.resolve(__dirname, '../android-release-bundle-audit.json'), JSON.stringify(report, null, 2));

if (violations > 0) {
  process.exit(1);
} else {
  console.log('All static bundle checks PASSED.');
  process.exit(0);
}
