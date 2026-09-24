# GrabNGo Step 11: Status Transition Safety and Concurrency

## 1. Canonical Order State Model

### 1.1 Separation of Fulfillment Status and Payment State
GrabNGo strictly decouples the order fulfillment lifecycle (`order.status`) from the financial settlement state (`order.paymentStatus` and `order.refundStatus`):

```typescript
// Canonical order status (fulfillment lifecycle)
type OrderStatus =
  | 'placed'
  | 'payment_verified'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'completed'
  | 'cancelled'
  | 'rejected';

// Canonical payment status (financial state)
type PaymentStatus =
  | 'pending'
  | 'succeeded_demo'
  | 'failed'
  | 'expired'
  | 'refunded_demo'
  | 'none';

// Canonical refund status
type RefundStatus =
  | 'none'
  | 'demo_refund_pending'
  | 'demo_refund_completed';
```

- **`order.status`**: Governs order fulfillment and operator workflow.
- **`order.paymentStatus`**: Managed exclusively by payment callables (`completeDemoPayment`, webhook simulation) and never modified by `transitionOperationalOrderStatus`.
- **`payment_verified` Role**: `payment_verified` is a canonical `order.status` indicating that online payment succeeded (`paymentStatus === 'succeeded_demo'`). It serves as an mandatory gate before an operator can accept an online order. Payment verification **cannot bypass** the server-side state machine; it does NOT mark the order as accepted, preparing, or completed.

---

## 2. Transition State Machine: Cash vs. Demo-Paid Orders

### 2.1 Cash Orders (`paymentMethod === 'cash'`)
Cash orders do not undergo online payment verification. They are paid at the counter upon pickup:
```
[placed] ──> [accepted] ──> [preparing] ──> [ready_for_pickup] ──> [completed]
   │
   └──(cancel/reject)──> [cancelled] / [rejected]
```
- From `placed`, the operator can transition directly to `accepted`, `cancelled`, or `rejected`.
- Cash orders cannot transition to `payment_verified`.

### 2.2 Demo-Paid Online Orders (`paymentMethod === 'upi_demo'`)
Online payment orders require verified settlement before preparation can begin:
```
[placed] (paymentStatus: pending)
   │
   ├──(completeDemoPayment / webhook)──> [payment_verified] (paymentStatus: succeeded_demo)
   │                                            │
   │                                            ├──> [accepted] ──> [preparing] ──> [ready_for_pickup] ──> [completed]
   │                                            │
   └──(cancel / reject before payment)          └──(cancel / reject after payment)
             │                                                │
             ▼                                                ▼
       [cancelled] / [rejected]                         [cancelled] / [rejected]
       (refundStatus: none)                             (refundStatus: demo_refund_completed)
                                                        (capacity released: reservedCount - 1)
```

1. **At `placed`**:
   - `paymentStatus` is `pending`.
   - The operator **CANNOT** accept the order (`failed-precondition`).
   - The operator or student can cancel/reject the order.
2. **Payment Verification**:
   - Executed via `completeDemoPayment` or synthetic webhook in a server-side Firestore transaction.
   - Atomically updates `status: 'payment_verified'` and `paymentStatus: 'succeeded_demo'`.
   - Records deterministic `statusHistory` entry (`placed_to_payment_verified`).
   - Dispatches idempotent `payment_verified_for_admin` notification.
3. **From `payment_verified`**:
   - Operator can transition to `accepted`, `cancelled`, or `rejected`.
   - Operator **cannot** skip directly to `preparing`, `ready_for_pickup`, or `completed`.
4. **Fulfillment Progression**:
   - `accepted` ──> `preparing` ──> `ready_for_pickup` ──> `completed`.
5. **Terminal Protection**:
   - Once an order reaches `completed`, `cancelled`, or `rejected`, all further transitions are rejected (`failed-precondition`).

---

## 3. Transition Matrix Allowlist

| Source Status | Payment Method | Allowed Next Statuses | Actor Authorization | Capacity Effect |
| --- | --- | --- | --- | --- |
| `placed` | `cash` | `accepted`, `cancelled`, `rejected` | Canteen Admin / Service Desk | Decrement if cancelled/rejected |
| `placed` | `upi_demo` | `cancelled`, `rejected` | Canteen Admin / Service Desk / Student (own) | Decrement if cancelled/rejected |
| `placed` | `upi_demo` | `payment_verified` | Payment Callable / Webhook ONLY | None (remains reserved) |
| `payment_verified` | `upi_demo` | `accepted`, `cancelled`, `rejected` | Canteen Admin / Service Desk | Decrement if cancelled/rejected |
| `accepted` | Any | `preparing`, `cancelled`, `rejected` | Canteen Admin / Service Desk | Decrement if cancelled/rejected |
| `preparing` | Any | `ready_for_pickup`, `cancelled`, `rejected` | Canteen Admin / Service Desk | Decrement if cancelled/rejected |
| `ready_for_pickup` | Any | `completed`, `cancelled`, `rejected` | Canteen Admin / Service Desk | Decrement if cancelled/rejected |
| `completed` | Any | **None** | Terminal State | None |
| `cancelled` | Any | **None** | Terminal State | None |
| `rejected` | Any | **None** | Terminal State | None |

---

## 4. Concurrency Control & Idempotency

### 4.1 Transactional Precondition
All status changes execute inside `db.runTransaction`:
```typescript
const orderSnap = await transaction.get(orderRef);
const currentStatus = orderSnap.data().status;

// 1. Terminal state check
if (['completed', 'cancelled', 'rejected'].includes(currentStatus)) {
  throw new functions.https.HttpsError('failed-precondition', 'Order is in terminal state.');
}

// 2. Idempotent replay check
if (currentStatus === nextStatus) {
  return { success: true, isIdempotent: true, status: nextStatus };
}
```

### 4.2 Concurrent Operator Safety
When two operators simultaneously attempt to update the same order (e.g., Operator A marks `preparing` and Operator B marks `preparing` or `cancelled`), Firestore's optimistic concurrency ensures that exactly one transaction commits. The second transaction either:
1. Re-reads the updated status and returns an idempotent success (`isIdempotent: true`), or
2. Fails cleanly with `failed-precondition` if the state changed incompatibly.

In all scenarios:
- Exactly one status update commits.
- Exactly one audit event / status history entry is created per valid state transition.
- Zero duplicate capacity releases occur.
- Zero duplicate notifications are dispatched.
