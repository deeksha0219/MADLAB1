# GrabNGo Step 6 — Security & Authorization Test Report

**Report ID:** `step6-security-tests.md`  
**Date & Time:** September 21, 2026, 22:00 IST  
**Auditor:** Principal Firebase Security Architect & Penetration Tester  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `7634d52` (Uncommitted Step 6 working tree)  
**Local Environment & Emulator Ports:**  
- Firebase Auth Emulator: `127.0.0.1:9099`  
- Cloud Firestore Emulator: `127.0.0.1:8085` (re-mapped from 8080 due to host AgentService conflict)  
- Cloud Functions Emulator: `127.0.0.1:5001`  
- Firebase Emulator Hub / UI: `127.0.0.1:4000`  
**Staging Status:** Read-only (`mad-lab-a9665`); Step 6 Rules & Functions NOT deployed.  
**Production Status:** Untouched.  
**Billing Status:** Spark Free Tier (Blaze upgrade prohibited).  
**Legacy Data Status:** Untouched; no legacy migrations performed.  

---

## 1. Executive Summary

This report documents the security and authorization test results for Step 6, covering the catalog subcollection hierarchy (`canteens`, `categories`, `items`, and `private/admin`). Testing was executed using `@firebase/rules-unit-testing` against the real live Cloud Firestore Emulator on port 8085. 

All 28 security rule assertions passed with 100% compliance. Direct client database mutations are completely denied, multi-tenant canteen admin boundaries are strictly enforced, and student queries are filtered by visibility and availability.

---

## 2. Security Test Matrix & Exact Results

### 2.1 Test Execution Command
```bash
npm run test:rules:emulator
```
Underlying execution command:
```bash
npx firebase-tools emulators:exec --only firestore --project demo-grabngo-local "node scripts/run-emulator-rules-test.js"
```

### 2.2 Live Emulator Security Rules Test Results

```
i  emulators: Starting emulators: firestore
i  emulators: Detected demo project ID "demo-grabngo-local", emulated services will use a demo configuration.
i  firestore: Firestore Emulator logging to firestore-debug.log
+  firestore: Firestore Emulator UI websocket is running on 9150.
i  Running script: node scripts/run-emulator-rules-test.js
[Emulator Tests] Initializing test environment against Firestore Emulator on port 8085...

--- Seeding Initial Test Fixtures ---

--- Step 4: User & Admin Security Rules ---
  ✓ PASS: Direct client profile create is DENIED
  ✓ PASS: Unauthenticated read of student profile is DENIED
  ✓ PASS: Student reading own profile is ALLOWED
  ✓ PASS: Student reading another student profile is DENIED
  ✓ PASS: Student updating allowed fields (name, collegeId, updatedAt) is ALLOWED
  ✓ PASS: Student escalating role is DENIED
  ✓ PASS: Client writing directly to /admins collection is DENIED

--- Step 6: Public / Student Catalog Access Tests ---
  ✓ PASS: Unauthenticated read of canteens is DENIED
  ✓ PASS: Authenticated student can read active canteen
  ✓ PASS: Authenticated student reading inactive canteen is DENIED
  ✓ PASS: Authenticated student can read active category
  ✓ PASS: Authenticated student reading inactive category is DENIED
  ✓ PASS: Authenticated student can read available & active menu item
  ✓ PASS: Authenticated student reading unavailable menu item is DENIED
  ✓ PASS: Authenticated student reading inactive menu item is DENIED
  ✓ PASS: Authenticated student reading private/admin subcollection is DENIED
  ✓ PASS: Student cannot write/create canteens
  ✓ PASS: Student cannot write/create categories
  ✓ PASS: Student cannot write/create menu items
  ✓ PASS: Student cannot tamper with menu item price directly
  ✓ PASS: Student cannot tamper with item availability directly

--- Step 6: Admin Access & Isolation Tests ---
  ✓ PASS: Assigned active admin can read unavailable item in own canteen
  ✓ PASS: Assigned active admin can read inactive item in own canteen
  ✓ PASS: Assigned active admin can read private/admin subcollection
  ✓ PASS: Active admin reading private data of UNASSIGNED canteen is DENIED
  ✓ PASS: Suspended/inactive admin reading private data is DENIED
  ✓ PASS: Direct client write by admin is DENIED (enforcing Cloud Functions write path)
  ✓ PASS: Admin cannot self-assign additional canteenIds

[Real Emulator Tests Summary] Total: 28 | Passed: 28 | Failed: 0
+  Script exited successfully (code 0)
i  emulators: Shutting down emulators.
```

---

## 3. Detailed Security Findings

### 3.1 Principle of Least Privilege: Read Surface
- **Unauthenticated Denial:** Any request without valid Firebase Authentication tokens is rejected at root level.
- **Student Visibility Filter:** Students can only read documents where `isActive == true`. For menu items, `isAvailable == true` is additionally required.
- **Confidential Subcollection Isolation:** The `canteens/{canteenId}/items/{itemId}/private/{docId}` subcollection stores sensitive wholesale pricing (`costPrice`), kitchen internal notes, and supplier info. Access is restricted strictly to active canteen admins assigned to `{canteenId}`. Non-admin or unassigned-admin reads return `PERMISSION_DENIED`.

### 3.2 Closed Client Mutation Surface
- All catalog writes (`create`, `update`, `delete`) in client code are blocked (`allow write: if false;`).
- All administrative mutations must execute through the trusted Firebase Cloud Functions backend.
- Students and untrusted callers cannot tamper with prices, descriptions, availability flags, or timestamps.

### 3.3 Multi-Tenant Canteen Admin Isolation
- Admins are assigned specific canteens via `admins/{uid}.canteenIds`.
- Admins assigned to `BIG_MINGOS` are denied access to private records of `LIBRARY_CANTEEN`.
- Suspended admins (`status != 'active'`) are denied all administrative privileges.
- Admins cannot self-escalate or self-assign additional canteen IDs.

### 2.3 Live Emulator Callable Functions Security & Validation Results
```bash
npm run test:functions:emulator
# Underlying: npx firebase-tools emulators:exec --only auth,firestore,functions --project demo-grabngo-local "node scripts/run-emulator-functions-test.js"
```

Key security assertions verified:
- **Authentication:** Unauthenticated calls to all 10 functions rejected with `unauthenticated`.
- **Student Authorization:** Authenticated students rejected from all administrative functions with `permission-denied`.
- **Admin Assignment:** Inactive/suspended admins and cross-canteen admins rejected with `permission-denied`.
- **Platform Operator Authorization:** Ordinary canteen admins denied `createCanteen`; only platform operators permitted.
- **Input Sanitization:** Unknown parameters, negative numbers, floats, empty strings, oversized strings, and non-HTTPS URLs rejected with `invalid-argument`.
- **Private Data Isolation:** Wholesale cost price and internal notes stored exclusively in `private/admin` subcollection and omitted from public responses.

```
[Emulator Function Tests Summary] Total: 54 | Passed: 54 | Failed: 0
+  Script exited successfully (code 0)
```

---

## 3. Detailed Security Findings

### 3.1 Principle of Least Privilege: Read Surface
- **Unauthenticated Denial:** Any request without valid Firebase Authentication tokens is rejected at root level.
- **Student Visibility Filter:** Students can only read documents where `isActive == true`. For menu items, `isAvailable == true` is additionally required.
- **Confidential Subcollection Isolation:** The `canteens/{canteenId}/items/{itemId}/private/{docId}` subcollection stores sensitive wholesale pricing (`costPrice`), kitchen internal notes, and supplier info. Access is restricted strictly to active canteen admins assigned to `{canteenId}`. Non-admin or unassigned-admin reads return `PERMISSION_DENIED`.

### 3.2 Closed Client Mutation Surface
- All catalog writes (`create`, `update`, `delete`) in client code are blocked (`allow write: if false;`).
- All administrative mutations must execute through the trusted Firebase Cloud Functions backend.
- Students and untrusted callers cannot tamper with prices, descriptions, availability flags, or timestamps.

### 3.3 Multi-Tenant Canteen Admin Isolation
- Admins are assigned specific canteens via `admins/{uid}.canteenIds`.
- Admins assigned to `BIG_MINGOS` are denied access to private records of `LIBRARY_CANTEEN`.
- Suspended admins (`status != 'active'`) are denied all administrative privileges.
- Admins cannot self-escalate or self-assign additional canteen IDs.

---

## 4. Rollback & Revert Procedure
To revert the security rules and function tests:
```bash
git checkout HEAD -- .
git clean -fd
```
The database rules and functions will immediately revert to the Step 4 baseline.

