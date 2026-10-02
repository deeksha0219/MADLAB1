/**
 * Local CI Pipeline Verifier
 *
 * Runs the full sequence of CI gates locally against current source and local emulators,
 * records duration, exit codes, pass/fail counts, and outputs `docs/audits/ci-summary.md` and `ci-summary.json`.
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const STEPS = [
  { name: 'npm ci', command: 'npm ci', cwd: ROOT_DIR },
  { name: 'typecheck', command: 'npm run typecheck', cwd: ROOT_DIR },
  { name: 'lint', command: 'npm run lint', cwd: ROOT_DIR },
  { name: 'test:unit', command: 'npm test -- --runInBand', cwd: ROOT_DIR },
  { name: 'functions:ci', command: 'npm --prefix functions ci', cwd: ROOT_DIR },
  { name: 'functions:build', command: 'npm --prefix functions run build', cwd: ROOT_DIR },
  { name: 'test:rules:emulator', command: 'npm run test:rules:emulator', cwd: ROOT_DIR, isEmulator: true },
  { name: 'test:functions:emulator', command: 'npm run test:functions:emulator', cwd: ROOT_DIR, isEmulator: true },
  { name: 'test:order:emulator', command: 'npm run test:order:emulator', cwd: ROOT_DIR, isEmulator: true },
  { name: 'test:status:emulator', command: 'npm run test:status:emulator', cwd: ROOT_DIR, isEmulator: true },
  { name: 'test:payment:emulator', command: 'npm run test:payment:emulator', cwd: ROOT_DIR, isEmulator: true },
  { name: 'test:notifications:emulator', command: 'npm run test:notifications:emulator', cwd: ROOT_DIR, isEmulator: true },
  { name: 'test:service-desk:emulator', command: 'npm run test:service-desk:emulator', cwd: ROOT_DIR, isEmulator: true },
  { name: 'test:sharded-slot:emulator', command: 'npm run test:sharded-slot:emulator', cwd: ROOT_DIR, isEmulator: true },
];

function hasPortSockets(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    // findstr exits 1 when no match
    return false;
  }
}

async function waitForPortsFree(ports = [8085, 9099, 5001, 4000], timeoutSeconds = 180) {
  const start = Date.now();
  let warned = false;
  while ((Date.now() - start) < timeoutSeconds * 1000) {
    let busyPort = null;
    for (const port of ports) {
      if (hasPortSockets(port)) {
        busyPort = port;
        break;
      }
    }
    if (!busyPort) {
      if (warned) {
        console.log(` -> Ports cleared successfully.`);
      }
      return true;
    }
    if (!warned) {
      process.stdout.write(` (Waiting for TIME_WAIT sockets on port ${busyPort} to release`);
      warned = true;
    } else {
      process.stdout.write(`.`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (warned) console.log(`!`);
  return false;
}

function getCommitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getFirebaseCliVersion() {
  try {
    return execSync('npx firebase-tools --version', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function runPipeline() {
  const commitSha = getCommitSha();
  const firebaseVersion = getFirebaseCliVersion();
  const nodeVersion = process.version;
  const startTime = Date.now();

  console.log('====================================================');
  console.log('GrabNGo CI Emulator Pipeline Local Execution');
  console.log(`Commit: ${commitSha}`);
  console.log(`Node: ${nodeVersion} | Firebase CLI: ${firebaseVersion}`);
  console.log('====================================================\n');

  const results = [];
  let allPassed = true;

  for (const step of STEPS) {
    if (step.isEmulator) {
      process.stdout.write(`[Port Check] Checking ports (8085, 9099, 5001, 4000)...`);
      await waitForPortsFree();
      console.log(` Ready.`);
    }

    console.log(`>>> Running: ${step.name} (${step.command})...`);
    const stepStart = Date.now();
    const child = spawnSync(step.command, {
      cwd: step.cwd,
      shell: true,
      stdio: 'inherit',
      env: process.env,
    });
    const stepDurationMs = Date.now() - stepStart;
    const exitCode = child.status ?? (child.error ? 1 : 0);

    const stepResult = {
      name: step.name,
      command: step.command,
      exitCode,
      durationMs: stepDurationMs,
      passed: exitCode === 0,
    };
    results.push(stepResult);

    if (exitCode !== 0) {
      console.error(`\nFAILED: ${step.name} exited with code ${exitCode}`);
      allPassed = false;
      break;
    } else {
      console.log(`PASSED: ${step.name} (${(stepDurationMs / 1000).toFixed(1)}s)\n`);
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;

  const summary = {
    commitSha,
    nodeVersion,
    firebaseCliVersion: firebaseVersion,
    totalDurationSeconds: (totalDurationMs / 1000).toFixed(1),
    passCount,
    failCount,
    allPassed,
    steps: results,
  };

  fs.writeFileSync(path.join(ROOT_DIR, 'ci-summary.json'), JSON.stringify(summary, null, 2));

  let mdContent = `# GrabNGo CI Emulator Pipeline Execution Summary\n\n`;
  mdContent += `**Date:** ${new Date().toISOString()}  \n`;
  mdContent += `**Commit SHA:** \`${commitSha}\`  \n`;
  mdContent += `**Node Version:** \`${nodeVersion}\`  \n`;
  mdContent += `**Firebase CLI Version:** \`${firebaseVersion}\`  \n`;
  mdContent += `**Total Duration:** \`${(totalDurationMs / 1000).toFixed(1)}s\`  \n`;
  mdContent += `**Status:** ${allPassed ? '**PASS (All gates cleared)**' : '**FAIL**'}  \n\n`;
  mdContent += `| Step | Command | Exit Code | Duration (s) | Status |\n`;
  mdContent += `|---|---|---|---|---|\n`;

  for (const r of results) {
    mdContent += `| **${r.name}** | \`${r.command}\` | \`${r.exitCode}\` | ${(r.durationMs / 1000).toFixed(1)}s | ${r.passed ? 'PASS' : 'FAIL'} |\n`;
  }

  mdContent += `\n**Pass / Fail Count:** ${passCount} passed, ${failCount} failed.\n`;

  const docsAuditDir = path.join(ROOT_DIR, 'docs', 'audits');
  if (!fs.existsSync(docsAuditDir)) {
    fs.mkdirSync(docsAuditDir, { recursive: true });
  }
  fs.writeFileSync(path.join(docsAuditDir, 'ci-summary.md'), mdContent);

  console.log('\n====================================================');
  console.log(`Pipeline Result: ${allPassed ? 'SUCCESS' : 'FAILURE'}`);
  console.log(`Summary written to ci-summary.json and docs/audits/ci-summary.md`);
  console.log('====================================================');

  process.exit(allPassed ? 0 : 1);
}

runPipeline();
