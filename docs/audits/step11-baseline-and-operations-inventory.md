# GrabNGo Step 11: Baseline and Operations Inventory

## 1. Baseline Verification Summary

Before initiating any Step 11 modifications, the complete baseline gate was executed against the local environment on branch `development`. All gate commands succeeded with exit code 0.

### 1.1 Git Branch and Working Tree

- **Current Branch**: `development`
- **Head Commit**: `83e5392 Complete Step 10 in-app notification infrastructure and audit gate`
- **Working Tree**: Clean before Step 11 changes

### 1.2 Baseline Gate Execution Results

| Command | Status | Result / Assertion Count |
| --- | --- | --- |
| `git branch --show-current` | PASS | `development` |
| `git status --short` | PASS | Working tree clean |
| `git log -5 --oneline --decorate` | PASS | Commit log verified |
| `npm run typecheck` | PASS | Zero TypeScript errors |
| `npm run lint` | PASS | Zero ESLint errors (203 cosmetic warnings) |
| `npm test` | PASS | 10 test suites passed, 52 unit tests passed |
| `npm --prefix functions run build` | PASS | TypeScript compile clean |
| `npm run test:rules:emulator` | PASS | 33 passed, 0 failed |
| `npm run test:functions:emulator` | PASS | 54 passed, 0 failed |
| `npm run test:order:emulator` | PASS | 64 passed, 0 failed |
| `npm run test:status:emulator` | PASS | 65 passed, 0 failed |
| `npm run test:payment:emulator` | PASS | 147 passed, 0 failed |
| `npm run test:notifications:emulator` | PASS | 144 passed, 0 failed |

**Total Baseline Test Assertions**: 507 emulator & unit tests passed with 0 failures.

### 1.3 Local Emulator Environment Confirmation

- **Firebase Project ID**: `demo-grabngo-local`
- **Auth Emulator**: `127.0.0.1:9099`
- **Firestore Emulator**: `127.0.0.1:8085`
- **Functions Emulator**: `127.0.0.1:5001`
- **External Networks**: None called (zero calls to Razorpay, SMS gateways, FCM push servers, or external services).
- **Billing**: Unmodified, free emulator tier only.
- **Production/Staging**: Untouched.

---

## 2. Operations Inventory: Existing State

### 2.1 Admin Records and Roles
- **Collection**: `admins/{uid}`
- **Current Allowed Roles**: `canteen_admin`, `platform_operator`.
- **Target Role for Step 11**: Add `service_desk` role foundation.
- **Assignment Model**: `canteenIds: string[]` in each admin document dictates which canteens the operator can access.

### 2.2 Order Queue and Search Callables
- **Existing Queue Callable**: `getAdminOrderQueue` (Step 8). Accepts `canteenId`, `status`, `limit`, `startAfterOrderId`. Validates `verifyAdminForCanteen`.
- **Existing Search Callable**: `searchAdminOrder` (Step 8). Accepts `canteenId`, `orderId`. Validates `verifyAdminForCanteen`. Masked customer UIDs.
- **Step 11 Callables to Add/Enhance**:
  - `listOperationalOrders`: Server-derived canteen assignments, bounded pagination (1–50), status filter, pickupDate filter, sanitized fields only.
  - `searchOperationalOrders`: Server-derived or validated canteen assignments, exact lookup by `orderId` or short reference, query bounded and trimmed, cross-canteen returns generic 404/not found.
  - `getOperationalOrderDetails`: Full sanitized operational payload, payment status (sanitized, zero secrets), operational notes, and audit history.

### 2.3 Status Transition Callables
- **Existing Callable**: `transitionOrderStatus` (Step 8). Implements transactional state machine: `placed` -> `accepted` (or `payment_verified` -> `accepted`), `accepted` -> `preparing`, `preparing` -> `ready_for_pickup`, `ready_for_pickup` -> `completed`. Supports student cancellation of `placed` + `pending` orders before slot start. Supports admin cancellation/rejection with slot capacity release.
- **Step 11 Enhancements**:
  - Expose `transitionOperationalOrderStatus` (and maintain backward compatibility with `transitionOrderStatus`).
  - Authorize `service_desk` role alongside `canteen_admin`.
  - Transactional preconditions and deterministic history/audit event creation.
  - Strict zero-mutation of payment/refund records from status callables.

### 2.4 Operational Notes Subcollection
- **Proposed Path**: `orders/{orderId}/operationalNotes/{noteId}`
- **Status**: Not yet implemented.
- **Requirement**: Server-authorized callable `createOperationalNote`. Author UID derived from `context.auth.uid`, role from `admins/{uid}`, canteen ID from order document. Input bounded (1–1000 chars), control characters rejected. Direct client writes denied in Firestore Rules.

### 2.5 Audit Events Subcollection
- **Existing Status History**: `orders/{orderId}/statusHistory/{eventId}`
- **Step 11 Audit Events**: `orders/{orderId}/auditEvents/{eventId}`
- **Requirement**: Append-only, deterministic ID, server-derived actor and role, no client writes allowed.

### 2.6 Frontend & Touch-Screen Keyboard
- **Service Desk Screen**: Touch-screen interface tailored for kiosks and touch monitors running React Native (Android / tablet / kiosk).
- **In-Screen Keyboard**: In-app virtual keyboard component `TouchKeyboard` with A–Z, 0–9, space, backspace, clear, search, close.
- **Toggle Control**: Visible `In-Screen Keyboard: ON / OFF` toggle in service-desk header/toolbar. State stored locally (in-memory or device storage).
- **Security Constraints**: Virtual keyboard strictly inputs to focused search field; never captures credentials, never logs keystrokes, disabled while search is in flight.
