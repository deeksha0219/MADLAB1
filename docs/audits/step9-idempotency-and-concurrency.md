# GrabNGo Step 9 Audit — Idempotency, Concurrency & Deduplication Controls

## 1. Outbound Payment Idempotency & Request Fingerprinting
- **Client Key Submission**: Each payment request from the client supplies an `idempotencyKey` string (1-128 characters alphanumeric/hyphen/underscore).
- **Request Fingerprinting**: The server hashes authoritative request parameters:
  `requestFingerprint = SHA256(orderId + ":" + paymentMethod + ":" + amountInPaise + ":" + currency)`
- **Deduplication Document**: Stored in `/users/{studentUid}/paymentRequests/{idempotencyKey}`.
- **Replay Behavior**:
  - Exact match (`savedFingerprint === requestFingerprint`): returns existing `paymentId`, `status`, and `providerReference` with `isRetry: true`.
  - Conflicting payload under same key: rejected with `already-exists` (`ALREADY_EXISTS`).

## 2. Inbound Webhook Deduplication (Correction 5)
- **Scoped Key**: Provider-scoped document key: `/webhookEvents/{provider}:{eventId}`.
- **Atomic Claim**: The webhook handler (`verifySyntheticWebhook`) claims the document inside the same Firestore transaction as the order/payment mutation.
- **Replay Behavior**: Replaying an already-processed webhook returns HTTP 200 `{ success: true, isIdempotent: true }` without executing side effects or appending duplicate history entries.

## 3. Active Attempt Limits & Lazy Expiry
- Maximum active attempt per order: **1**.
- When an active attempt exists:
  - If both `payment.expiresAt` and `order.activePaymentExpiresAt` are `<= server_time` and `order.activePaymentId === payment.paymentId`, the server lazily expires the attempt and proceeds.
  - If still within TTL, the request is rejected with `failed-precondition`.
- Maximum failed attempts per order: **3**. Excess retry attempts are rejected with `failed-precondition`.

## 4. Concurrency Protection on Payment Completion
- When completing a payment (`completeDemoPayment` or `verifySyntheticWebhook`), a Firestore transaction re-reads:
  1. The target `/orders/{orderId}/payments/{paymentId}` document.
  2. The parent `/orders/{orderId}` document.
- Race conditions are eliminated by verifying:
  - `payment.status` is strictly `'processing'`.
  - `order.status` is strictly `'placed'`.
  - `payment.amountInPaise === order.totalInPaise`.
- If two concurrent requests try to complete different attempts (or the same attempt) simultaneously, only the first transaction commits; the second detects the updated order state and fails cleanly.

## 5. Successful Completion Retry Behavior
- If `completeDemoPayment` is called repeatedly for an attempt that already succeeded, the transaction short-circuits and safely returns the existing success response `{ success: true, isRetry: true, status: "succeeded_demo" }` without adding duplicate history events.
