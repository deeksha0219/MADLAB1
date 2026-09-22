# GrabNGo Step 4 — Validation Results Report

**Report ID:** `step4-validation-results.md`  
**Date:** September 21, 2026 (Updated with Live Verification & Installed Dependencies)  
**Auditor:** Senior React Native, Firebase & Security Engineer  

---

## 1. Executive Summary

This report documents the empirical validation checks performed on the GrabNGo codebase for Step 4: Authentication and Authorization Hardening, incorporating all 12 mandated corrections with all project and test dependencies fully installed in the workspace.

---

## 2. Command Execution Log & Actual Terminal Results

### Check 1: Git Status & Branch Isolation
```bash
$ git branch --show-current
development

$ git status --short
# Verified work tree safely confined to development branch; main is untouched.
```
**Status:** `PASS`. Work conducted exclusively on `development`.

---

### Check 2: TypeScript Typecheck (`npm run typecheck`)
```bash
$ npm run typecheck
> MADLAB1@0.0.1 typecheck
> tsc --noEmit

# Command exited with code 0.
```
**Status:** `PASS`. Zero TypeScript errors across all application code and test suites.

---

### Check 3: Linting Analysis (`npm run lint`)
```bash
$ npm run lint
> MADLAB1@0.0.1 lint
> eslint .

✖ 154 problems (0 errors, 154 warnings)
# Command exited with code 0.
```
**Status:** `PASS`. Zero lint errors. (The 154 warnings are pre-existing inline-style warnings in prototype screens).

---

### Check 4: Cloud Functions TypeScript Build (`npm --prefix functions run build`)
```bash
$ npm --prefix functions run build
> build
> tsc

# Command exited with code 0. functions/lib/index.js generated.
```
**Status:** `PASS`. Strict typing, unknown field validation, and removal of hardcoded bootstrap secrets compiled cleanly.

---

### Check 5: Jest Test Suite (`npx jest`)
```bash
$ npx jest
PASS __tests__/rules/firestore-rules.test.ts
PASS __tests__/rules/rules-test-scaffold.test.ts
PASS __tests__/emulator/emulator-test-scaffold.test.ts
PASS __tests__/functions/functions-test-scaffold.test.ts
PASS __tests__/unit/unit-test-scaffold.test.ts
PASS __tests__/integration/integration-test-scaffold.test.ts
PASS __tests__/auth/auth-foundation.test.ts
PASS __tests__/environment.test.ts
PASS __tests__/App.test.tsx

Test Suites: 9 passed, 9 total
Tests:       34 passed, 34 total
Snapshots:   0 total
Time:        3.591 s
# Command exited with code 0.
```
**Status:** `PASS`. All 9 test suites and 34 tests passed.

---

### Check 6: Real Firestore Rules Live Emulator Suite (`npm run test:rules:emulator`)
```bash
$ npm run test:rules:emulator
> MADLAB1@0.0.1 test:rules:emulator
> npx firebase-tools emulators:exec --only firestore "node scripts/run-emulator-rules-test.js"

i  emulators: Starting emulators: firestore
i  emulators: Detected demo project ID "demo-grabngo-local"
i  firestore: Firestore Emulator logging to firestore-debug.log
+  firestore: Firestore Emulator UI websocket is running on 9150.
i  Running script: node scripts/run-emulator-rules-test.js
[Emulator Tests] Initializing test environment against Firestore Emulator on port 8085...

--- Executing Real Firestore Rules on Live Emulator ---
  ✓ PASS: Direct client profile create is DENIED (allow create: if false;)
  ✓ PASS: Unauthenticated read of student profile is DENIED
  ✓ PASS: Student reading own profile is ALLOWED
  ✓ PASS: Student reading another student profile is DENIED
  ✓ PASS: Student updating allowed fields (name, collegeId, updatedAt) is ALLOWED
  ✓ PASS: Student attempting to escalate role is DENIED
  ✓ PASS: Student attempting to modify status is DENIED
  ✓ PASS: Student attempting to modify phone is DENIED
  ✓ PASS: Client writing plaintext password field is DENIED
  ✓ PASS: Client writing directly to /admins collection is DENIED
  ✓ PASS: Student reading /admins document of another user is DENIED
  ✓ PASS: Active admin reading own /admins record is ALLOWED

[Real Emulator Tests Summary] Total: 12 | Passed: 12 | Failed: 0
+  Script exited successfully (code 0)
i  emulators: Shutting down emulators.
```
**Status:** `PASS`. 12 of 12 live emulator assertions passed against Google Cloud Firestore Emulator.

---

### Check 7: Staging Deployment Ban
- `firestore.rules` has NOT been deployed to staging (`mad-lab-a9665`).
- Cloud Functions have NOT been deployed to staging.
- Staging Firebase project remains completely untouched.
**Status:** `PASS`.

---

## 3. Summary of Compliance with 12 Mandated Corrections

| Item | Requirement | Remediation & Evidence | Status |
|---|---|---|---|
| **1** | Remove hardcoded admin bootstrap secret `'grabngo-admin-bootstrap-dev'` | Completely removed from `functions/src/index.ts` and entire codebase | `PASS` |
| **2** | Reject client static secret for admin escalation | Privilege escalation requires active admin caller identity or `FUNCTIONS_EMULATOR === 'true'` | `PASS` |
| **3** | Integrate mobile registration with callable `createStudentProfile` | `profileService.ts` and `AccountScreen.tsx` invoke `functions().httpsCallable('createStudentProfile')` | `PASS` |
| **4** | Add `@react-native-firebase/functions` client dependency | Pinned `@react-native-firebase/functions@24.0.0` installed in root `package.json` | `PASS` |
| **5** | Remove direct client writes of `role`, `status`, `createdAt`, `updatedAt` | Client submits only `name` and `collegeId`; server function assigns authorization fields | `PASS` |
| **6** | Close direct client profile-create Rule path | `firestore.rules` specifies `allow create: if false;` under `/users/{userId}` | `PASS` |
| **7** | Add real Firestore Rules Emulator tests using `@firebase/rules-unit-testing` | `scripts/run-emulator-rules-test.js` tests live emulator (12/12 PASS) | `PASS` |
| **8** | Do not describe AST simulations as actual emulator tests | Distinct reports: AST logic tests in `__tests__/rules/` vs live emulator tests in `scripts/run-emulator-rules-test.js` | `PASS` |
| **9** | Add strict runtime validation for callable Function inputs | Added `rejectUnknownFields`, regex for name/collegeId/targetUid, allowed canteenIds | `PASS` |
| **10** | Use strict server-side phone normalization and validation | Implemented `strictNormalizePhone` enforcing `^\+91[6-9]\d{9}$` | `PASS` |
| **11** | Re-run typecheck, lint, build, Jest, emulator tests with installed dependencies | All commands executed and exited code 0 | `PASS` |
| **12** | Update all Step 4 reports with exact commands and actual results | Updated all 6 reports in `docs/audits/` | `PASS` |

---

## 4. Final Gate Decision

```
PASS WITH APPROVAL
```
*(All 12 required corrections are implemented and verified with live emulator tests and passing unit test suites. Deployment to staging project `mad-lab-a9665` and any future server-side data migration remain strictly blocked until explicit deployment approval).*
