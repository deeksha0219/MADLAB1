# GrabNGo Step 8 Audit — Status State Machine

## 1. State Machine Definitions

Orders follow a deterministic, unidirectional lifecycle partitioned into valid and terminal states.

```
Cash Path:
[placed] --(Admin Accept)--> [accepted] --(Admin Prepare)--> [preparing] --(Admin Ready)--> [ready_for_pickup] --(Admin Complete)--> [completed]*

Online Demo Path:
[placed] --(Demo Verify)--> [payment_verified] --(Admin Accept)--> [accepted] --> [preparing] --> [ready_for_pickup] --> [completed]*

Cancellation / Rejection Paths:
[placed] --(Student Cancel, pending & before slot)--> [cancelled]*
[placed | payment_verified | accepted | preparing | ready_for_pickup] --(Admin Reject with Reason)--> [rejected]*
[placed | payment_verified | accepted | preparing | ready_for_pickup] --(Admin Cancel with Reason)--> [cancelled]*

* Terminal States (Immutable, cannot transition further)
```

---

## 2. Permitted Transitions Matrix

| Current Status | Target Status | Permitted Actor | Conditions & Invariants |
| :--- | :--- | :--- | :--- |
| `placed` | `accepted` | Assigned Canteen Admin | Order paymentMethod == `'cash'`. Direct progression. |
| `placed` | `payment_verified` | System / Demo Helper | Allowed strictly via `verifyDemoPayment` (emulator-only). |
| `payment_verified` | `accepted` | Assigned Canteen Admin | Online order confirmed paid; kitchen acknowledges. |
| `accepted` | `preparing` | Assigned Canteen Admin | Kitchen starts food preparation. |
| `preparing` | `ready_for_pickup` | Assigned Canteen Admin | Food packed and placed on pickup counter. |
| `ready_for_pickup` | `completed` | Assigned Canteen Admin | Student collects order at counter. Terminal state. |
| `placed` | `cancelled` | Order Student Owner | `paymentStatus == 'pending'`, order belongs to caller, current time is before pickup slot start time in `Asia/Kolkata`. Decrements slot `reservedCount` with explicit invariant validation. |
| Any non-terminal | `cancelled` / `rejected` | Assigned Canteen Admin | Requires non-empty audit `reason` (1–200 chars). Decrements slot `reservedCount` with explicit invariant validation. |

---

## 3. Disallowed and Guarded Transitions

1. **Skipping steps**:
   - `placed` $\rightarrow$ `preparing` (REJECTED)
   - `placed` $\rightarrow$ `completed` (REJECTED)
   - `accepted` $\rightarrow$ `ready_for_pickup` (REJECTED)
2. **Backward transitions**:
   - `accepted` $\rightarrow$ `placed` (REJECTED)
   - `ready_for_pickup` $\rightarrow$ `preparing` (REJECTED)
3. **Premature online acceptance**:
   - `placed` (online) $\rightarrow$ `accepted` (REJECTED until `payment_verified`)
4. **Terminal state immutability**:
   - `completed` $\rightarrow$ any status (REJECTED)
   - `cancelled` $\rightarrow$ any status (REJECTED)
   - `rejected` $\rightarrow$ any status (REJECTED)

---

## 4. Pickup Capacity Release Hardening

### 4.1 Previous Behavior (Silent Clamping)
Earlier Step 8 logic computed:
```ts
newReserved = Math.max(0, currentReserved - 1)
```
While this prevented negative numbers from being written, it silently masked corrupted or exhausted slot data (such as `reservedCount = 0`, `reservedCount = -1`, or non-integers), allowing cancellations to succeed even when the underlying capacity state was inconsistent.

### 4.2 Hardened Behavior (Explicit Invariant Validation)
The clamping behavior was completely replaced by `validateAndComputeSlotCapacityRelease`, which validates the slot document inside the Firestore transaction before any write occurs:
1. **Integer Validation**: `reservedCount` must exist and be an integer.
2. **Capacity Validation**: `capacity` must exist and be a non-negative integer.
3. **Boundary Invariants**:
   $$1 \le \text{reservedCount} \le \text{capacity}$$
4. **Exact Decrement**:
   $$\text{newReservedCount} = \text{reservedCount} - 1 \ge 0$$
5. **Atomic Rollback on Failure**:
   If `reservedCount < 1`, `reservedCount > capacity`, or fields are malformed/missing, the function throws:
   ```
   failed-precondition: Pickup slot capacity state is inconsistent.
   ```
   The transaction immediately aborts. No status update is applied to the order, no history event is created, and no write is made to the slot.

---

## 5. Replay Idempotency and Concurrency

- **Idempotent Retries**: When `transitionOrderStatus` is called for an order already in `cancelled` or `rejected` status with the identical target status, the function immediately returns `{ success: true, isIdempotent: true, status: currentStatus }` without reading or writing slot capacity or status history.
- **Concurrent Attempts**: When concurrent cancellation requests arrive, Firestore's transactional concurrency control ensures only one transaction commits the transition and capacity release, while the concurrent attempt is either serialized into an idempotent response or safely rejected.
