# GrabNGo Step 9 Audit: Refund Logic, Lifecycle & Decoupled State

## 1. Executive Summary
GrabNGo Step 9 establishes a secure, server-enforced refund lifecycle. To avoid state corruption and preserve financial integrity, payment status and refund status are decoupled across order and payment records.

## 2. Decoupled State Model
1. **Order State Separation**:
   - When an order is cancelled or rejected after payment verification, `order.status` transitions strictly to `'cancelled'` or `'rejected'`.
   - `order.status` is **NEVER** set to `'refunded'`. An order's lifecycle terminal state remains its operational outcome (`cancelled` or `rejected`).
   - The refund status of the order is tracked in a dedicated field: `order.refundStatus: 'pending' | 'refunded_demo'`.
2. **Payment State Separation**:
   - A successfully completed payment retains its primary status: `payment.status: 'succeeded_demo'`.
   - Its refund status is tracked independently: `payment.refundStatus: 'not_requested' | 'pending' | 'succeeded_demo'`.
   - This ensures historical accounting queries can clearly distinguish that the payment was captured and subsequently refunded, rather than overwritten.

## 3. Server-Enforced Invariants (Correction 2 & 7)
All refund operations enforce the following invariants:
- **Eligible Status**: A refund can only be requested if `payment.status === 'succeeded_demo'` and `order.status === 'cancelled' || order.status === 'rejected'`.
- **Pre-existing Pending Guard**: If `payment.refundStatus === 'pending'`, duplicate requests are idempotently acknowledged.
- **Server Amount Derivation**: Refund amounts are derived directly from `payment.amountInPaise` (and verified against `order.totalInPaise`). Client-supplied refund amounts are strictly rejected. Partial refunds are currently disabled by policy; only full refunds are processed.
- **Refund Reference Tracking**: When a refund is initiated (`requestDemoRefund`), a cryptographic `refundReference` (e.g. `demo_ref_<uuid>`) is generated and recorded on the payment document.
- **Webhook Finalization Verification (`handleRefundProcessed`)**:
  When receiving a `refund.processed` webhook:
  - Verifies `payment.status === 'succeeded_demo'`.
  - Verifies `payment.refundStatus === 'pending'`.
  - Verifies `order.status === 'cancelled' || order.status === 'rejected'`.
  - Verifies `amountInPaise === payment.amountInPaise`.
  - Verifies `providerReference === payment.refundReference` (`refund.processed` strictly rejects the original payment `providerReference`).
  - Updates only `refundStatus`, `refundedAmountInPaise`, `refundProviderReference`, `refundedAt`.
  - Does NOT modify `order.status`.
  - Replays of the refund event are deduplicated idempotently via `/webhookEvents/demo:{eventId}`.

## 4. Audit & Payment History
Each refund stage records an immutable, deterministic history entry in `/orders/{orderId}/paymentHistory`:
- Initiation: `{paymentId}_refund_pending` (`fromStatus: 'not_requested'`, `toStatus: 'pending'`).
- Completion: `{paymentId}_refunded_demo` (`fromStatus: 'pending'`, `toStatus: 'succeeded_demo'`).
