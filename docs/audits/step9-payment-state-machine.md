# GrabNGo Step 9 Audit — Payment State Machine & State Separation

## 1. Canonical State Values & Schema Consistency (Phase 4)
The GrabNGo payment architecture strictly enforces the following canonical values across all server operations:

### `payment.status`
- `processing`: Created directly upon invocation of `createDemoPayment`. Carries an active TTL (`expiresAt = now + 15m`).
- `succeeded_demo`: Payment verified and completed. Transitions order status to `payment_verified`. Terminal success for the attempt. **Only attempts in `'processing'` can transition to `'succeeded_demo'`.**
- `failed`: Payment attempt failed (e.g. user error, simulated decline, or webhook failure). Failed records are permanently immutable. Order remains in `status: 'placed'` and `paymentStatus: 'failed'`, permitting a fresh retry.
- `cancelled`: Payment attempt cancelled by the student before completion.
- `expired`: Payment attempt timed out past its TTL. Transitioned transaction-safely via lazy-expiry or `expirePaymentAttempt`. Returns `order.paymentStatus` to `'pending'`.

### `payment.refundStatus`
- `not_requested`: Initial default state upon payment creation.
- `pending`: Refund initiated after order cancellation or rejection.
- `succeeded_demo`: Refund successfully processed and finalized via `completeDemoRefund` or `refund.processed` webhook.

### `order.status`
- `placed`
- `payment_verified`
- `accepted`
- `preparing`
- `ready_for_pickup`
- `completed`
- `cancelled`
- `rejected`
*(Note: `order.status` is NEVER set to `'refunded'`).*

### `order.paymentStatus`
- `pending`: Initial state upon order creation, and the state restored when an attempt expires.
- `processing`: Active payment attempt in progress.
- `succeeded_demo`: Verified successful payment.
- `failed`: Explicit payment failure.
- `cancelled`: Payment cancelled.
- `refunded_demo`: Order refund has been finalized.

### Forbidden Values
- `demo_verified` (completely purged from codebase and types)
- `order.status = "refunded"` (order status stays `cancelled` or `rejected`)

## 2. Integer Currency Invariant
- All monetary calculations are performed strictly in integer paise (`amountInPaise`, `refundedAmountInPaise`).
- Floating-point rupees, negative amounts, zero amounts, non-integers, and values exceeding `MAX_PAYMENT_AMOUNT_PAISE` (500,000 paise / ₹5,000) are rejected with `failed-precondition` or `invalid-argument`.

## 3. Decoupled Refund Lifecycle
- **Order Level**: When an order is cancelled or rejected post-payment, `order.status` transitions strictly to `'cancelled'` or `'rejected'`. The order status is **NEVER** overwritten with `'refunded'`. Instead, `order.refundStatus` tracks `'pending' -> 'refunded_demo'`.
- **Payment Level**: The payment record retains its primary status as `status: 'succeeded_demo'`, while independently tracking `refundStatus: 'pending' -> 'succeeded_demo'`.

## 4. Failed Attempt Immutability & Retry Invariants
1. **Failed Records are Immutable**: Once marked `failed`, a payment record cannot be updated, transitioned, or overwritten to `succeeded_demo`.
2. **New Attempt ID**: Every retry generates a new cryptographic `paymentId` (`pay_<uuid>`).
3. **New Idempotency Key**: Retrying with the same idempotency key idempotently returns the existing attempt rather than creating a duplicate. A new attempt requires a new idempotency key.
4. **Authoritative Total Re-read**: The server always queries `/orders/{orderId}` to fetch `totalInPaise` rather than trusting client-supplied values.
5. **Max Failed Attempts**: Limited to 3 failed attempts per order to prevent attempt flooding.

## 5. Expiry vs. Failure State Separation
- **Expiry**: When an attempt times out past TTL without a completion or failure signal, `order.paymentStatus` returns to `'pending'` and the order remains `'placed'`. The order is immediately eligible for a new attempt.
- **Explicit Failure**: When a payment attempt fails explicitly (via `failDemoPayment` or webhook `payment.failed`), `order.paymentStatus` is set to `'failed'`.
- **Cancellation**: When student cancels their attempt, `order.paymentStatus` is set to `'cancelled'`.
