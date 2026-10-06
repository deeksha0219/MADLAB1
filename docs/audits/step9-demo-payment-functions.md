# GrabNGo Step 9 Audit — Demo Payment Callable Functions

## 1. Emulator-Only Guards
Every demo payment simulation operation is strictly guarded against execution outside the local emulator:
```typescript
function assertEmulatorOnly(opName: string): void {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `${opName} is only allowed in local emulator environment.`
    );
  }
}
```
This guard protects:
- `completeDemoPayment`
- `failDemoPayment`
- `cancelDemoPayment`
- `expirePaymentAttempt`
- `requestDemoRefund`
- `completeDemoRefund`
- `verifySyntheticWebhook`

## 2. Server-Enforced Callable Operations Summary

### `createDemoPayment`
- Authenticates caller as student.
- Rejects unknown fields: strictly accepts `{ orderId, idempotencyKey }` (Correction 1).
- Derives `paymentMethod` exclusively from server order document; rejects client-supplied methods.
- Rejects cash and COD orders from creating online payment attempts (`failed-precondition`).
- Re-reads authoritative `order.totalInPaise`.
- Re-reads immutable order status (must be `placed`).
- Enforces max 1 active attempt (with transaction-safe lazy-expiry) and max 3 failed attempts per order.
- Generates server-side `expiresAt` (now + 15m).
- Creates attempt directly in `status: 'processing'` (Correction 2).
- Writes single deterministic `{paymentId}_processing` event to `paymentHistory` (Correction 4).

### `completeDemoPayment`
- Emulator guarded.
- Atomic transaction: reads order and payment attempt.
- Strictly requires payment `status === 'processing'` (Correction 2).
- Verifies order `status === 'placed'` and not already paid.
- Matches `payment.amountInPaise === order.totalInPaise`.
- Updates payment status to `succeeded_demo` and order status to `payment_verified`.
- Writes deterministic `{paymentId}_succeeded_demo` and `{orderId}_placed_to_payment_verified` history events.

### `failDemoPayment`
- Emulator guarded.
- Strictly requires payment `status === 'processing'`.
- Enforces sanitized failure codes and sanitized failure message (max 200 characters).
- Writes immutable failed payment record (`status: 'failed'`).
- Order status remains `placed`, with `paymentStatus: 'failed'` and `activePaymentId: null`.
- Writes deterministic `{paymentId}_failed` event.

### `cancelDemoPayment`
- Emulator guarded.
- Verifies caller owns order.
- Cancels active processing attempt, setting `status: 'cancelled'` and order `paymentStatus: 'cancelled'`.
- Writes deterministic `{paymentId}_cancelled` event.

### `expirePaymentAttempt`
- Emulator guarded.
- Verifies `order.activePaymentId === paymentId`.
- Verifies payment `status === 'processing'`.
- Verifies both `payment.expiresAt <= server_time` and `order.activePaymentExpiresAt <= server_time` (Correction 3).
- Updates payment `status: 'expired'`, order `paymentStatus: 'pending'`, `activePaymentId: null`.
- Writes deterministic `{paymentId}_expired` event.

### `getPaymentStatus`
- Authenticates caller (student owner or assigned canteen admin).
- Operational masking: When called by an admin, synthetic gateway internals (`providerReference`, internal failure codes) are stripped, exposing only operational fields (`paymentId`, `status`, `refundStatus`, `amountInPaise`, `paymentMethod`, `attemptNumber`, timestamps).
- When called by student owner, returns sanitized student view.

### `requestDemoRefund` & `completeDemoRefund`
- Emulator guarded.
- `requestDemoRefund`: requires order `status === 'cancelled' || status === 'rejected'` and payment `status === 'succeeded_demo'`. Assigns `refundReference` and sets `refundStatus: 'pending'`.
- `completeDemoRefund`: admin authorization only. Derives full refund amount server-side from `payment.amountInPaise` (Correction 7). Sets `refundStatus: 'succeeded_demo'` and `order.refundStatus: 'refunded_demo'`.
- Order status remains `cancelled` or `rejected`, NEVER overwritten with `'refunded'`.
