# GrabNGo Step 9 Audit — Security and Concurrency Tests

## 1. Test Harness Overview
Step 9 tests are implemented in `scripts/run-emulator-payment-test.js` and executed via `npm run test:payment:emulator`. The suite validates all Step 9 security controls, state machine invariants, webhook authentication, and concurrency boundaries against the live Firebase Emulator Suite.

Total automated assertions executed in this suite: **141 PASSED, 0 FAILED**.

## 2. Test Coverage & Assertions Breakdown

### Section 1: Authentication & Ownership Authorization
- Unauthenticated invocation of `createDemoPayment` rejected with HTTP 401.
- Cross-student payment creation rejected with `PERMISSION_DENIED`.

### Section 2: Input Sanitization & Exact Allowlist (Correction 1 & Phase 2)
Validated that `createDemoPayment` accepts ONLY `{ orderId, idempotencyKey }` and rejects every unexpected field before any DB read or write:
- Extra `paymentMethod` field rejected with `INVALID_ARGUMENT`.
- Extra `amount` field rejected with `INVALID_ARGUMENT`.
- Extra `amountInPaise` field rejected with `INVALID_ARGUMENT`.
- Extra `currency` field rejected with `INVALID_ARGUMENT`.
- Extra `studentUid` field rejected with `INVALID_ARGUMENT`.
- Extra `canteenId` field rejected with `INVALID_ARGUMENT`.
- Extra `paymentStatus` field rejected with `INVALID_ARGUMENT`.
- Extra `providerReference` field rejected with `INVALID_ARGUMENT`.
- Extra `paymentId` field rejected with `INVALID_ARGUMENT`.
- Extra nested object field rejected with `INVALID_ARGUMENT`.
- Null field rejected with `INVALID_ARGUMENT`.
- Array payload rejected with `INVALID_ARGUMENT`.
- Missing `orderId` rejected with `INVALID_ARGUMENT`.
- Missing `idempotencyKey` rejected with `INVALID_ARGUMENT`.
- Empty object payload rejected with `INVALID_ARGUMENT`.
- Verified zero payments and zero paymentHistory records written during invalid attempts.
- Cash and COD orders rejected from online demo payment with `FAILED_PRECONDITION`.
- Server derives `amountInPaise` and `paymentMethod` directly from server order doc.

### Section 3: Idempotency & Concurrency
- First payment creation returns `isRetry: false`.
- Exact replay with same idempotency key and parameters returns identical `paymentId` with `isRetry: true`.
- Reusing idempotency key for another order rejected with `ALREADY_EXISTS`.
- Duplicate payment completion returns `isRetry: true`.
- Exactly one `payment_verified` status history event exists after duplicate completions.

### Section 4: Payment State Machine & State Separation
- Payment failed via `failDemoPayment` transitions to `status: 'failed'`.
- Order status remains `placed` upon payment failure; `order.paymentStatus` transitions to `'failed'`.
- Failed payment attempt cannot transition to `succeeded_demo` (rejected with `FAILED_PRECONDITION`).

### Section 5: Retry Policy & Limits
- Failed attempts are immutable. Retrying generates a new unique `paymentId`.
- Max 3 failed attempts enforced per order; 4th attempt rejected with `FAILED_PRECONDITION`.

### Section 6: Deterministic Payment History Events (Correction 4)
- Creation records single `{paymentId}_processing` event (`fromStatus: 'none'`, `toStatus: 'processing'`).
- Completion records `{paymentId}_succeeded_demo`.

### Section 7: Expiry Invariants (Correction 3 & Phase 1)
- Unexpired attempt cannot be expired (rejected with `FAILED_PRECONDITION`).
- Terminal (cancelled, failed, succeeded_demo) attempts cannot be expired.
- Only payment TTL expired (order TTL not expired) -> rejected with zero writes.
- Only order TTL expired (payment TTL not expired) -> rejected with zero writes.
- Both payment and order TTL expired -> succeeds:
  - `payment.status = "expired"`, `payment.expiredAt = server timestamp`.
  - `order.status = "placed"`, `order.paymentStatus = "pending"` (NOT `failed`!).
  - `order.activePaymentId = null`, `order.activePaymentExpiresAt = null`.
  - Expiry does not release pickup slot capacity.
- Already expired payment cannot be re-expired.
- Exactly one `{paymentId}_expired` event recorded in history.
- Expired attempt retry: new attempt created with new idempotency key.
- Old expired attempt cannot be completed.
- Older payment attempt cannot expire when newer attempt is active.

### Section 8: Demo Refunds & Cancellation Ordering (Correction 2 & 7)
- Refund cannot be requested while order is active.
- Admin cancellation initializes refund state: `order.status` remains `'cancelled'` (NEVER set to `'refunded'`), `order.refundStatus: 'pending'`, `payment.refundStatus: 'pending'`, `payment.status: 'succeeded_demo'`.
- Deterministic `{paymentId}_refund_pending` recorded.
- Admin completes demo refund: `payment.refundStatus: 'succeeded_demo'`, `order.refundStatus: 'refunded_demo'`.
- Order status remains `'cancelled'`, never overwritten.
- Repeated refund completion is idempotent (`isRetry: true`).

### Section 9: Admin Operational Field Masking
- Student view includes `providerReference`.
- Admin view masks `providerReference`, exposing only operational fields.

### Section 10: Webhook Verification, Authentication & Dedicated Handlers
- Missing `x-synthetic-signature` rejected with HTTP 400.
- Invalid HMAC signature rejected with HTTP 401.
- Body tampering with original HMAC rejected with HTTP 401.
- Unsupported webhook `eventType` rejected with HTTP 400.
- Non-existent `orderId` rejected with HTTP 404.
- Non-existent `paymentId` rejected with HTTP 404.
- Valid synthetic capture HMAC processed (HTTP 200); order moves to `payment_verified`.
- Scoped deduplication recorded at `/webhookEvents/demo:{eventId}`.
- Replayed webhook event is idempotent (`isIdempotent: true`).
- Dedicated handler `refund.processed` verifies `succeeded_demo`, `pending`, order `cancelled`, matches `amountInPaise` and `refundReference`.
- Order status remains `cancelled`, not `refunded`.
- Replayed refund webhook is idempotent.

### Section 11: Removal of Frontend Direct Payment Reads (Correction 10)
- Verified `getOrderPayments` and `getOrderPaymentHistory` removed from `src/services/paymentService.ts`.
- Verified direct Firestore import removed from `src/services/paymentService.ts`.

### Section 12: Generic Demo Labels Verification
- Verified generic labels (`UPI Demo`, `Demo Wallet Payment`, `Demo Online Payment`) are present.
- Verified real provider labels (`PhonePe`, `Google Pay`, `Paytm`) are completely removed.

### Section 13: Order Lifecycle Edge Cases (Phase 9)
- Payment attempt for non-existent order returns `NOT_FOUND`.
- Payment attempt for completed order returns `FAILED_PRECONDITION`.
- Payment attempt for cancelled order returns `FAILED_PRECONDITION`.
- Payment attempt for rejected order returns `FAILED_PRECONDITION`.
- Payment attempt after pickup slot has passed returns `FAILED_PRECONDITION`.
- Payment attempt after order expiration returns `FAILED_PRECONDITION`.
- Payment attempt when pricing total is inconsistent returns `FAILED_PRECONDITION`.

### Section 14: Payment Lifecycle Edge Cases (Phase 9)
- Completion of non-existent payment returns `NOT_FOUND`.
- Payment ID from another order is rejected.
- Payment completion by another student returns `PERMISSION_DENIED`.
- Payment amount changed between creation and completion rejected with `FAILED_PRECONDITION`.
- Payment currency changed between creation and completion rejected with `FAILED_PRECONDITION`.
- Payment provider changed between creation and completion rejected with `FAILED_PRECONDITION`.
- Successful completion moves order to `payment_verified`.
- Second payment attempt on already paid order returns `FAILED_PRECONDITION`.

### Section 15: Additional Refund & Webhook Edge Cases (Phase 9)
- Webhook missing `eventId` rejected with HTTP 400.
- Webhook oversized `eventId` (> 128 chars) rejected with HTTP 400.
- Webhook wrong currency (USD) rejected with HTTP 400.
- Webhook wrong provider rejected with HTTP 400.
- Invalid first event rejected with HTTP 400 and does NOT claim event ID.
- Subsequent valid event with identical `eventId` successfully processed and claims event ID.
