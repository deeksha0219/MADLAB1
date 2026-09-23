# Step 9 Audit — Baseline and Payment Inventory

## 1. Commit and Working Tree Baseline
- **Starting Git Commit**: `6f07403` ("Complete Step 8 order status, admin operations, and pickup capacity release hardening")
- **Branch**: `development`
- **Working Tree**: Clean prior to Step 9 modifications.
- **Environment**: Firebase Emulator Suite (`demo-grabngo-local`) — Local emulators for Auth (9099), Firestore (8085), Functions (5001).

## 2. Payment Inventory and Architectural Boundaries
Step 9 establishes the foundational payment security, demo payment lifecycles, and transactionally isolated payment records without introducing live payment gateways, production webhooks, or billing upgrades.

### Frontend Payment Inventory
- **Screen**: `src/screens/PaymentScreen.tsx`
- **Generic Labels** (Enforced per requirement 1):
  - `UPI Demo` (method: `upi_demo`, provider: `demo`)
  - `Demo Wallet Payment` (method: `demo_wallet`, provider: `demo`)
  - `Demo Online Payment` (method: `demo_card`, provider: `demo`)
- **Demo Banner**: Explicit indicator notifying students that all transactions are simulated demo transactions.
- **Client Service**: `src/services/paymentService.ts` providing typed callable wrappers for `createDemoPayment`, `completeDemoPayment`, `failDemoPayment`, `cancelDemoPayment`, `getPaymentStatus`, `requestDemoRefund`, and `completeDemoRefund`.

### Backend Payment Inventory
- **Functions Entrypoint**: `functions/src/index.ts`
- **Callable Functions**:
  - `createDemoPayment`: Initializes a payment attempt under `/orders/{orderId}/payments/{paymentId}` with idempotent deduplication.
  - `completeDemoPayment`: Marks payment attempt as `succeeded_demo` and transitions order status to `payment_verified` atomically.
  - `failDemoPayment`: Records immutable failed attempt and updates order `paymentStatus: "failed"` while leaving order `status: "placed"`.
  - `cancelDemoPayment`: Cancels payment attempt and marks `paymentStatus: "cancelled"`.
  - `getPaymentStatus`: Field-level masked operational read for admins; full read for student owner.
  - `requestDemoRefund`: Marks payment as `refund_pending`.
  - `completeDemoRefund`: Marks payment as `refunded_demo` and transitions order to `refunded`.
- **HTTP Function**:
  - `verifySyntheticWebhook`: Local-only HTTP endpoint verifying raw-body HMAC-SHA256 signatures, amount matching, and replay prevention.
