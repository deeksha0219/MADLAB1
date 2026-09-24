# GrabNGo Step 11: Status Transition Safety and Concurrency

## 1. Operational State Machine

Status transitions are governed by a single server-authoritative state machine executed within Firestore transactions:

```
[placed] ──(cash)──> [accepted] ──> [preparing] ──> [ready_for_pickup] ──> [completed]
   │                      │              │                   │
   ├──(online paid)──> [accepted]        │                   │
   │                      │              │                   │
   └──(cancel/reject)─────┴──────────────┴───────────────────┴──> [cancelled] / [rejected]
```

### 1.1 Transition Allowlist

| Current Status | Payment Method | Allowed Next Statuses | Actor |
| --- | --- | --- | --- |
| `placed` | `cash` | `accepted`, `cancelled`, `rejected` | Canteen Admin / Service Desk |
| `placed` | `upi_demo` | `cancelled`, `rejected` (Needs payment verified before accept) | Canteen Admin / Service Desk |
| `payment_verified` | Any | `accepted`, `cancelled`, `rejected` | Canteen Admin / Service Desk |
| `accepted` | Any | `preparing`, `cancelled`, `rejected` | Canteen Admin / Service Desk |
| `preparing` | Any | `ready_for_pickup`, `cancelled`, `rejected` | Canteen Admin / Service Desk |
| `ready_for_pickup`| Any | `completed`, `cancelled`, `rejected` | Canteen Admin / Service Desk |
| `completed` | Any | **None** (Terminal State) | None |
| `cancelled` | Any | **None** (Terminal State) | None |
| `rejected` | Any | **None** (Terminal State) | None |

---

## 2. Concurrency Control & Idempotency

### 2.1 Transactional Precondition
All updates execute inside `db.runTransaction`:
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

### 2.2 Concurrent Operator Safety
When two operators simultaneously attempt to update the same order (e.g. Operator A marks `preparing` and Operator B marks `preparing` or `cancelled`), Firestore's optimistic concurrency guarantees that exactly one transaction commits. The second transaction either:
1. Re-reads the updated status and returns an idempotent success (`isIdempotent: true`), or
2. Fails cleanly with `failed-precondition` if the state changed incompatibly.

In all cases:
- Exactly one status update commits.
- Exactly one audit event / status history entry is created per valid state transition.
- Zero duplicate capacity releases occur.
- Zero duplicate notifications are dispatched.
