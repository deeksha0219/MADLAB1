# GrabNGo Step 9 Audit — Baseline and Payment Inventory

## 1. Commit and Working Tree Baseline
- **Starting Git Commit**: `6f07403` ("Complete Step 8 order status, admin operations, and pickup capacity release hardening")
- **Branch**: `development`
- **Environment**: Firebase Emulator Suite (`demo-grabngo-local`) — Local emulators for Auth (9099), Firestore (8085), Functions (5001).

## 2. Payment Inventory and Architectural Boundaries
Step 9 establishes the foundational payment security, demo payment lifecycles, and transactionally isolated payment records without introducing live payment gateways, external network requests, production webhooks, or billing upgrades.

### Frontend Payment Inventory
- **Screen**: `src/screens/PaymentScreen.tsx`
- **Generic Labels** (Enforced per Correction 1):
  - `UPI Demo` (method: `upi_demo`, provider: `demo`)
  - `Demo Wallet Payment` (method: `demo_wallet`, provider: `demo`)
  - `Demo Online Payment` (method: `demo_card`, provider: `demo`)
- **Demo Banner**: Persistent indicator notifying students that all transactions are simulated demo transactions.
- **Client Service**: `src/services/paymentService.ts` providing typed callable wrappers for `createDemoPaymentCallable`, `completeDemoPaymentCallable`, `failDemoPaymentCallable`, `cancelDemoPaymentCallable`, `getPaymentStatusCallable`, `requestDemoRefundCallable`, and `completeDemoRefundCallable`.
- **Zero Direct Reads**: Direct Firestore queries (`getOrderPayments`, `getOrderPaymentHistory`) and direct Firestore imports were completely purged from `src/services/paymentService.ts`.

### Backend Payment Inventory
- **Functions Entrypoint**: `functions/src/index.ts`
- **Provider Interface**: `functions/src/payments/types.ts`
- **Callable Functions**:
  - `createDemoPayment`: Strictly accepts `{ orderId, idempotencyKey }`. Derives `paymentMethod` from server order document. Rejects cash/COD. Creates attempt directly in `processing`. Emits single `{paymentId}_processing` event.
  - `completeDemoPayment`: Marks attempt as `succeeded_demo` and transitions order to `payment_verified` atomically. Requires `processing` status.
  - `failDemoPayment`: Records immutable failed attempt and updates order `paymentStatus: "failed"` while leaving order `status: "placed"`.
  - `cancelDemoPayment`: Cancels payment attempt and marks order `paymentStatus: "cancelled"`.
  - `expirePaymentAttempt`: Transaction-safe expiry enforcing `activePaymentId`, `processing` status, and dual TTL expiration.
  - `getPaymentStatus`: Field-level masked operational read for admins; sanitized full read for student owner.
  - `requestDemoRefund`: Assigns `refundReference` and marks payment `refundStatus: "pending"`.
  - `completeDemoRefund`: Marks payment `refundStatus: "succeeded_demo"` and order `refundStatus: "refunded_demo"` while order `status` remains `'cancelled'` or `'rejected'`.
- **HTTP Function**:
  - `verifySyntheticWebhook`: Local-only HTTP endpoint verifying raw-body HMAC-SHA256 signatures, scoped deduplication (`/webhookEvents/demo:{eventId}`), and dedicated handlers for `payment.captured`, `payment.failed`, and `refund.processed`.
