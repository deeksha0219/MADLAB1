# GrabNGo Step 9 Audit: Payment Expiry Architecture & Invariants

## 1. Overview
Payment attempts in GrabNGo represent transient authorization windows (default 15 minutes TTL). To prevent orphan pending attempts, double authorizations, and resource locking, a rigorous, transaction-safe expiry subsystem was implemented in Step 9.

## 2. Invariants & Guard Rules (Correction 3 & Phase 1)
A payment attempt may transition to `expired` status **if and only if** all of the following conditions hold simultaneously inside a single Firestore transaction:
1. `order.activePaymentId === paymentId`: The payment being expired is the currently tracked active payment on the parent order document.
2. `payment.status === "processing"`: The payment attempt is non-terminal. Terminal states (`succeeded_demo`, `failed`, `cancelled`, `expired`) are immutable and can never be transitioned to expired.
3. `payment.expiresAt <= server_time`: The payment attempt's server-derived expiration timestamp has passed.
4. `order.activePaymentExpiresAt <= server_time`: The parent order's active payment expiration timestamp has passed.
5. `order.status === "placed"`: Order must be in `placed` status.

If any of these conditions fails, the operation is rejected and **no write** is performed. Specifically:
- If `payment.expiresAt` is past but `order.activePaymentExpiresAt` is not past: rejected.
- If `order.activePaymentExpiresAt` is past but `payment.expiresAt` is not past: rejected.
- If `order.activePaymentId` points to another newer payment: rejected (never clears a newer active payment).
- If payment is already terminal or expired: rejected.

## 3. Business Results of Payment Expiry (Phase 1)
When an active payment attempt expires, the transaction produces exactly this business result:
```
payment.status = "expired"
payment.expiredAt = server timestamp
order.status = "placed"
order.paymentStatus = "pending"
order.activePaymentId = null
order.activePaymentExpiresAt = null
```

### Critical Business Invariant: Expiry is NOT Payment Failure
- The order status remains `placed`.
- The order payment status returns to `pending` (it is **NEVER** set to `failed`).
- The order remains eligible for a new payment attempt, subject to normal attempt-limit and idempotency rules.
- `order.paymentStatus = "failed"` is reserved exclusively for explicit, validated payment failures (e.g. gateway rejection, card declined, synthetic test failure).
- Expiry does **NOT** release pickup capacity. Capacity is reserved upon order placement and released only if the order itself is cancelled or rejected.

## 4. Expiry Mechanisms
GrabNGo utilizes two complementary mechanisms for expiring attempts:
1. **Lazy Expiry on Subsequent Creation (`createDemoPayment`)**:
   When a student attempts to initiate a new payment attempt for an order that currently has an active `processing` attempt, the server inspects the existing attempt:
   - If both `payment.expiresAt` and `order.activePaymentExpiresAt` are `<= server_time` and `order.activePaymentId === payment.paymentId`, the server lazily transitions the stale attempt to `expired`, sets `order.paymentStatus = 'pending'`, clears `activePaymentId` and `activePaymentExpiresAt`, records `{paymentId}_expired` in `paymentHistory`, and proceeds to create the new attempt.
   - If the attempt is still within its active TTL window, the new attempt is rejected with `failed-precondition`.
2. **Explicit Callable Expiry (`expirePaymentAttempt`)**:
   Enables the frontend timer or background scheduler to explicitly expire a timed-out attempt via an emulator-guarded callable function, ensuring synchronized status on both order and payment records.

## 5. Deterministic History Event
Every expired transition emits exactly one deterministic payment history event at:
`/orders/{orderId}/paymentHistory/{paymentId}_expired`
- `eventId`: `{paymentId}_expired`
- `fromStatus`: `processing`
- `toStatus`: `expired`
- `reason`: `"Payment attempt expired due to TTL timeout"`
- `actorRole`: `"system"` (or `"student"` / `"admin"`)

This prevents duplicate or conflicting history entries and preserves an audit trail of expired attempts.
