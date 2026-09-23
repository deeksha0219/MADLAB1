# Step 9 Audit — Demo Payment Functions

## 1. Emulator-Only Guards
Every demo payment operation is strictly guarded against non-emulator execution:
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
- `requestDemoRefund`
- `completeDemoRefund`
- `verifySyntheticWebhook`

## 2. Server-Enforced Operations Summary

### `createDemoPayment`
- Authenticates caller as student.
- Re-reads authoritative `order.pricing.total` from `/orders/{orderId}`.
- Re-reads immutable order status (must be `placed` and `paymentStatus` in `['pending', 'failed', 'cancelled']`).
- Limits: Enforces max 1 active attempt per order and max 3 failed attempts per order.
- Validates idempotency key length (max 128 characters).
- Writes deterministic `{paymentId}_created` event to `paymentHistory`.

### `completeDemoPayment`
- Emulator guarded.
- Atomic transaction: reads order and payment attempt.
- Protects against duplicate success: verifies order is not already `succeeded_demo` or `demo_verified`.
- Re-reads order total and matches payment amount.
- Updates payment status to `succeeded_demo` and order status to `payment_verified`.
- Writes deterministic `{paymentId}_succeeded_demo` history event.

### `failDemoPayment`
- Emulator guarded.
- Enforces failure message length limit (max 200 characters) and standard failure codes.
- Writes immutable failed payment record (`status: "failed"`).
- Order status remains `placed`, with `paymentStatus: "failed"` and `activePaymentId: null`.
- Writes deterministic `{paymentId}_failed` event.

### `cancelDemoPayment`
- Emulator guarded.
- Verifies caller owns order.
- Cancels active attempt, setting `status: "cancelled"` and `paymentStatus: "cancelled"`.
- Writes deterministic `{paymentId}_cancelled` event.

### `getPaymentStatus`
- Operational masking: When called by an admin, synthetic gateway internals (such as raw provider references and low-level gateway logs) are stripped, exposing only operational fields (`paymentId`, `status`, `amount`, `paymentMethod`, `createdAt`, `updatedAt`).

### `requestDemoRefund` & `completeDemoRefund`
- Emulator guarded.
- Requires order to be in a cancellable/refundable or terminal rejected state.
- Transition order and payment to `refund_pending` then `refunded_demo` / `refunded`.
- Writes deterministic `{paymentId}_refund_pending` and `{paymentId}_refunded_demo` events.
