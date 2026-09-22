# GrabNGo Step 3 — Known Limitations & Risk Analysis

**Report ID:** `step3-known-limitations.md`  
**Date:** September 21, 2026 (Updated with Mandated Corrections)  
**Auditor:** Senior React Native, Firebase & Security Engineer  

---

## 1. Executive Summary

This document enumerates the deliberate constraints, unexecuted operations, pre-existing code observations, archive filtering guidance, rollback instructions, and forward-looking risks associated with Step 3.

---

## 2. Unexecuted Operations & Local Workspace Blockers

### 1. Local `node_modules` Not Installed
- **Constraint:** In accordance with the prompt safety mandate ("Do not install dependencies in the audited workspace without explicit approval"), `npm install` / `npm ci` was not executed locally.
- **Impact:** Local commands `npm run typecheck`, `npm run lint`, and `npm test` cannot run locally until the developer runs `npm ci`.
- **Mitigation:** The configuration has been structured for automated CI execution via GitHub Actions (`.github/workflows/ci.yml`), where `npm ci` runs against the existing `package-lock.json`.

### 2. Global Firebase CLI Unavailable on Host
- **Constraint:** `firebase` is not installed as a global system command in this specific host environment.
- **Impact:** Running `firebase emulators:start` requires developers to install `firebase-tools` (`npm install -g firebase-tools`) or run via `npx firebase-tools`.

### 3. Staging Deployment Intentionally Banned
- **Constraint:** Per Step 3 rules and User Correction #2 & #6, `firestore.rules` and Cloud Functions MUST NOT be deployed to staging in Step 3.
- **Impact:** The staging project `mad-lab-a9665` remains in its current state until Step 4+ authentication, security rules, and tests are implemented.

### 4. Cloud Functions Not Called by Mobile App
- **Constraint:** The mobile app client in Step 3 connects Auth and Firestore to emulators only. It does not invoke the Functions emulator because business operations are scheduled for later steps.

---

## 3. Archive Exclusion Guidance for Safe Example Files

When generating project archives (e.g. via PowerShell `Compress-Archive`), using a naive filter such as `$_.Name -notmatch "^\.env($|\.)"` inadvertently excludes `.env.example`, `.env.local.example`, and `.env.staging.example`.

### Corrected PowerShell Archive Command:
```powershell
$source = "E:\Madlab\MADLAB1"
$destination = "E:\Madlab\GrabNGo-Step3"

New-Item -ItemType Directory -Force -Path $destination | Out-Null

Get-ChildItem -Path $source -Recurse -File |
  Where-Object {
    $_.FullName -notmatch "\\node_modules\\" -and
    $_.FullName -notmatch "\\android\\.gradle\\" -and
    $_.FullName -notmatch "\\android\\app\\build\\" -and
    $_.FullName -notmatch "\\ios\\Pods\\" -and
    $_.FullName -notmatch "\\build\\" -and
    $_.FullName -notmatch "\\dist\\" -and
    # Exclude secret .env files while preserving .env.*.example templates:
    ($_.Name -notmatch "^\.env($|\.)" -or $_.Name -match "\.example$") -and
    $_.Extension -notin @(".pem", ".key") -and
    $_.Name -notmatch "serviceAccount.*\.json" -and
    $_.Name -notmatch ".*-adminsdk-.*\.json"
  } |
  ForEach-Object {
    $relative = $_.FullName.Substring($source.Length + 1)
    $target = Join-Path $destination $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item $_.FullName $target
  }

Compress-Archive -Path "$destination\*" -DestinationPath "E:\Madlab\GrabNGo-Step3.zip" -Force
Remove-Item -Recurse -Force $destination
```

---

## 4. Pre-existing Code Observations & Files Deliberately Preserved

1. **`backend/` Directory (Mock Express Server)**:
   - Contains an existing Express server (`backend/server.js`) with OTP routes and an empty `backend/db.js`.
   - **Action Taken:** Preserved completely without modification. The approved architecture requires Firebase Cloud Functions for business operations, but existing code was not deleted to preserve historical context until migration.
2. **`android/app/google-services.json`**:
   - Matches project `mad-lab-a9665` and package `com.madlab1`.
   - **Action Taken:** Preserved without alteration.
3. **Application Screens and Components (`src/screens/`, `src/components/`)**:
   - Left untouched to prevent premature changes to authentication, cart, or order flows.

---

## 5. Rollback Instructions

If it becomes necessary to completely undo Step 3 changes:

### Option A: Discard uncommitted changes on `development` branch
```bash
git checkout development
git clean -fd
git restore .
```

### Option B: Switch back to `main` branch
```bash
git checkout main
# To delete the development branch completely:
git branch -D development
```

All modifications are strictly isolated to the `development` branch; the `main` branch remains at commit `7634d52 Initial commit` untouched.
