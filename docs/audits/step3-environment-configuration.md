# GrabNGo Step 3 — Environment Configuration Report

**Report ID:** `step3-environment-configuration.md`  
**Date:** September 21, 2026 (Updated with Mandated Corrections)  
**Auditor:** Senior React Native, Firebase & Security Engineer  

---

## 1. Executive Summary

This report documents the foundation and environment separation architecture implemented for GrabNGo. The configuration partitions local development (via Firebase Emulator Suite and project `demo-grabngo-local`) from cloud staging (`mad-lab-a9665`), establishes deny-by-default emulator security scaffolding, wires `configureFirebase()` into application startup, and enforces fail-closed behavior against unauthorized or unconfigured production environments.

---

## 2. Files Created or Modified

| File Path | Operation | Rationale & Architectural Purpose |
|---|---|---|
| `index.js` | `MODIFIED` | Application entrypoint. Calls `configureFirebase()` at top-level before component registration to guarantee singleton initialization before any Firebase operations. |
| `App.tsx` | `MODIFIED` | Root React component. Calls `configureFirebase()` in a top-level `useEffect` hook to ensure safe initialization if `App` is mounted directly in tests. |
| `.firebaserc` | `NEW` | Sets `default` to `demo-grabngo-local` and `staging` to `mad-lab-a9665`. Default CLI commands cannot accidentally deploy to staging. |
| `firebase.json` | `NEW` | Configures Firestore (`firestore.rules`), Cloud Functions (`functions/`), and Firebase Emulator Suite ports (Auth: 9099, Firestore: 8080, Functions: 5001, UI: 4000). |
| `firestore.rules` | `NEW` | Safe deny-by-default placeholder (`allow read, write: if false;`) for local emulator use. **Strictly banned from staging deployment in Step 3**. |
| `functions/package.json` | `NEW` | Scaffold package definition containing required runtime dependencies (`firebase-functions`, `firebase-admin`) and Node `>= 20` engine. |
| `functions/tsconfig.json` | `NEW` | TypeScript compiler configuration for Cloud Functions Node.js runtime. |
| `functions/src/index.ts` | `NEW` | Minimal export scaffold for Cloud Functions emulator initialization without business operations. |
| `functions/.gitignore` | `NEW` | Prevents committing `node_modules/`, `lib/`, and log files from the Cloud Functions directory. |
| `.env.example` | `NEW` | Safe reference template documenting configuration parameters. |
| `.env.local.example` | `NEW` | Pre-configured template for local emulator suite development (`demo-grabngo-local`). |
| `.env.staging.example` | `NEW` | Pre-configured template pointing to staging project `mad-lab-a9665`. |
| `src/config/environment.ts` | `NEW` | Typed environment configuration module. Resolves `'local'` (`demo-grabngo-local`) vs `'staging'` (`mad-lab-a9665`), validates parameters, safely logs active environment, and rejects `'production'`. Clarifies that mobile client does NOT invoke Functions emulator. |
| `src/config/firebase.ts` | `NEW` | Safe Firebase initializer and emulator connector with singleton guard. Connects emulators only in `'local'` mode; bypasses in `'staging'`; rejects production. Clarifies Functions emulator is not wired to client in Step 3. |
| `__tests__/environment.test.ts` | `NEW` | Foundation Jest unit test verifying environment resolution, defaults (`demo-grabngo-local`), and rejection of unknown/production environments. |
| `__tests__/emulator/emulator-test-scaffold.test.ts` | `NEW` | Scaffold for future emulator-backed end-to-end tests. |
| `__tests__/rules/rules-test-scaffold.test.ts` | `NEW` | Scaffold for future Firestore security rules allow/deny unit tests. |
| `__tests__/functions/functions-test-scaffold.test.ts` | `NEW` | Scaffold for future Cloud Functions business operations tests. |
| `__tests__/unit/unit-test-scaffold.test.ts` | `NEW` | Scaffold for isolated component and state unit tests. |
| `__tests__/integration/integration-test-scaffold.test.ts` | `NEW` | Scaffold for integration tests. |
| `docs/ci-setup-recommendation.md` | `NEW` | Comprehensive CI architecture documentation detailing dependency strategy (`npm ci`), stages, shell-agnostic secret scanning, and required secrets. |
| `.github/workflows/ci.yml` | `NEW` | Executable GitHub Actions workflow running clean install, recursive Node.js secret scanning, typecheck, lint, test, and Firebase alias validation. |
| `package.json` | `MODIFIED` | Added scripts: `"typecheck": "tsc --noEmit"`, `"test:watch": "jest --watch"`, and `"test:emulator": "jest --testPathPattern=__tests__/emulator"`. |
| `.gitignore` | `MODIFIED` | Enhanced with rules ignoring `.env*` (preserving templates), service account JSONs, and Firebase emulator debug logs. |
| `README.md` | `MODIFIED` | Replaced default boilerplate with comprehensive setup, emulator management, environment verification, quality commands, and deployment safety rules. |

---

## 3. Application Startup Wiring & Proof

### Startup Path Wiring
To guarantee that Firebase Auth and Firestore emulators are configured exactly once before any screen or database access occurs:
1. `index.js` invokes `configureFirebase()` before `AppRegistry.registerComponent(...)`.
2. `App.tsx` invokes `configureFirebase()` within a `useEffect` hook.
3. An internal singleton boolean flag (`isFirebaseConfigured`) ensures that initialization logic runs strictly once.

### Proof via Source Search
```
e:\Madlab\MADLAB1\index.js:8: import { configureFirebase } from './src/config/firebase';
e:\Madlab\MADLAB1\index.js:11: configureFirebase();
e:\Madlab\MADLAB1\App.tsx:5: import { configureFirebase } from "./src/config/firebase";
e:\Madlab\MADLAB1\App.tsx:9: configureFirebase();
```

---

## 4. Environment Strategy & Separation Architecture

```
                       ┌──────────────────────────────┐
                       │   React Native Mobile App    │
                       └──────────────┬───────────────┘
                                      │
                         index.js / App.tsx
                         (Startup: configureFirebase())
                                      │
                         src/config/environment.ts
                         (Active: __DEV__ ? 'local' : 'staging')
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
     [ APP_ENV=local ]                                  [ APP_ENV=staging ]
     Project: demo-grabngo-local                         Project: mad-lab-a9665
            │                                                   │
  useEmulator(10.0.2.2)                                  No emulators used
  (Auth:9099, Firestore:8080)                            (google-services.json)
            │                                                   │
  ┌──────────────────────┐                           ┌──────────────────────┐
  │ Firebase Emulators   │                           │ Cloud Firebase       │
  │ Auth:      9099      │                           │ Project:             │
  │ Firestore: 8080      │                           │ mad-lab-a9665        │
  │ Functions: 5001*     │                           └──────────────────────┘
  │ UI:        4000      │
  └──────────────────────┘
  *Functions emulator is scaffolded for CLI/test use; mobile client does NOT invoke it in Step 3.
```

### React Native Environment Variable Handling
React Native does not automatically bundle `.env` files into JS runtime without extra native modules. Environment configuration is centrally managed via `src/config/environment.ts`:
1. `__DEV__ ? 'local' : 'staging'` establishes the runtime environment safely.
2. `demo-grabngo-local` is designated for local emulator mode.
3. `.env.*.example` files act as contracts for developers and CI pipelines.

---

## 5. Firebase Project Aliases & Deployment Protection

In `.firebaserc`:
```json
{
  "projects": {
    "default": "demo-grabngo-local",
    "staging": "mad-lab-a9665"
  }
}
```
Setting `default` to `demo-grabngo-local` guarantees that standard CLI commands (such as `firebase deploy`) cannot inadvertently target the staging project `mad-lab-a9665`. Deployments to staging require explicit specification (`firebase deploy -P staging`), which remains prohibited in Step 3.

---

## 6. Functions Emulator Clarification

- Cloud Functions configuration (`functions/`) and emulator port (`5001`) are established for local Firebase CLI use and testing scaffolds.
- The mobile application client in Step 3 **does not** call the Cloud Functions emulator. Business operations (order placement, payment processing) are deferred to subsequent steps.

---

## 7. Security Rules & Staging Deployment Ban

`firestore.rules` is configured as a deny-by-default placeholder:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
> [!CAUTION]
> **STAGING DEPLOYMENT BAN**:
> Under no circumstances may `firestore.rules` be deployed to staging in Step 3. This ruleset is exclusively for local emulator testing. Deployment to staging will be enabled in Step 4+ only after authentication-aware rules and allow/deny test suites are completed and user approval is granted.
