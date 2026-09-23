# Step 9 Audit — Security and Concurrency Tests

## 1. Test Harness Overview
Step 9 tests are implemented in `scripts/run-emulator-payment-test.js` and executed via `npm run test:payment:emulator`. The suite validates all Step 9 safety rules, state machine invariants, and concurrency boundaries in the local emulator environment.

## 2. Test Coverage & Assertions (57 Assertions Across 10 Sections)

### Section 1: Generic UI Labels and Backend Values
- Validates paymentMethod is `"upi_demo"`, provider is `"demo"`.
- Validates that real provider labels (`PhonePe`, `Google Pay`, `Paytm`) are rejected and replaced by generic labels (`UPI Demo`, `Demo Wallet Payment`, `Demo Online Payment`).

### Section 2: Emulator-Only Guard Invariants
- Validates that all simulation functions (`completeDemoPayment`, `failDemoPayment`, `cancelDemoPayment`, `requestDemoRefund`, `completeDemoRefund`, `verifySyntheticWebhook`) check `process.env.FUNCTIONS_EMULATOR === 'true'`.
- Validates proper rejection if called outside of emulator environment.

### Section 3: Failed-Attempt Immutability & Retry Invariants
- Validates that a failed attempt record cannot be updated or transitioned to `succeeded_demo`.
- Validates that retrying a payment creates a new unique payment attempt ID.
- Validates that retrying requires a new idempotency key (re-using the old key returns existing attempt).
- Validates that the server always re-reads authoritative `order.pricing.total` rather than trusting client parameters.

### Section 4: Duplicate and Concurrent Payment Prevention
- Validates that completing an already completed attempt is idempotent and returns the original result.
- Validates that two concurrent attempts for the same order cannot both succeed (the second fails with `failed-precondition`).
- Validates that an order cannot be paid twice.
- Validates that only one `payment_verified` status history event can exist for an order.

### Section 5: Deterministic Payment History Event IDs
- Validates that every payment status transition writes an audit event with the deterministic format:
  - `{paymentId}_created`
  - `{paymentId}_succeeded_demo`
  - `{paymentId}_failed`
  - `{paymentId}_cancelled`
  - `{paymentId}_refund_pending`
  - `{paymentId}_refunded_demo`

### Section 6: Cancellation and Refund Ordering
- Validates strict step ordering:
  1. Authorize cancellation/rejection.
  2. Release pickup capacity transactionally.
  3. Write order status history.
  4. Process demo refund state (`refund_pending` -> `refunded_demo`).
  5. Write payment history.
- Verifies that slot `reservedCount` is decremented properly and never becomes negative.
- Verifies that no real gateway or external refund API is called.

### Section 7: Admin Operational Field Masking
- Validates that admin queries via `getPaymentStatus` strip `providerReference` and internal failure codes.
- Validates that student owner receives full details while admin receives operational fields only.

### Section 8: Server-Side Attempt and Input Limits
- Validates rejection when an active attempt is already in flight (max 1 active attempt).
- Validates rejection after 3 failed attempts (max failed attempts limit).
- Validates rejection when idempotency key exceeds 128 characters.
- Validates truncation/sanitization of failure message to max 200 characters.

### Section 9: Raw-Body HMAC Signature Webhook Verification
- Validates signature verification with raw body and shared test secret using HMAC-SHA256 and `crypto.timingSafeEqual`.
- Validates rejection of forged or invalid signatures with HTTP 401.
- Validates amount mismatch detection (returns HTTP 400).
- Validates replay idempotency (duplicate webhook returns 200 with duplicate flag).

### Section 10: Direct Client Write Denial via Firestore Rules
- Validates that students cannot write directly to `/orders/{orderId}/payments/{paymentId}`.
- Validates that students cannot write directly to `/orders/{orderId}/paymentHistory/{eventId}`.
- Validates that unassigned admins cannot read payment records of other canteens.
