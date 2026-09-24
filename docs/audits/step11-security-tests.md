# GrabNGo Step 11: Security & Workflow Tests

## 1. Test Architecture & Runner

Step 11 security, operational, and UI tests are distributed across two independent test runners:

1. **Service-Desk & Operations Live Emulator Test Suite**:
   ```bash
   npm run test:service-desk:emulator
   ```
   - Executed via `scripts/run-emulator-service-desk-test.js` under `firebase emulators:exec`.
   - **55 emulator assertions passed**, 0 failed.

2. **Touch-Screen Virtual Keyboard Jest Unit Test Suite**:
   ```bash
   npm test __tests__/components/TouchKeyboard.test.tsx
   ```
   - Executed via Jest using `react-test-renderer`.
   - **11 unit assertions passed**, 0 failed.

**Combined Step 11 Assertions Total**: **66 passed** (55 emulator + 11 Jest), 0 failed.

> [!NOTE]
> The Service-Desk Emulator suite (55 assertions) and TouchKeyboard Jest suite (11 assertions) are distinct test suites executed in separate runtime environments. They sum to 66 combined Step 11 assertions and are never conflated as a single test run.

---

## 2. Test Coverage & Assertion Breakdown

### 2.1 Service-Desk Emulator Suite (`test:service-desk:emulator`) — 55 Assertions

| Test Category | Description | Assertions Passed |
| --- | --- | --- |
| **Role Authorization** | Verifies unauthenticated denial (401), student denial (403), inactive admin denial (403), inactive service desk denial (403), cross-canteen denial (403), forged role rejection, and service desk catalog admin rejection. | 10 passed |
| **Queue & Search** | Verifies assigned canteen listing, cross-canteen queue exclusion, pagination bounds, limit validations (-5, 0, 2.5, 51, string), exact search, whitespace trimming, overlong query rejection, control-char rejection, non-existent not-found, cross-canteen non-leakage, and absence of payment secrets. | 16 passed |
| **Status Transitions** | Verifies complete state machine progression (`placed` -> `accepted` -> `preparing` -> `ready_for_pickup` -> `completed`), terminal state protections, invalid skipping rejection, cross-canteen transition denial, replay idempotency, concurrent transition race handling, and single status history event creation. | 10 passed |
| **Notes & Audit History** | Verifies service-desk note creation, canteen admin note creation, student note denial, cross-canteen note denial, client-supplied author UID/role rejection, overlong note rejection (>1000 chars), control-char rejection, note inspection in details, and direct client write denial to `operationalNotes` and `auditEvents` via Firestore Rules. | 13 passed |
| **Payment & Refund Safety**| Verifies client cannot mutate `paymentStatus` via transition, client cannot mutate `refundStatus` via transition, and slot capacity is properly released upon order cancellation. | 6 passed |

### 2.2 TouchKeyboard Jest Suite (`TouchKeyboard.test.tsx`) — 11 Assertions

| # | Test Case Description | Result |
|---|---|---|
| 1 | Renders virtual keyboard container and search action key | **PASS** |
| 2 | Calls `onKeyPress` when alphanumeric keys are pressed | **PASS** |
| 3 | Calls `onKeyPress` with space character | **PASS** |
| 4 | Calls `onBackspace` when backspace is pressed | **PASS** |
| 5 | Calls `onClear` when clear is pressed | **PASS** |
| 6 | Calls `onSearch` when search is pressed | **PASS** |
| 7 | Calls `onClose` when hide key is pressed | **PASS** |
| 8 | Disables all keys when `disabled` prop is true | **PASS** |
| 9 | Prevents adding characters beyond `maxLength` limit | **PASS** |
| 10 | Displays current input length and maximum length counter | **PASS** |
| 11 | Renders touch targets satisfying minimum 48pt sizing requirements | **PASS** |

---

## 3. Comprehensive Edge-Case Verification & Safety Audit

The following edge cases and security boundaries were tested and verified:

1. **`platform_operator` Access**:
   - `verifyOperationalAccess` recognizes `platform_operator` role as global superuser.
   - Global operators can list queues, search, transition statuses, and view details across all canteens without canteen-assignment restrictions.

2. **`getOperationalOrderDetails` Cross-Canteen Denial**:
   - `verifyOperationalAccess` validates that the target order belongs to `canteenIds` assigned to the operator.
   - An operator assigned to Canteen A attempting to view an order belonging to Canteen B receives `PERMISSION_DENIED` (HTTP 403).

3. **Audit History Cross-Canteen Denial**:
   - Subcollection `orders/{orderId}/auditEvents` is protected by Firestore Rules (`allow read, write: if false;`).
   - Audit history is accessible exclusively through `getOperationalOrderDetails`, inheriting strict canteen isolation.

4. **Stale or Revoked Operator Authorization**:
   - `verifyOperationalAccess` fetches a fresh document from `admins/{callerUid}` in Firestore on every invocation.
   - If an operator's record is marked `status !== 'active'` or deleted, subsequent requests fail closed with `PERMISSION_DENIED` (403) immediately, even if the caller holds a valid Firebase Auth token.

5. **Logout Followed by Android Back-Button Navigation**:
   - Operator logout invokes `navigation.reset({ index: 0, routes: [{ name: 'Auth' }] })`.
   - The navigation stack is completely cleared. Pressing the Android hardware back button cannot pop back to the service-desk queue or order detail modal.

6. **Keyboard State After App Restart**:
   - Virtual keyboard toggle state is stored in `AsyncStorage` under `@grabngo_virtual_keyboard_enabled`.
   - On cold start, the setting is rehydrated and restored, defaulting to enabled if unset.

7. **Rapid Duplicate Keyboard Search Taps**:
   - `TouchKeyboard` receives `disabled={isSearching}` while a query is in flight.
   - All keys, including the Search button, are disabled during network requests, preventing duplicate submissions.

8. **Network Failure While Status Transition In Flight**:
   - `transitionOperationalOrderStatus` runs in a transactional precondition check.
   - If network disconnects before reaching server, no change occurs.
   - If network disconnects after server commits, client retry triggers the idempotency check (`currentStatus === nextStatus`), returning `{ success: true, isIdempotent: true }` without duplicate capacity releases or notification dispatches.

9. **Terminal-Order Cancellation and Rejection**:
   - Orders in `completed`, `cancelled`, or `rejected` cannot be transitioned to any other status.
   - Attempting cancellation or rejection on a completed order throws `failed-precondition`.

10. **Capacity Release on Cancellation/Rejection**:
    - When an active order with a valid `pickupSlotId` is cancelled or rejected, `validateAndComputeSlotCapacityRelease` atomically decrements `pickupSlots/{slotId}.reservedCount` by 1 within the same Firestore transaction, preventing slot capacity leaks.

---

## 4. Full Regression Suite Results (Separate Totals)

In addition to the 66 Step 11 assertions, all historical regression suites pass cleanly:

| Suite Name | Command | Assertions Passed | Status |
|---|---|---|---|
| Firestore Rules | `npm run test:rules:emulator` | 33 passed | **PASS** |
| Functions Core | `npm run test:functions:emulator` | 54 passed | **PASS** |
| Cart & Checkout | `npm run test:order:emulator` | 64 passed | **PASS** |
| Status State Machine | `npm run test:status:emulator` | 65 passed | **PASS** |
| Payment & Refund | `npm run test:payment:emulator` | 147 passed | **PASS** |
| In-App Notifications | `npm run test:notifications:emulator` | 144 passed | **PASS** |
| Service Desk Operations | `npm run test:service-desk:emulator` | 55 passed | **PASS** |
| Root & Functions Lint/Typecheck | `npm run typecheck && npm run lint` | 0 errors | **PASS** |
| Jest Unit Tests (all components) | `npm test` | 63 passed (11 suites) | **PASS** |

**Grand Total Across All Emulator Suites**: **562 emulator assertions passed**, 0 failed.
