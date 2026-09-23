# Step 9 Audit — Idempotency and Concurrency Controls

## 1. Idempotency Key Architecture
- Each payment request from the client supplies an `idempotencyKey` string (limited to 128 characters).
- Dedup documents are stored in `/users/{userId}/paymentRequests/{idempotencyKey}`.
- If a client retries `createDemoPayment` with the same idempotency key for an active attempt, the function returns the existing `paymentId` without creating a duplicate payment attempt.
- Once an attempt has failed, a new attempt requires a distinct idempotency key.

## 2. Active Attempt Limits
- Maximum active attempt per order: **1**.
- If an existing payment attempt is currently `created` or `processing` and unexpired, attempts to create another payment return an error indicating an active attempt is already in flight.
- Maximum failed attempts per order: **3**. Excess retry attempts are rejected with `failed-precondition`.

## 3. Concurrency Protection on Payment Completion
- When completing a payment (`completeDemoPayment`), a Firestore transaction re-reads both:
  1. The target `/orders/{orderId}/payments/{paymentId}` document.
  2. The parent `/orders/{orderId}` document.
- Race conditions are eliminated by verifying:
  - `order.paymentStatus` is not already `succeeded_demo` or `demo_verified`.
  - `order.status` is not already `payment_verified`.
  - `payment.status` is not already `succeeded_demo` or `failed`.
- If two concurrent requests try to complete different attempts (or the same attempt) simultaneously, only the first transaction commits; the second detects the updated order state and fails cleanly.

## 4. Successful Retry Behavior
- If `completeDemoPayment` is called repeatedly for an attempt that already succeeded, the transaction short-circuits and safely returns the existing success response `{ success: true, paymentId, status: "succeeded_demo" }` without adding duplicate history events.
