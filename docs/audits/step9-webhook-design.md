# GrabNGo Step 9 Audit — Webhook Design, Dedicated Handlers & HMAC Verification

## 1. 17-Step Webhook Processing Sequence (Phase 7)
`verifySyntheticWebhook` is implemented as an HTTP function (`functions.https.onRequest`) using `req.rawBody` and executes the following strict 17-step processing pipeline:
1. **Emulator-Only Guard**: Verified before parsing headers or payload; rejects with HTTP 403 if `FUNCTIONS_EMULATOR !== 'true'`.
2. **Read Raw Body**: Extracts `req.rawBody` buffer directly from the incoming request.
3. **Read Signature Header**: Verifies existence of `x-synthetic-signature`. Returns HTTP 400 if missing or empty.
4. **Validate Signature Format**: Confirms hex format and expected digest length (64 hex characters for SHA-256).
5. **Compute HMAC-SHA256**: Generates expected digest over the raw body buffer using synthetic HMAC secret.
6. **Compare with `crypto.timingSafeEqual`**: Constant-time buffer comparison to prevent timing side channels. Returns HTTP 401 on mismatch.
7. **Safe JSON Parse**: Safely parses body; returns HTTP 400 on malformed JSON without executing any database reads.
8. **Validate Event Schema & Bounded IDs**: Checks string lengths and types (`eventId` <= 128 chars, `orderId` <= 64 chars, `paymentId` <= 64 chars, `providerReference` <= 128 chars, positive integer `amountInPaise`). Returns HTTP 400 on malformed schema.
9. **Validate Provider Scope**: Validates provider is `'demo'`; scoped document ID is `/webhookEvents/{provider}:{eventId}`.
10. **Validate Order/Payment Binding**: Cross-checks that `paymentData.orderId === orderId`. Returns HTTP 400 on mismatch.
11. **Load Trusted Payment & Order Records**: Fetches authoritative documents inside Firestore transaction. Returns HTTP 404 if either document does not exist.
12. **Validate amountInPaise & Currency**: Compares webhook amount against server paise total (`paymentData.amountInPaise === amountInPaise`), and checks currency is `'INR'`.
13. **Validate Provider Reference**: Verifies `providerReference` against server records (`paymentData.providerReference` or `paymentData.refundReference`).
14. **Validate Current State & Target Transition**: Enforces transition rules (`processing` -> `succeeded_demo` or `failed`; `succeeded_demo` with `refundStatus: pending` -> `succeeded_demo`). Returns HTTP 409 on invalid transition.
15. **Claim Event ID & Apply Side Effects in One Transaction**: Atomically sets `/webhookEvents/{provider}:{eventId}` while updating order and payment records.
16. **Write Sanitized Audit Metadata**: Records deterministic history events (`{paymentId}_succeeded_demo`, `{paymentId}_failed`, or `{paymentId}_refunded_demo`).
17. **Return Safe Response**: Returns HTTP 200 `{ success: true, isIdempotent: boolean, processedEventId }`.

### Invariant: Invalid Events Never Claim Event IDs
If validation fails at any point prior to transaction commit (e.g. invalid signature, bad JSON, unknown event, wrong amount, wrong provider reference), the transaction aborts and no document is created in `/webhookEvents`. A subsequent valid event with the same ID can therefore be processed safely.

## 2. Dedicated Event Handlers (Correction 6)
The endpoint implements separate, strictly validated handlers for distinct event types:

### A. `payment.captured` (or `payment.succeeded`)
- Verifies `paymentData.providerReference === providerReference`.
- Verifies `paymentData.amountInPaise === amountInPaise`.
- Verifies `paymentData.status === 'processing'` (only processing can be captured).
- Verifies `orderData.status === 'placed'`.
- Atomically updates:
  - `paymentRef`: `status: 'succeeded_demo'`, `completedAt: serverTimestamp()`.
  - `orderRef`: `status: 'payment_verified'`, `paymentStatus: 'succeeded_demo'`, `activePaymentId: null`.
  - Records deterministic history: `{paymentId}_succeeded_demo` and `{orderId}_placed_to_payment_verified`.

### B. `payment.failed`
- Verifies `paymentData.providerReference === providerReference`.
- Verifies `paymentData.amountInPaise === amountInPaise`.
- Verifies `paymentData.status === 'processing'`.
- Atomically updates:
  - `paymentRef`: `status: 'failed'`, `failureCode: 'WEBHOOK_PAYMENT_FAILED'`.
  - `orderRef`: `paymentStatus: 'failed'`, `activePaymentId: null`.
  - Records deterministic history: `{paymentId}_failed`.

### C. `refund.processed` (Correction 2)
- Verifies `payment.status === 'succeeded_demo'`.
- Verifies `payment.refundStatus === 'pending'`.
- Verifies `order.status === 'cancelled' || order.status === 'rejected'`.
- Verifies refund event belongs to correct order and payment (`paymentData.orderId === orderId`).
- Verifies full refund amount equals original `amountInPaise` (partial refunds rejected).
- Verifies provider/refund reference strictly against server refund record (`providerReference === paymentData.refundReference`). Reusing the original payment `providerReference` is strictly rejected.
- Atomically updates:
  - `paymentRef`: `refundStatus: 'succeeded_demo'`, `refundedAmountInPaise`, `refundProviderReference`, `refundedAt`.
  - `orderRef`: `refundStatus: 'refunded_demo'` (Order status remains `cancelled` or `rejected`, NEVER `refunded`).
  - Records deterministic history: `{paymentId}_refunded_demo`.
  - Replays of the refund event are deduplicated idempotently.
