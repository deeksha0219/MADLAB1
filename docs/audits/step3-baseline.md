# GrabNGo Step 3 — Baseline Inspection Report

**Report ID:** `step3-baseline.md`  
**Date:** September 21, 2026  
**Auditor:** Senior React Native, Firebase & Security Engineer  

---

## 1. Executive Summary

This report establishes the verified baseline of the GrabNGo mobile application codebase prior to Step 3 foundation and environment configuration. The baseline was inspected non-destructively in the active workspace at `e:\Madlab\MADLAB1`.

---

## 2. Git State & Branch Inspection

### Inspection Commands & Results
```bash
$ git status --short
# (Clean working tree, no modifications relative to index)

$ git branch --show-current
main

$ git log -1 --oneline
7634d52 Initial commit

$ git remote -v
origin  https://github.com/deeksha0219/MADLAB1.git (fetch)
origin  https://github.com/deeksha0219/MADLAB1.git (push)
```

- **Initial Branch:** `main`
- **Initial Commit:** `7634d52 Initial commit`
- **Working Tree:** Verified completely clean prior to branching.
- **Target Branch for Step 3:** Created and switched to `development` (`git checkout -b development`) per branching protocol.

---

## 3. Tooling & Environment Prerequisites

| Tool | Status / Version | Notes |
|---|---|---|
| **Node.js** | `v23.9.0` | Exceeds project requirement (`>= 22.11.0`). |
| **npm** | `11.6.2` | Available and functional. |
| **Java (JDK)** | `24.0.2` (64-Bit) | Java runtime present; supports Android build tools and Firebase Emulator Suite. |
| **Firebase CLI** | Not recognized globally in PATH | `firebase-tools` is not installed globally on this host. Can be invoked via `npx firebase` when dependencies/cache are available. |
| **Android SDK / adb** | `adb` not in system PATH | `ANDROID_HOME` not exported in current shell environment. |
| **node_modules** | Missing (`False`) | `node_modules` does not exist in the root repository. In compliance with safety rules, dependencies are NOT installed in the local audit workspace without user approval. |

---

## 4. Root Project Structure & Existing Configurations

### Core Technologies
- **React Native Framework:** `0.85.1`
- **React:** `19.2.3`
- **TypeScript:** `^5.8.3` (configured via `tsconfig.json` extending `@react-native/typescript-config`)
- **Package Manager:** `npm` with existing `package-lock.json` (517,852 bytes)
- **Babel:** `babel.config.js` with `@react-native/babel-preset`
- **Metro:** `metro.config.js` with `@react-native/metro-config`
- **Linter & Formatter:** `.eslintrc.js` extending `@react-native`, `.prettierrc.js`
- **Unit Testing:** `jest.config.js` with `@react-native/jest-preset`, Jest `^29.6.3`

### Existing Backend Directory
- An existing directory `backend/` was present containing a mock Express server (`express: ^5.2.1`, `firebase-admin: ^13.8.0`) with placeholder OTP routes and empty `db.js`.
- This mock backend is completely separate from the approved architecture (which mandates Firebase Cloud Functions as the sole trusted backend).

### Existing Firebase Configuration
- `android/app/google-services.json` was detected and verified:
  - **Project ID:** `mad-lab-a9665`
  - **Android Package:** `com.madlab1`
- Matches the approved staging Firebase project specification.
- No prior `firebase.json` or `.firebaserc` files existed in the root repository.

---

## 5. Security Findings at Baseline

1. **Incomplete `.gitignore`**:
   - The baseline `.gitignore` did not ignore `.env*` files (except Xcode local envs), service account private key JSON files (`*serviceAccount*.json`, `*-adminsdk-*.json`), or Firebase emulator debug logs.
2. **Missing Deny-by-Default Security Rules**:
   - No Firestore security rules were present.
3. **No Environment Separation**:
   - The application lacked a formal mechanism to toggle between local emulators and staging, creating a risk of accidental staging modification during development.

---

## 6. Baseline Assumptions & Scope Boundaries

- **Staging Project:** Fixed to `mad-lab-a9665`.
- **Production Project:** Strictly not configured and explicitly rejected.
- **Out of Scope for Step 3:** Student authentication, admin roles, business security rules, cart checkout logic, payment processing, or UI redesign.
