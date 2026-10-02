# GrabNGo — Deep Security Test Matrix

## 1. Overview & Evaluation Methodology

This security test matrix consolidates every verified attack scenario and security invariant evaluated during the deep security engineering audit. Every test is backed by reproducible automated suites executed against the local Firebase Emulator Suite (`Auth: 9099`, `Firestore: 8085`, `Functions: 5001`) or static repository scans.

Status values adhere strictly to:
- `CONFIRMED`: Defect reproduced and proven.
- `PASS`: Security defense successfully resisted attack; expected secure behavior verified.
- `NOT TESTED`: Scope or environment prevented execution.
- `INCONCLUSIVE`: Ambiguous result requiring live provider/hardware.

---

## 2. Comprehensive Security Test Matrix

| Area | Attack / Test Scenario | Expected Result | Actual Result | Evidence | Status |
|---|---|---|---|---|---|
| **Auth** | Unauthenticated call to `createOrder` | Rejection with HTTP 401 / `unauthenticated` | Rejected with HTTP 401 | `run-emulator-order-test.js:84` | **PASS** |
| **Auth** | Unauthenticated call to catalog functions (`updateCanteen`, etc.) | Rejection with HTTP 401 | Rejected with HTTP 401 (10/10 functions) | `run-emulator-functions-test.js:94` | **PASS** |
| **Auth** | Unauthenticated direct read of student profile in Firestore | Denied by Firestore rules | Denied (`PERMISSION_DENIED` @ L29) | `run-emulator-rules-test.js:200` | **PASS** |
| **Auth** | Suspended/inactive staff token accessing order queue | Rejection with HTTP 403 / `permission-denied` | Rejected with HTTP 403 | `run-emulator-service-desk-test.js:84` | **PASS** |
| **AuthZ** | Student calling admin function (`transitionOrderStatus`) | Rejection with HTTP 403 / `permission-denied` | Rejected with HTTP 403 | `run-emulator-status-test.js:145` | **PASS** |
| **AuthZ** | Student calling operational function (`listOperationalOrders`) | Rejection with HTTP 403 / `permission-denied` | Rejected with HTTP 403 | `run-emulator-service-desk-test.js:72` | **PASS** |
| **AuthZ** | Student attempting privilege escalation via Firestore profile update | Denied by Firestore rules | Denied (`PERMISSION_DENIED` @ L41) | `run-emulator-rules-test.js:224` | **PASS** |
| **AuthZ** | Client attempting direct write to `/admins` collection | Denied by Firestore rules | Denied (`PERMISSION_DENIED` @ L113) | `run-emulator-rules-test.js:229` | **PASS** |
| **AuthZ** | Service desk operator attempting catalog administration | Rejection with HTTP 403 | Rejected with HTTP 403 | `run-emulator-service-desk-test.js:108` | **PASS** |
| **IDOR** | Student A attempting to read Student B's profile document | Denied by Firestore rules | Denied (`PERMISSION_DENIED` @ L29) | `run-emulator-rules-test.js:210` | **PASS** |
| **IDOR** | Student A attempting to read Student B's order document | Denied by Firestore rules | Denied (`PERMISSION_DENIED` @ L180) | `run-emulator-rules-test.js:370` | **PASS** |
| **IDOR** | Student A ordering items using Student B's cart | Rejection with `FAILED_PRECONDITION` | Rejected with `FAILED_PRECONDITION` | `run-emulator-order-test.js:118` | **PASS** |
| **IDOR** | Student B attempting to mark Student A's notification as read | Isolated by recipient path; rejection or 0 modified | Rejected / 0 modified | `run-emulator-notifications-test.js:210` | **PASS** |
| **IDOR** | Client supplying forged `studentUid` in `createOrder` | Field rejected as unknown; UID server-derived | Rejected as unknown field | `run-emulator-order-test.js:155` | **PASS** |
| **Canteen** | Admin A accessing Canteen B's order queue | Rejection with HTTP 403 / `permission-denied` | Rejected with HTTP 403 | `run-emulator-status-test.js:210` | **PASS** |
| **Canteen** | Service desk operator A querying Canteen B orders | Rejection with HTTP 403 | Rejected with HTTP 403 | `run-emulator-service-desk-test.js:96` | **PASS** |
| **Canteen** | Cross-canteen exact order search | Generic `found: false` without leaking existence | Returned `found: false` | `run-emulator-service-desk-test.js:154` | **PASS** |
| **Canteen** | Admin A reading private supplier data of Canteen B | Denied by Firestore rules | Denied (`PERMISSION_DENIED` @ L157) | `run-emulator-rules-test.js:343` | **PASS** |
| **Canteen** | Admin A attempting to transition order in Canteen B | Rejection with HTTP 403 | Rejected with HTTP 403 | `run-emulator-status-test.js:195` | **PASS** |
| **Rules** | Direct client write to `/orders/{orderId}` | Denied by Firestore rules | Denied (`allow write: if false` @ L187) | `run-emulator-status-test.js:180` | **PASS** |
| **Rules** | Direct client write to `/orders/{id}/payments/{pid}` | Denied by Firestore rules | Denied (`allow write: if false` @ L212) | `run-emulator-rules-test.js:375` | **PASS** |
| **Rules** | Direct client read of `/orders/{id}/payments/{pid}` | Denied by Firestore rules | Denied (`allow read: if false` @ L212) | `run-emulator-rules-test.js:370` | **PASS** |
| **Rules** | Direct client read/write to in-app notifications | Denied by Firestore rules (Callable-only policy) | Denied (`allow read, write: if false` @ L94) | `run-emulator-notifications-test.js:85` | **PASS** |
| **Rules** | Direct client write to `/operationalNotes` or `/auditEvents` | Denied by Firestore rules | Denied (`allow write: if false` @ L237, L245)| `run-emulator-service-desk-test.js:230`| **PASS** |
| **Rules** | Direct client write to `/notificationOutbox` | Denied by Firestore rules | Denied (`allow write: if false` @ L101) | `run-emulator-notifications-test.js:95` | **PASS** |
| **Input** | Client supplying unknown field in `createCategory` | Rejection with `INVALID_ARGUMENT` | Rejected with `INVALID_ARGUMENT` | `run-emulator-functions-test.js:140`| **PASS** |
| **Input** | Client submitting price tampering payload in `createOrder` | Client price strictly rejected; server prices used | Rejected as unknown/forbidden field | `run-emulator-order-test.js:148` | **PASS** |
| **Input** | Negative or decimal price in `createMenuItem` | Rejection with `INVALID_ARGUMENT` | Rejected with `INVALID_ARGUMENT` | `run-emulator-functions-test.js:148`| **PASS** |
| **Input** | Overlong query (> 64 chars) or control chars in search | Rejection with HTTP 400 | Rejected with HTTP 400 | `run-emulator-service-desk-test.js:142`| **PASS** |
| **Input** | Overlong operational note (> 1000 chars) | Rejection with HTTP 400 | Rejected with HTTP 400 | `run-emulator-service-desk-test.js:205`| **PASS** |
| **Input** | Malformed pagination limits (negative, zero, > 50) | Rejection with HTTP 400 | Rejected with HTTP 400 | `run-emulator-service-desk-test.js:125`| **PASS** |
| **State** | Transitioning order directly `placed -> ready_for_pickup` | Rejection with `FAILED_PRECONDITION` | Rejected with `FAILED_PRECONDITION` | `run-emulator-service-desk-test.js:175`| **PASS** |
| **State** | Transitioning out of terminal `completed` status | Rejection with `FAILED_PRECONDITION` | Rejected with `FAILED_PRECONDITION` | `run-emulator-status-test.js:95` | **PASS** |
| **State** | Cancelling an already `completed` order | Rejection with `FAILED_PRECONDITION` | Rejected with `FAILED_PRECONDITION` | `run-emulator-status-test.js:100`| **PASS** |
| **State** | Accepting online order before payment is verified | Rejection with `FAILED_PRECONDITION` | Rejected with `FAILED_PRECONDITION` | `run-emulator-status-test.js:85` | **PASS** |
| **State** | Payment failure causing order cancellation | Preserves state separation: order remains `placed` | Order remains `placed`; payment `failed` | `run-emulator-payment-test.js:125` | **PASS** |
| **State** | Payment expiry causing order cancellation | Preserves state separation: order remains `placed` | Order remains `placed`; payment `expired`| `run-emulator-payment-test.js:160` | **PASS** |
| **Race** | Concurrent order creation with identical idempotency key | Exactly one order created; concurrent call returns same ID | Exactly one order committed | `run-emulator-order-test.js:210` | **PASS** |
| **Race** | Reusing idempotency key with modified payload | Rejection with `ALREADY_EXISTS` | Rejected with `ALREADY_EXISTS` | `run-emulator-order-test.js:202` | **PASS** |
| **Race** | Concurrent status transitions (`accepted` vs `accepted`) | At most one transition committed; second is replay | Exactly one history event created | `run-emulator-service-desk-test.js:185`| **PASS** |
| **Race** | Concurrent cancellation calls releasing pickup capacity | Capacity decremented exactly once; no double release | Capacity decremented once (4 -> 3) | `run-emulator-status-test.js:135` | **PASS** |
| **Payment** | Replay of synthetic payment completion callable | Idempotent response (`isRetry: true`); no duplicate | Returned `isRetry: true` | `run-emulator-payment-test.js:115` | **PASS** |
| **Payment** | Webhook missing HMAC header `x-synthetic-signature` | Rejection with HTTP 400 | Rejected with HTTP 400 | `run-emulator-payment-test.js:220` | **PASS** |
| **Payment** | Webhook with tampered body or invalid HMAC | Rejection with HTTP 401 | Rejected with HTTP 401 | `run-emulator-payment-test.js:225` | **PASS** |
| **Payment** | Replay of verified webhook event | Idempotent processing; deduplication doc claimed | Replayed event is idempotent (HTTP 200) | `run-emulator-payment-test.js:240` | **PASS** |
| **Payment** | Refund webhook using original payment reference | Rejection with HTTP 400 without leaking expected ref | Rejected with generic HTTP 400 | `run-emulator-payment-test.js:260` | **PASS** |
| **Payment** | Refund requested on active un-cancelled order | Rejection with `FAILED_PRECONDITION` | Rejected with `FAILED_PRECONDITION` | `run-emulator-payment-test.js:185` | **PASS** |
| **Capacity** | Duplicate pickup slot capacity release on repeated cancel | Capacity released at most once (`isIdempotent: true`)| Capacity decremented once; 0 underflow | `run-emulator-status-test.js:125` | **PASS** |
| **Capacity** | Cancellation when slot `reservedCount == 0` | Rejection with `FAILED_PRECONDITION`; zero underflow | Rejected; reservedCount remained 0 | `run-emulator-status-test.js:112` | **PASS** |
| **Notifs** | Client attempting direct submission of notification fields | Rejection; fields server-derived only | Internal function not publicly callable | `run-emulator-notifications-test.js:270`| **PASS** |
| **Notifs** | Conflicting deterministic notification payload | Fails closed with collision error; existing preserved| Collision error thrown; data preserved | `run-emulator-notifications-test.js:285`| **PASS** |
| **Notifs** | Batch processing > 500 notifications in `markAllRead` | Bounded batching at 500 items with cursor | Bounded to 500 with continuation cursor | `run-emulator-notifications-test.js:175`| **PASS** |
| **Kiosk** | Virtual touchscreen keyboard capturing keystrokes | No remote logging or local text persistence | Self-contained UI component, no logging | `TouchKeyboard.tsx:1-309` | **PASS** |
| **Kiosk** | Virtual keyboard active during in-flight request | Keys disabled while `isDisabled === true` | Keys disabled; duplicate taps blocked | `TouchKeyboard.test.tsx` | **PASS** |
| **Web Kiosk** | Local web server exposes unauthenticated operator token | Should require operator authentication | **Vulnerability:** Unauthenticated `/api/token` | `web/server.js:54-68` | **CONFIRMED** |
| **Secrets** | Scan codebase for private keys, credentials, service accounts | Zero committed secrets | Clean; zero private keys or secrets found | `deep-audit-baseline.md:4.2` | **PASS** |
| **Deps** | Root and Functions `npm audit` dependency scan | Zero high/critical deployable vulnerabilities | 34 root dev vulnerabilities, 9 functions mod | `npm audit` reports | **PASS** (Dev/Transitive) |
