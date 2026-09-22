# GrabNGo Step 4 — Known Limitations & Scope Boundary Analysis

**Report ID:** `step4-known-limitations.md`  
**Date:** September 21, 2026 (Updated with Mandated Corrections & Live Verification)  
**Auditor:** Senior React Native, Firebase & Security Engineer  

---

## 1. Executive Summary

This document enumerates the deliberate constraints, unexecuted operations, environment observations, scope boundaries, and remaining pre-deployment prerequisites for Step 4.

---

## 2. Environment Observations & Host Specifics

### 1. Dependencies Status (Installed & Verified)
- Root and functions dependencies are installed in the workspace.
- `@react-native-firebase/functions@24.0.0` pinned to peer `@react-native-firebase/app@24.0.0`.
- `@firebase/rules-unit-testing@5.0.2` and `@types/node` installed for real emulator test execution and TypeScript support.

### 2. Local Host Port 8080 Conflict
- **Observation:** On this Windows development machine, port `8080` is occupied by system process `AgentService` (PID 7100).
- **Resolution:** In `firebase.json` and `src/config/environment.ts`, the local Firestore emulator port is configured to `8085`.
- **Impact:** Live Firestore Emulator tests execute cleanly on port 8085 (`npx firebase-tools emulators:exec --only firestore "node scripts/run-emulator-rules-test.js"`).

### 3. Global Firebase CLI in PATH
- Running emulator commands locally uses `npx firebase-tools` (version `15.7.0`), ensuring predictable execution regardless of global npm installation.

### 4. Staging Deployment Banned in Step 4
- **Constraint:** `firestore.rules` and Cloud Functions MUST NOT be deployed to staging (`mad-lab-a9665`) during Step 4.
- **Impact:** Live staging project `mad-lab-a9665` remains unmigrated and unaffected until formal user deployment approval.

---

## 3. Deliberate Scope Boundaries & Identity Limitations

1. **Email Suffix Verification vs. Email Ownership**:
   - The current validation confirms that the student's email string matches `^[a-zA-Z0-9._%+-]+@rvu.edu.in$`.
   - **Limitation:** Suffix checking verifies institutional format compliance only; **it does NOT prove ownership of the specific mailbox**. Proving mailbox ownership requires either sending an email verification link (`sendEmailVerification`) or implementing RVU institutional Google Workspace OAuth / SSO.
2. **User-Scoped Cart Migration (Step 5)**:
   - Shopping cart migration to user-scoped Firestore documents belongs to Step 5.
3. **Server-Authoritative Order Placement (Step 5)**:
   - Creating orders and inventory validation belongs to Step 5.
4. **Payment Processing (Step 6)**:
   - Payment operations and demo payment flows belong to Step 6.
5. **Admin Order Queue (Step 7)**:
   - The admin live queue belongs to Step 7.

---

## 4. Remaining Risks & Pre-Deployment Checklist

1. **Staging Phone Auth SMS Quota**:
   - In Firebase staging projects on the Spark/Blaze tiers, SMS Phone Auth has usage limits. When testing on physical staging devices, test phone numbers with pre-configured static verification codes should be registered in the Firebase Console (`Authentication > Sign-in method > Phone > Phone numbers for testing`).
2. **Android SHA-1 Fingerprints**:
   - For live phone authentication on real Android devices, debug and release SHA-1 / SHA-256 certificate fingerprints must be added to the Firebase project settings for `com.madlab1`.
3. **Server-Side Legacy Migration**:
   - Staging data migration of legacy users must be performed only after a full Firestore backup, using the trusted server-side migration script outlined in `docs/audits/step4-migration-and-rollback.md`.
