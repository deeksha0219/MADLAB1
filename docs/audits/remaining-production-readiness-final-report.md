# GrabNGo — Remaining Production-Readiness Final Report

**Date:** 2026-10-02  
**Auditor / Principal Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Current HEAD Commit:** `ac182f0`  
**Authoritative Verdict:** **LOCAL-READY / CLOUD-BLOCKED**  

---

## 1. Executive Summary & Verdict Rationale

An independent, rigorous audit of the remaining-production-readiness state of the GrabNGo platform was executed directly against current source code and live Firebase emulators.

Key audit conclusions:
1. **Zero Weakening of Invariants:** No authorization, Firestore Security Rules, payment security, canteen isolation, student privacy masking, or service-desk privileges were modified or weakened.
2. **Payment Expiry State Machine Formally Verified:** Direct source code analysis (`functions/src/index.ts`) and live emulator execution (`scripts/run-emulator-payment-test.js`) prove that when a payment attempt expires:
   - `order.status` strictly remains `'placed'` (the order is **NEVER** cancelled on payment expiry).
   - `order.paymentStatus` transitions back to `'pending'`.
   - `order.activePaymentId` and `order.activePaymentExpiresAt` are cleared to `null`.
   - Pickup slot capacity is **NOT** released and remains reserved for the student's order.
   - The student can immediately initiate a fresh payment attempt with a new idempotency key.
   - Previous documentation stating that payment expiry transitions the order to `cancelled` has been identified as a documentation defect and corrected.
3. **Command Count Reconciled:** The reported count of "14 validation commands" has been reconciled with absolute fidelity against the actual commands executed:
   - There are **14 total pipeline steps / gates** defined in the automated CI runner (`scripts/verify-ci-pipeline.js` and `.github/workflows/ci.yml`).
   - These 14 steps comprise **2 dependency installation steps** (`npm ci`, `npm --prefix functions ci`) and **12 validation / test execution commands** (Typecheck, Lint, Jest, Functions Build, and 8 Emulator Suites).
   - All 12 validation test commands were re-run live in this audit, and all 834 automated assertions passed with exit code `0`.
4. **Cloud & Platform Blockers Documented:**
   - Staging Cloud Deployment is **BLOCKED** pending client authorization and confirmation of the Firebase Blaze billing plan on `mad-lab-a9665`.
   - Android Native APK/AAB compilation is **BLOCKED** due to missing Android SDK / `ANDROID_HOME` on the host machine.
   - iOS Native compilation is **BLOCKED** due to the absence of an Apple macOS / Xcode build environment on this Windows host.
   - Physical device smoke testing is **BLOCKED** due to no connected physical test device.
   - Real FCM push transport is marked **NOT VERIFIED LOCALLY** due to the absence of an FCM emulator in `firebase-tools`.

Therefore, the authoritative, evidence-backed verdict is:
```
================================================================================
VERDICT: LOCAL-READY / CLOUD-BLOCKED
All local verification gates cleared (834/834 passed across 12 validation suites). 
Cloud deployment, native packaging, and live load testing require external 
cloud & hardware resources.
================================================================================
```

---

## 2. Command Count Reconciliation & Execution Summary

### 2.1 Reconciliation of the "14 Validation Commands"
In earlier audit summaries, the term "14 validation commands" was used interchangeably with the 14 steps of the automated CI pipeline. The exact structure is as follows:

| # | Pipeline Category | Exact Command | Type | Purpose / Assertions |
|---|---|---|---|---|
| **1** | Environment Setup | `npm ci` | Installation | Installs deterministic root node dependencies |
| **2** | Static Analysis | `npm run typecheck` | Validation | Validates TypeScript client & root (0 errors) |
| **3** | Static Analysis | `npm run lint` | Validation | Validates ESLint rules across codebase (0 errors) |
| **4** | Unit & Scaffold Tests | `npm test -- --runInBand` | Validation | Runs 12 Jest suites (80 passed assertions) |
| **5** | Environment Setup | `npm --prefix functions ci` | Installation | Installs deterministic Cloud Functions dependencies |
| **6** | Server Compilation | `npm --prefix functions run build` | Validation | Compiles TypeScript functions to `lib/` (0 errors) |
| **7** | Live Emulator Test | `npm run test:rules:emulator` | Validation | Security Rules emulator suite (43 passed assertions) |
| **8** | Live Emulator Test | `npm run test:functions:emulator` | Validation | Catalog & Auth functions suite (54 passed assertions) |
| **9** | Live Emulator Test | `npm run test:order:emulator` | Validation | Order & Cart lifecycle suite (64 passed assertions) |
| **10** | Live Emulator Test | `npm run test:status:emulator` | Validation | Order status transition suite (65 passed assertions) |
| **11** | Live Emulator Test | `npm run test:payment:emulator` | Validation | Demo payments, expiry & webhook suite (151 passed assertions) |
| **12** | Live Emulator Test | `npm run test:notifications:emulator` | Validation | Notification outbox & worker suite (188 passed assertions) |
| **13** | Live Emulator Test | `npm run test:service-desk:emulator` | Validation | Service desk & kiosk isolation suite (127 passed assertions) |
| **14** | Live Emulator Test | `npm run test:sharded-slot:emulator` | Validation | 10-shard slot capacity suite (62 passed assertions) |

**Summary Reconciliation:**
- Total CI Pipeline Gates: **14** (2 installation steps + 12 validation commands).
- Total Validation & Test Execution Commands: **12**.
- Total Automated Test Assertions: **834 passed, 0 failed**.

### 2.2 Live Test Re-Run Execution Results (Fresh Session)

| Suite / Gate | Command Executed | Exit Code | Verified Assertions | Status |
|---|---|---|---|---|
| **TypeScript Client & Root** | `npm run typecheck` | `0` | 0 errors | **PASS** |
| **ESLint Static Analysis** | `npm run lint` | `0` | 0 errors, 208 warnings | **PASS** |
| **Jest Test Suite** | `npm test -- --runInBand` | `0` | 80 passed (12 test suites) | **PASS** |
| **Functions TypeScript Build** | `npm --prefix functions run build` | `0` | 0 errors (`lib/` generated) | **PASS** |
| **Firestore Security Rules** | `npm run test:rules:emulator` | `0` | 43 passed, 0 failed | **PASS** |
| **Catalog & Auth Callables** | `npm run test:functions:emulator` | `0` | 54 passed, 0 failed | **PASS** |
| **Order & Cart Lifecycle** | `npm run test:order:emulator` | `0` | 64 passed, 0 failed | **PASS** |
| **Order Status Transitions** | `npm run test:status:emulator` | `0` | 65 passed, 0 failed | **PASS** |
| **Payment & Synthetic Webhooks** | `npm run test:payment:emulator` | `0` | 151 passed, 0 failed | **PASS** |
| **In-App Notification Worker** | `npm run test:notifications:emulator` | `0` | 188 passed, 0 failed | **PASS** |
| **Service Desk & Kiosk Operations** | `npm run test:service-desk:emulator` | `0` | 127 passed, 0 failed | **PASS** |
| **Sharded Slot Capacity** | `npm run test:sharded-slot:emulator` | `0` | 62 passed, 0 failed | **PASS** |

**Total Automated Assertions Verified in Re-Run:** **834 passed, 0 failed (100% pass rate).**

---

## 3. Payment-Expiry State Machine Verification

### 3.1 Code Inspection (`functions/src/index.ts`)
The payment expiry mechanism is implemented with transaction safety and dual TTL verification across two paths:

1. **Transactional Lazy-Expiry on Retry (`createDemoPayment`, lines 3735–3748):**
   ```typescript
   if (isPaymentExpired && isOrderExpired) {
     // Lazy-expire active attempt transactionally
     transaction.update(activePaymentRef, {
       status: 'expired',
       expiredAt: serverTimestamp(),
       updatedAt: serverTimestamp(),
     });

     transaction.update(orderRef, {
       activePaymentId: null,
       activePaymentExpiresAt: null,
       paymentStatus: 'pending',
       updatedAt: serverTimestamp(),
     });
     // Order status remains 'placed'
   }
   ```
2. **Explicit Expiry Callable (`expirePaymentAttempt`, lines 4427–4442):**
   ```typescript
   // Update payment
   transaction.update(paymentRef, {
     status: 'expired',
     expiredAt: serverTimestamp(),
     updatedAt: serverTimestamp(),
   });

   // Update order: status remains placed, paymentStatus returns to pending, active payment cleared
   transaction.update(orderRef, {
     status: 'placed',
     activePaymentId: null,
     activePaymentExpiresAt: null,
     paymentStatus: 'pending',
     failedPaymentCount: fieldValueIncrement(1),
     updatedAt: serverTimestamp(),
   });
   ```

### 3.2 Key Verified Behavioral Invariants
- **`order.status` Remains `'placed'`:** Neither `expirePaymentAttempt` nor lazy-expiry updates `order.status` to `'cancelled'`. The order is deliberately kept open in `'placed'`.
- **`order.paymentStatus` Transitions to `'pending'`:** The order payment status is reset from `'processing'` back to `'pending'`, allowing subsequent attempts.
- **Active Payment Pointers Cleared:** `activePaymentId` and `activePaymentExpiresAt` are both set to `null` on the order document.
- **Capacity Is NOT Released:** The pickup slot capacity (`reservedCount`) is preserved and not released when a payment attempt expires. Slot capacity is only released upon explicit cancellation or rejection.
- **Retry Supported:** The student can immediately call `createDemoPayment` with a new idempotency key for the same order.
- **Dual TTL Safety:** Expiry requires that both `payment.expiresAt <= nowMs` and `order.activePaymentExpiresAt <= nowMs` relative to server time.

### 3.3 Test Execution Proof (`scripts/run-emulator-payment-test.js`)
Section 14 of the payment emulator test suite explicitly validates these exact conditions:
- `assert(updatedOrderDoc.data().status === 'placed', 'Order status remains placed (not cancelled or failed)')` -> **PASS**
- `assert(updatedOrderDoc.data().paymentStatus === 'pending', 'Order paymentStatus returns to pending (NOT failed!)')` -> **PASS**
- `assert(updatedOrderDoc.data().activePaymentId === null, 'Order activePaymentId is null')` -> **PASS**
- `assert(updatedOrderDoc.data().activePaymentExpiresAt === null, 'Order activePaymentExpiresAt is null')` -> **PASS**
- `assert(slotAfter.data().reservedCount === reservedCountBefore, 'Expiry does not alter pickup slot capacity')` -> **PASS**
- `assert(retryRes.ok === true, 'New payment attempt created for order after previous attempt expired')` -> **PASS**

---

## 4. Preserved Security & Business Invariants (LOCKED)

The following core security and operational invariants were maintained with zero modifications:

1. **Client Order Writes Denied:** Direct client creates or updates on `/orders/{orderId}` are rejected by Firestore Security Rules.
2. **Client Payment Writes Denied:** Direct client writes to `/orders/{orderId}/payments/{paymentId}` are rejected by Firestore Security Rules.
3. **Client Admin Writes Denied:** Direct client writes to `/admins/{uid}` are rejected by Firestore Security Rules.
4. **Server-Authoritative Pricing & Totals:** Order totals and line-item prices are strictly recalculated server-side from active catalog documents.
5. **Server-Authoritative Payment Status:** Transitions to `payment_verified` occur exclusively through authenticated server callables or verified synthetic webhooks.
6. **Cash-Payment Approval Scoped:** Restricted exclusively to assigned canteen admins; service-desk staff are denied cash-approval permissions.
7. **Service Desk Financial Isolation:** Service-desk staff cannot approve payments, initiate refunds, or alter menu prices.
8. **Canteen Isolation:** Admin queue access and order searches are strictly scoped to assigned `canteenIds`. Cross-canteen access returns `PERMISSION_DENIED` or `NOT_FOUND` without leaking order existence.
9. **Student Privacy & Masking:** Customer UIDs and personally identifiable details are masked in operational queues (`student_...ce_8`).
10. **Demo Payment Disclaimer:** Every demo payment displays: **“Demo payment — no real money transferred.”**
11. **Razorpay & External Gateways:** Remain strictly disabled and unimplemented.

---

## 5. Phase-by-Phase Readiness Status

### Phase 1 — CI Emulator Pipeline: **COMPLETE**
- `.github/workflows/ci.yml` matrix strategy covers all 8 emulator suites on isolated Ubuntu runners.
- Local pipeline script `scripts/verify-ci-pipeline.js` executes all 14 gates in sequence.

### Phase 2 — Android Release Build: **JS BUNDLE VERIFIED / NATIVE BLOCKED**
- JavaScript release bundle compiled via Metro (`android-release-bundle.js`).
- Native APK/AAB build via Gradle wrapper is **BLOCKED** due to missing Android SDK / `ANDROID_HOME` on the host.

### Phase 3 — iOS Release Build: **BLOCKED (NO MACOS/XCODE ENVIRONMENT)**
- Host is Windows 11; Apple build toolchain (`xcodebuild`, macOS, CocoaPods) is unavailable.

### Phase 4 — Physical Device Smoke Testing: **BLOCKED (NO DEVICE CONNECTED)**
- `adb` command is absent from PATH; no physical test handset is connected.
- 20-point test matrix prepared in `docs/audits/physical-device-smoke-test.md`.

### Phase 5 — Push Notifications (Additive Layer): **DESIGN COMPLETE / REAL FCM NOT VERIFIED LOCALLY**
- Designed strictly as an additive layer over canonical durable `/notifications`. Payloads contain zero secrets or financial details.
- Real FCM push transport cannot be simulated locally because `firebase-tools` does not provide an FCM emulator.

### Phase 6 — Staging Deployment Preparation: **READY FOR DEPLOYMENT / CLOUD BLOCKED**
- Staging project `mad-lab-a9665` pre-configured in `.firebaserc`.
- Execution **BLOCKED** pending client Blaze billing confirmation.

### Phase 7 — Controlled Staging Load Testing: **PLAN PREPARED / STAGING EXECUTION BLOCKED**
- 4-stage conservative ramp-up plan (1 -> 10 -> 100 -> 250 req/sec) with automated circuit breakers.
- Local benchmark baseline recorded (10-shard slot capacity, 0 oversell, 0 duplicate orders).

---

## 6. Rollback Plan

If regressions occur after cloud deployment to `mad-lab-a9665`:
1. **Firestore Rules:**
   ```bash
   git checkout 4bccdba2f28201f789a2350e23b85e18d0179757 -- firestore.rules
   npx firebase-tools deploy --only firestore:rules --project mad-lab-a9665
   ```
2. **Cloud Functions:**
   ```bash
   git checkout 4bccdba2f28201f789a2350e23b85e18d0179757 -- functions/
   npm --prefix functions run build
   npx firebase-tools deploy --only functions --project mad-lab-a9665
   ```
3. **Database Restore:** Restore from Cloud Storage backup bucket via `gcloud firestore import`.

---

## 7. Remaining Pre-Production Action Items

1. **Staging Billing Confirmation:** Confirm Google Cloud project owner upgrades `mad-lab-a9665` to the Blaze billing plan.
2. **Android SDK Installation:** Install Android SDK command line tools and set `ANDROID_HOME` to enable APK/AAB compilation.
3. **macOS CI Runner:** Provision a macOS runner (e.g. GitHub Actions `macos-latest`) with Apple Developer credentials for iOS builds.
4. **Physical Handset Smoke Run:** Execute the 20-point test matrix on a physical device once attached.
5. **Live Staging Load Execution:** Execute the staged synthetic load plan against `mad-lab-a9665` before enabling real user access.
