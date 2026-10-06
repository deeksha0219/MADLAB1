# GrabNGo Step 9 Audit — Validation Results

## 1. Validation Commands Summary
The complete suite of nine validation commands required by Step 9 was executed against the local Firebase Emulator Suite (`demo-grabngo-local`) on branch `development`:

| # | Validation Command | Scope / Suite | Result | Details |
|---|---|---|---|---|
| 1 | `npm run typecheck` | TypeScript Compiler (`tsc --noEmit`) | **PASS (code 0)** | 0 errors |
| 2 | `npm run lint` | ESLint | **PASS (code 0)** | 0 errors |
| 3 | `npm test` | Jest Unit & Scaffold Tests | **PASS (code 0)** | 10 suites passed, 52/52 tests passed |
| 4 | `npm --prefix functions run build` | Functions TypeScript Compilation | **PASS (code 0)** | Build clean with zero errors |
| 5 | `npm run test:rules:emulator` | Firestore Security Rules in Emulator | **PASS (code 0)** | 33/33 assertions passed (including 5 Step 9 payment denial tests) |
| 6 | `npm run test:functions:emulator` | Cloud Functions Backend Operations in Emulator | **PASS (code 0)** | 54/54 assertions passed |
| 7 | `npm run test:order:emulator` | Step 7 Checkout & Order Invariants in Emulator | **PASS (code 0)** | 64/64 assertions passed |
| 8 | `npm run test:status:emulator` | Step 8 Order Status Transitions & Capacity Release in Emulator | **PASS (code 0)** | 65/65 assertions passed |
| 9 | `npm run test:payment:emulator` | Step 9 Demo Payment Foundation, Security & Concurrency | **PASS (code 0)** | 147/147 assertions passed across 15 sections |

**Total Automated Invariant Assertions Across Suites: 415 / 415 PASSED (100%)**

---

## 2. Step 9 Payment Emulator Test Breakdown (`scripts/run-emulator-payment-test.js`)
Total Assertions: **147** | Passed: **147** | Failed: **0**

- **Section 1: Authentication & Ownership Authorization** (2 passed)
  - Unauthenticated calls rejected with HTTP 401.
  - Cross-student payment creation rejected with `PERMISSION_DENIED`.
- **Section 2: Input Sanitization & Server Method Derivation (Correction 1 & Phase 2)** (22 passed)
  - All 15 unexpected-field edge cases rejected with `INVALID_ARGUMENT` before any DB write.
  - Zero writes verified across payments and paymentHistory.
  - Cash and COD orders rejected with `FAILED_PRECONDITION`.
  - Server derives 15,000 paise from order doc; currency assigned as INR; initial status created directly in `processing`.
- **Section 3: Idempotency & Concurrency** (6 passed)
  - First creation returns `isRetry: false`.
  - Exact replay returns identical `paymentId` with `isRetry: true`.
  - Reusing key for different order rejected with `ALREADY_EXISTS`.
  - First completion moves payment to `succeeded_demo` and order to `payment_verified`.
  - Repeated completion returns `isRetry: true`.
  - Exactly one `payment_verified` status history event exists.
- **Section 4: Payment State Machine & State Separation** (3 passed)
  - Failed payment transitions to `failed`.
  - Order status remains `placed` on failure; `order.paymentStatus` is `failed`.
  - Failed payment attempt cannot transition to `succeeded_demo`.
- **Section 5: Retry Policy & Limits** (3 passed)
  - New attempt created after failure with distinct `paymentId`.
  - Max 3 failed attempts enforced; 4th attempt rejected (`FAILED_PRECONDITION`).
- **Section 6: Deterministic Payment History Events (Correction 4)** (4 passed)
  - Single `{paymentId}_processing` event exists upon creation.
  - `{paymentId}_succeeded_demo` event exists upon completion.
- **Section 7: Expiry Invariants (Correction 3 & Phase 1)** (16 passed)
  - Unexpired attempt cannot be expired.
  - Terminal (cancelled) payment cannot be expired.
  - Partial expiry (only payment expired or only order expired) rejected with zero writes.
  - Dual TTL expiration succeeds: `payment.status = "expired"`, `order.status = "placed"`, `order.paymentStatus = "pending"` (NOT `failed`!).
  - Active payment references cleared (`activePaymentId === null`, `activePaymentExpiresAt === null`).
  - Pickup slot capacity is NOT altered by expiry.
  - Repeated expiry rejected; single `{paymentId}_expired` event recorded.
  - New attempt created after expiry with new idempotency key; old attempt cannot be completed.
  - Older payment attempt cannot expire when newer attempt is active.
- **Section 8: Demo Refunds & Cancellation Ordering (Correction 2 & 7)** (10 passed)
  - Refund cannot be requested while order is active.
  - Admin cancelled order with demo refund state initialized.
  - Order status remains `cancelled`, NEVER set to `refunded`.
  - Order `refundStatus` transitioned to `pending`.
  - Payment status remains `succeeded_demo`, payment `refundStatus` transitioned to `pending`.
  - Admin completed demo refund; payment `refundStatus` finalized as `succeeded_demo`.
  - Order status remains `cancelled`, order `refundStatus` is `refunded_demo`.
  - Repeated `completeDemoRefund` is idempotent (`isRetry: true`).
- **Section 9: Admin Operational Field Masking** (4 passed)
  - Student view includes `providerReference`.
  - Admin view masks synthetic `providerReference` and displays operational fields only.
- **Section 10: Webhook Verification, Authentication, and Dedicated Handlers** (23 passed)
  - Missing signature rejected with HTTP 400.
  - Invalid HMAC signature rejected with HTTP 401.
  - Body tampering rejected with HTTP 401.
  - Unsupported webhook event rejected with HTTP 400.
  - Non-existent `orderId` rejected with HTTP 404; non-existent `paymentId` rejected with HTTP 404.
  - Valid synthetic capture HMAC accepted (HTTP 200); order moved to `payment_verified`.
  - Scoped deduplication document exists at `/webhookEvents/demo:{eventId}`.
  - Replayed webhook event is idempotent (`isIdempotent: true`).
  - Webhook using original payment reference for `refund.processed` strictly rejected with HTTP 400.
  - Generic error message `'Refund provider reference mismatch.'` returned without internal details.
  - Confirmed error response does not leak expected `refundReference`.
  - Confirmed error response does not leak received `providerReference`.
  - Rejected refund event ID was not claimed in `/webhookEvents`.
  - Dedicated `refundReference` verified different from original `providerReference`.
  - `refund.processed` webhook with dedicated `refundReference` processed successfully (Correction 2); order status remains `cancelled`.
  - Replayed refund webhook is idempotent.
- **Section 11: Verify Frontend Direct Payment Reads Removed (Correction 10)** (3 passed)
  - Direct payment reads and Firestore imports removed from `paymentService.ts`.
- **Section 12: Generic Demo Labels Verification** (6 passed)
  - Verified `UPI Demo`, `Demo Wallet Payment`, `Demo Online Payment` present; third-party names removed.
- **Section 13: Order Lifecycle Edge Cases (Phase 9)** (7 passed)
  - Payment attempt for non-existent order returns `NOT_FOUND`.
  - Payment attempt for completed order returns `FAILED_PRECONDITION`.
  - Payment attempt for cancelled order returns `FAILED_PRECONDITION`.
  - Payment attempt for rejected order returns `FAILED_PRECONDITION`.
  - Payment attempt after pickup slot has passed returns `FAILED_PRECONDITION`.
  - Payment attempt after order expiration returns `FAILED_PRECONDITION`.
  - Payment attempt when pricing total is inconsistent returns `FAILED_PRECONDITION`.
- **Section 14: Payment Lifecycle Edge Cases (Phase 9)** (8 passed)
  - Completion of non-existent payment returns `NOT_FOUND`.
  - Payment ID from another order is rejected.
  - Payment completion by another student returns `PERMISSION_DENIED`.
  - Payment amount changed between creation and completion rejected.
  - Currency changed between creation and completion rejected.
  - Provider changed between creation and completion rejected.
  - Successful completion moves order to `payment_verified`.
  - Second payment attempt on already paid order returns `FAILED_PRECONDITION`.
- **Section 15: Additional Refund & Webhook Edge Cases (Phase 9)** (8 passed)
  - Webhook missing eventId rejected with HTTP 400.
  - Webhook oversized eventId (> 128 chars) rejected with HTTP 400.
  - Webhook wrong currency (USD) rejected with HTTP 400.
  - Webhook wrong provider rejected with HTTP 400.
  - Invalid first event rejected with HTTP 400 and did NOT claim event ID.
  - Subsequent valid event with identical eventId successfully processed and claimed event ID.
