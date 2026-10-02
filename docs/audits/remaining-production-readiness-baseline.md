# GrabNGo — Remaining Production-Readiness Baseline & Invariant Lock

**Date:** 2026-10-02  
**Auditor / Production Readiness Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Baseline Commit:** `4bccdba2f28201f789a2350e23b85e18d0179757`  
**Worktree Status:** Clean (0 uncommitted changes at baseline checkpoint)  

---

## 1. Environment & Hardware Inventory

| Item | Detected Value / Status | Note |
|---|---|---|
| **OS** | Windows 11 / Windows NT | Non-macOS environment |
| **Node.js** | `v23.9.0` | Node 23 host runtime |
| **npm** | `11.6.2` | Package manager |
| **Java SDK** | `24.0.2` (Java(TM) SE Runtime Environment build 24.0.2+12-54) | JDK present on host |
| **Android SDK / adb** | `adb` command not found in PATH; `ANDROID_HOME` / `ANDROID_SDK_ROOT` unset | Local Android build environment incomplete without Android SDK PATH |
| **Firebase CLI** | `15.7.0` | CLI installed via npm/npx |
| **React Native** | `0.85.1` (CLI: `20.1.0`) | React Native root framework |
| **Emulator Ports** | Auth: `9099`, Firestore: `8085`, Functions: `5001`, UI: `4000` | Configured in `firebase.json` |
| **Available Android Devices** | None (`adb` unavailable, no physical device connected) | Physical device testing requires connected device |
| **macOS / Xcode Availability** | **UNAVAILABLE (False)** | Running on Windows; iOS native builds are **BLOCKED** |
| **Staging Firebase Project** | `mad-lab-a9665` (Display Name: `MAD LAB`, Number: `551837939638`) | Present in `.firebaserc` as `staging` |
| **Staging Project on Blaze** | **Unconfirmed / Unknown** | Deployment without confirmed billing is strictly disallowed by safety gate |

---

## 2. Baseline Test Results & Assertion Lock

All 834 automated assertions were executed against local Firebase emulators and current source code, exiting with code 0:

| Scope / Suite | Command | Assertions | Status | Exit Code |
|---|---|---|---|---|
| **TypeScript (Client & Root)** | `npm run typecheck` | 0 errors | PASS | `0` |
| **Lint (Client)** | `npm run lint` | 0 errors, 208 warnings | PASS | `0` |
| **Jest Core Unit & Scaffold** | `npm test -- --runInBand` | 80 passed | PASS | `0` |
| **Functions TypeScript Build** | `npm --prefix functions run build` | 0 errors | PASS | `0` |
| **Firestore Security Rules** | `npm run test:rules:emulator` | 43 passed | PASS | `0` |
| **Catalog & Canteen Functions** | `npm run test:functions:emulator` | 54 passed | PASS | `0` |
| **Order & Cart Lifecycle** | `npm run test:order:emulator` | 64 passed | PASS | `0` |
| **Order Status Transitions** | `npm run test:status:emulator` | 65 passed | PASS | `0` |
| **Payment & Synthetic Webhooks** | `npm run test:payment:emulator` | 151 passed | PASS | `0` |
| **In-App Notification Worker** | `npm run test:notifications:emulator` | 188 passed | PASS | `0` |
| **Service Desk & Kiosk Operations** | `npm run test:service-desk:emulator` | 127 passed | PASS | `0` |
| **Sharded Capacity Slots** | `npm run test:sharded-slot:emulator` | 62 passed | PASS | `0` |

**Total Automated Assertions Verified:** **834 passed, 0 failed.**

---

## 3. Existing Security & Operational Invariants (LOCKED)

The following invariants are inviolable and must remain unchanged:

1. **Client Order Writes Denied:** The mobile client cannot create or update order documents directly in Firestore (`firestore.rules` denies write on `/orders/{orderId}`). Orders must be created strictly through `createOrder` Cloud Function.
2. **Client Payment Writes Denied:** The mobile client cannot create or update payment documents directly (`firestore.rules` denies read/write on `/orders/{orderId}/payments/{paymentId}`).
3. **Client Admin Writes Denied:** The mobile client cannot write directly to `/admins/{uid}`. Role and admin management is restricted to server-side operator callables (`assignAdminRole`, `setAdminStatus`).
4. **Client Notification Writes Denied:** The mobile client cannot write directly to `/notifications/{notificationId}` or `/notificationOutbox/{outboxId}`.
5. **Server-Authoritative Pricing & Totals:** Cart item prices and order totals are recalculated server-side in `createOrder` using authoritative menu item documents. Client-provided prices are ignored.
6. **Server-Authoritative Payment Status:** Payment status transitions are strictly server-authoritative (`createDemoPayment`, `completeDemoPayment`, `verifySyntheticWebhook`, `recordCashPaymentApproved`).
7. **Restricted Cash Payment Approval:** Cash payment approval is restricted to authorized canteen admins for their assigned canteen; service-desk staff cannot approve payments.
8. **Service Desk Financial Isolation:** Service-desk staff (`service_desk` role) cannot approve payments, initiate refunds, modify prices, or alter payment records.
9. **Canteen Isolation:** Operational queue access and order searches are strictly scoped to the admin/staff member's assigned `canteenIds`. Cross-canteen access returns `PERMISSION_DENIED` or `NOT_FOUND` without leaking existence.
10. **Student Privacy & Masking:** Customer UIDs and personally identifiable information are masked in admin and service-desk queue responses (`student_...ce_8`). Students cannot read other students' orders or profiles.
11. **Demo Payment Invariant:** Demo payments are strictly synthetic and must display: **“Demo payment — no real money transferred.”**
12. **No Real Payment Gateway:** Razorpay and external payment gateways remain disabled and unimplemented.

---

## 4. Existing Order-State & Payment Lifecycle State Machines

### 4.1 Order Status Transitions (`order.status`)
The order lifecycle state machine strictly enforces the following server-authoritative transitions:

- `draft` -> `placed` (created via `createOrder`)
- `placed` -> `payment_verified` (on successful demo payment via `completeDemoPayment` or verified synthetic webhook)
- `placed` -> `accepted` (for cash orders approved by canteen admin via `recordCashPaymentApproved` or auto-eligible operational transitions)
- `payment_verified` -> `accepted` (by canteen admin or operational service desk transition)
- `accepted` -> `preparing` (by kitchen / service desk)
- `preparing` -> `ready_for_pickup` (by kitchen / service desk)
- `ready_for_pickup` -> `completed` (upon handover to student)
- `placed` / `payment_verified` / `accepted` -> `cancelled` / `rejected` (authorized cancellation, with atomic pickup slot capacity release)

Direct client updates to `status` or `statusHistory` are strictly denied by Firestore rules.

### 4.2 Payment Expiry & Attempt Lifecycle (`order.paymentStatus` & Payment State Machine)
The demo payment state machine enforces strict two-phase commit rules and transaction-safe TTL expiry:

1. **Initial Creation:**
   - On `createOrder`, `order.status = 'placed'`, `order.paymentStatus = 'pending'`, `order.activePaymentId = null`, `order.activePaymentExpiresAt = null`.
2. **Payment Attempt Initiation (`createDemoPayment`):**
   - Creates `/orders/{orderId}/payments/{paymentId}` with `status = 'processing'`.
   - `order.status` remains `'placed'`.
   - `order.paymentStatus` transitions to `'processing'`.
   - `order.activePaymentId` is set to `paymentId` and `order.activePaymentExpiresAt` is set to server TTL timestamp.
3. **Payment Expiry (`expirePaymentAttempt` or Lazy-Expiry in `createDemoPayment`):**
   - **Crucial Invariant:** Payment expiry **NEVER** cancels the order. Expiry leaves the order active for retry:
     - `payment.status` transitions to `'expired'` (`expiredAt` timestamp recorded).
     - `order.status` remains `'placed'` (NOT cancelled, NOT failed).
     - `order.paymentStatus` transitions back to `'pending'`.
     - `order.activePaymentId` is reset to `null`.
     - `order.activePaymentExpiresAt` is reset to `null`.
     - `order.failedPaymentCount` is incremented.
     - **Pickup Slot Capacity:** Slot capacity is **NOT** released on payment expiry; the student's reservation remains secure.
     - **Retry Capability:** The student can immediately initiate a fresh payment attempt with a new idempotency key.
4. **Payment Failure (`failDemoPayment` or Synthetic Failure):**
   - `payment.status = 'failed'`.
   - `order.status` remains `'placed'`.
   - `order.paymentStatus = 'failed'`.
   - `order.activePaymentId = null`.
5. **Payment Verification (`completeDemoPayment` or Synthetic Webhook):**
   - `payment.status = 'succeeded_demo'`.
   - `order.paymentStatus` transitions to `'succeeded_demo'` / `'payment_verified'`.
   - `order.status` transitions to `'payment_verified'`.
   - `order.activePaymentId = null` and `order.activePaymentExpiresAt = null`.

---

## 5. Existing Service-Desk Permissions

- Can view operational orders only for assigned `canteenIds`.
- Eligible orders visible to service-desk:
  - Cash orders that have been approved by admin.
  - UPI demo orders with verified payment (`status == 'payment_verified'`).
  - Active lifecycle states: `accepted`, `preparing`, `ready_for_pickup`.
- Forbidden operations for service-desk:
  - Cannot approve cash payments.
  - Cannot trigger refunds.
  - Cannot modify prices or menu items.
  - Cannot directly read raw order documents or unmasked customer UIDs.

---

## 6. Existing Notification Access Policy

- In-app notifications stored in `/notifications/{notificationId}`.
- Student can read only notifications where `recipientUid == request.auth.uid`.
- Notifications created strictly by server-side outbox worker (`processNotificationOutbox`).
- Outbox events created within transactions in Firestore outbox collection (`/notificationOutbox`).
- Outbox worker is idempotent; duplicate deliveries produce zero duplicate user-visible notifications.

---

## 7. Change Boundary Matrix

### Permitted to Change:
- `.github/workflows/ci.yml` (CI emulator automation and pipeline definitions)
- Android build scripts if needed for release bundle compilation (`android/app/build.gradle`, release packaging)
- Additive push-notification models and Cloud Functions (strictly additive; FCM token registration and delivery layer without altering in-app notification records)
- Audit reports, staging checklists, load-test plans, and documentation under `docs/audits/`

### MUST NOT Change Unless a Verified Defect is Found:
- `firestore.rules`
- Core order state machine in `functions/src/index.ts`
- Core payment processing in `functions/src/index.ts`
- Service desk operational logic in `functions/src/index.ts`
- In-app notification outbox worker in `functions/src/notifications/`
- Sharded slot reservation algorithm in `functions/src/slots/slotSharding.ts`
