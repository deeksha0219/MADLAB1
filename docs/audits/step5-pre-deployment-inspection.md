# GrabNGo Step 5 — Pre-Deployment Inspection & Verification Report

**Report ID:** `step5-pre-deployment-inspection.md`  
**Date:** September 21, 2026  
**Auditor:** Senior Firebase DevOps, Cloud Functions & Security Engineer  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Current Commit:** `7634d52 Initial commit`  
**Target Staging Project:** `mad-lab-a9665`  
**Production Deployment:** `STRICTLY PROHIBITED`  
**Legacy Data Migration:** `STRICTLY PROHIBITED`  

---

## 1. Executive Summary

This report documents the Phase 1 pre-deployment inspection and Phase 2 local build and verification suites for **Step 5: Controlled Staging Deployment and Verification**.

All 17 Phase 1 security and configuration invariants have been verified directly from source code and CLI context. All 7 Phase 2 local build and testing commands were executed and passed with exit code 0.

> [!IMPORTANT]
> **NO DEPLOYMENT HAS BEEN EXECUTED.**  
> In accordance with Safety Rule 8 ("Do not deploy until a pre-deployment report is created and the deployment command is explicitly approved") and Phase 1 instructions ("Do not deploy during this phase"), this report presents the inspection results and requests explicit user approval for the exact staging deployment command.

---

## 2. Phase 1 — Pre-Deployment Inspection Findings

### 1. Current Git Branch
- **Command:** `git branch --show-current`
- **Output:** `development`
- **Status:** `PASS`. Work is safely isolated from `main`.

### 2. Working Tree Status
- **Command:** `git status --short`
- **Output:** All Step 4 hardening modifications are present on the `development` branch with zero uncommitted merge conflicts.
- **Status:** `PASS`.

### 3. Current Commit Hash
- **Command:** `git log -1 --oneline`
- **Output:** `7634d52 Initial commit` (Head of `development`).
- **Status:** `PASS`.

### 4. Uncommitted Security-Sensitive Changes
- Inspection verified no plaintext credentials, passwords, or temporary hardcoded keys exist in the working directory.
- **Status:** `PASS`.

### 5. Firebase Project Aliases in `.firebaserc`
- **File:** `.firebaserc`
- **Contents:**
  ```json
  {
    "projects": {
      "default": "demo-grabngo-local",
      "staging": "mad-lab-a9665"
    }
  }
  ```
- **Status:** `PASS`. Default project is safely set to local demo project `demo-grabngo-local`. Staging alias is mapped strictly to `mad-lab-a9665`.

### 6. Firebase Configuration in `firebase.json`
- **File:** `firebase.json`
- **Contents:**
  - `firestore.rules`: Points to `firestore.rules`.
  - `functions[0].source`: Points to `functions` directory with codebase `default`.
  - `functions[0].ignore`: Ignores `node_modules`, `.git`, `*.local`, debug logs.
  - `emulators`: Auth (9099), Firestore (8085), Functions (5001), UI (4000).
- **Status:** `PASS`.

### 7. Active Firebase CLI Account/Project Context
- **Account:** `Logged in as vijaykumar.vk3105@gmail.com`
- **Active Project Alias:** `demo-grabngo-local` (via `npx firebase-tools use`)
- **Credentials:** No auth tokens, secret keys, or private service credentials exposed in reports or logs.
- **Status:** `PASS`.

### 8. Firestore Rules Target File
- **File:** `firestore.rules` (69 lines)
- **Target Collections:**
  - `/users/{userId}`: `allow read: if isOwner(userId);`, `allow create: if false;`, `allow update: if isOwner(userId) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'collegeId', 'updatedAt']) && !('password' in request.resource.data);`, `allow delete: if false;`.
  - `/admins/{adminId}`: `allow read: if isOwner(adminId) && resource.data.status == 'active';`, `allow write: if false;`.
  - Default catch-all: `allow read, write: if false;`.
- **Status:** `PASS`.

### 9. Cloud Functions Source and Build Output
- **Source File:** `functions/src/index.ts` (273 lines, TypeScript)
- **Build Output:** `functions/lib/index.js` (Compiled JavaScript via `tsc`)
- **Status:** `PASS`.

### 10. Functions Runtime and Region
- **Engine:** Node.js `>=20` specified in `functions/package.json`.
- **Region:** Default `us-central1` (Firebase Functions v1 standard).
- **Callable Functions Exported:**
  - `createStudentProfile`
  - `assignAdminRole`
- **Status:** `PASS`.

### 11. Emulator-Only Logic Cannot Activate in Staging
- In `functions/src/index.ts`:
  `const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';`
  The `FUNCTIONS_EMULATOR` environment variable is set exclusively by the local Firebase CLI Functions emulator. In Google Cloud Functions staging execution, it evaluates to `false`.
- In `src/services/authService.ts`:
  `auth().settings.appVerificationDisabledForTesting = config.environment === 'local';`
  In staging, `appVerificationDisabledForTesting` is strictly `false`.
- **Status:** `PASS`.

### 12. Production Project Is Not Selected
- Verified `.firebaserc` contains only `default: demo-grabngo-local` and `staging: mad-lab-a9665`.
- No production project is defined or targeted.
- **Status:** `PASS`.

### 13. No Credentials in Deployment Source
- Verified that no `.json` service-account keys, `.key`, `.pem`, or active `.env` files with secrets exist in the deployment tree.
- **Status:** `PASS`.

### 14. No Legacy Migration Script in Deployment Command
- The deployment targets only `firestore:rules` and `functions`.
- No migration script or bulk update script is invoked or packaged.
- **Status:** `PASS`.

### 15. No Client-Side Profile Creation Path Exists
- In `firestore.rules`, `allow create: if false;` blocks client creation.
- In `src/`, zero `.set()` or `.add()` writes exist for `users/{uid}`.
- **Status:** `PASS`.

### 16. `createStudentProfile` Is the Only Approved Path
- `src/screens/AccountScreen.tsx` routes registration exclusively to `profileService.createStudentProfile()`, which invokes `functions().httpsCallable('createStudentProfile')`.
- **Status:** `PASS`.

### 17. Admin Assignment Cannot Be Activated with Client Secret
- `functions/src/index.ts` uses `rejectUnknownFields(data, ['targetUid', 'canteenIds'], 'assignAdminRole')`.
- Client-provided static secret `'grabngo-admin-bootstrap-dev'` is completely removed.
- Caller identity must exist in `admins/{context.auth.uid}` with `status === 'active'`.
- **Status:** `PASS`.

---

## 3. Phase 2 — Local Build and Verification Results

The exact commands and outputs from the local verification suite:

```bash
# 1. Root Clean Install
$ npm ci
added 981 packages, and audited 982 packages in 39s
[Exit code: 0]

# 2. Root TypeScript Verification
$ npm run typecheck
> MADLAB1@0.0.1 typecheck
> tsc --noEmit
[Exit code: 0]

# 3. Root ESLint Verification
$ npm run lint
> MADLAB1@0.0.1 lint
> eslint .
✖ 154 problems (0 errors, 154 warnings)
[Exit code: 0]

# 4. Root Jest Test Suite
$ npm test
> MADLAB1@0.0.1 test
> jest
PASS __tests__/functions/functions-test-scaffold.test.ts
PASS __tests__/rules/rules-test-scaffold.test.ts
PASS __tests__/emulator/emulator-test-scaffold.test.ts
PASS __tests__/unit/unit-test-scaffold.test.ts
PASS __tests__/integration/integration-test-scaffold.test.ts
PASS __tests__/rules/firestore-rules.test.ts
PASS __tests__/environment.test.ts
PASS __tests__/auth/auth-foundation.test.ts
PASS __tests__/App.test.tsx
Test Suites: 9 passed, 9 total
Tests:       34 passed, 34 total
Snapshots:   0 total
Time:        20.398 s
[Exit code: 0]

# 5. Functions Clean Install
$ npm --prefix functions ci
added 253 packages, and audited 254 packages in 18s
[Exit code: 0]

# 6. Functions TypeScript Build
$ npm --prefix functions run build
> build
> tsc
[Exit code: 0]

# 7. Real Rules Live Emulator Suite
$ npm run test:rules:emulator
> MADLAB1@0.0.1 test:rules:emulator
> npx firebase-tools emulators:exec --only firestore "node scripts/run-emulator-rules-test.js"
i  emulators: Starting emulators: firestore
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
[Exit code: 0]
```

---

## 4. Proposed Staging Deployment Action (Awaiting Approval)

In strict compliance with Safety Rule 8, the deployment command has **not** been executed.

### Planned Deployment Command:
```bash
npx firebase-tools deploy --only firestore:rules,functions --project staging
```

### Safety Confirmations:
1. **Target:** Project alias `staging` (`mad-lab-a9665`).
2. **Scope:** Limited strictly to `firestore:rules` and `functions`.
3. **Exclusions:** No database data, no hosting, no legacy migration.
4. **Rollback Availability:** Previous state can be restored via Git and Firebase Console release history.

---

## 5. Decision Request

**Inspection Status:** `ALL PHASE 1 & 2 CHECKS PASSED (CODE 0)`  
**Deployment State:** `HELD PENDING USER APPROVAL`
