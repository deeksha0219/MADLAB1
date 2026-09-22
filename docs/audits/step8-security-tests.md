# GrabNGo Step 8 Audit — Security and Transition Tests

## 1. Test Suite Architecture

The automated emulator status test runner (`scripts/run-emulator-status-test.js`) executes 65 real security, boundary, and capacity-release assertions against live local Auth (9099), Firestore (8085), and Functions (5001) Emulators.

---

## 2. Test Execution Breakdown

### Section 1: Valid Transitions (Cash Lifecycle)
- `createOrder`: Verified order creation with top-level `pickupSlotId`.
- Initial history record: Verified creation of `${orderId}_initial_placed`.
- `placed` $\rightarrow$ `accepted`: Verified transition by assigned admin.
- `accepted` $\rightarrow$ `preparing`: Verified transition by assigned admin.
- `preparing` $\rightarrow$ `ready_for_pickup`: Verified transition by assigned admin.
- `ready_for_pickup` $\rightarrow$ `completed`: Verified completion.
- Subcollection history: Verified 5 sequential status history documents.

### Section 2: Valid Transitions (Online Lifecycle)
- Premature accept rejection: Verified unverified online order cannot be accepted.
- `verifyDemoPayment`: Verified emulator demo payment transitions to `payment_verified`.
- `payment_verified` $\rightarrow$ `accepted` $\rightarrow$ `preparing` $\rightarrow$ `ready_for_pickup` $\rightarrow$ `completed`: Verified full online order flow.

### Section 3: Invalid Transitions & Terminal State Protection
- `placed` $\rightarrow$ `preparing`: Rejected.
- `placed` $\rightarrow$ `completed`: Rejected.
- `completed` $\rightarrow$ `preparing`: Rejected (terminal state protection).
- `completed` $\rightarrow$ `cancelled`: Rejected.

### Section 4: Pickup Capacity Release Hardening Tests (10 Minimum Invariant Scenarios)
1. **Valid cancellation with `reservedCount = 3`**:
   - Order transitions to `cancelled`.
   - `reservedCount` decremented from 3 to 2.
   - Exactly one history event created.
2. **Valid rejection with `reservedCount = 1`**:
   - Order transitions to `rejected`.
   - `reservedCount` decremented from 1 to 0 (non-negative floor preserved).
3. **Invalid slot state with `reservedCount = 0`**:
   - Cancellation rejected with `FAILED_PRECONDITION` / inconsistent state error.
   - Order status unchanged (`placed`).
   - No history event written.
   - Slot `reservedCount` unchanged at 0.
4. **Invalid slot state with `reservedCount = -1`**:
   - Operation rejected.
   - Order status remains `placed`.
   - Slot value unchanged at -1.
5. **Invalid slot state with non-integer `reservedCount = 2.5`**:
   - Operation rejected.
   - Order status remains `placed`.
   - Slot value unchanged at 2.5.
6. **Invalid slot state with `reservedCount > capacity` (7 > 5)**:
   - Operation rejected.
   - Order status remains `placed`.
   - Slot value unchanged at 7.
7. **Repeated cancellation / rejection**:
   - First valid request releases capacity once.
   - Retry returns `isIdempotent: true`.
   - Capacity is not decremented twice.
   - No duplicate history event created.
8. **Concurrent cancellation attempts**:
   - At most one transition succeeds (both resolve safely).
   - Capacity released at most once.
   - Order status is `cancelled` with exactly 1 cancellation history event.
9. **Non-cancellation transitions**:
   - `placed` $\rightarrow$ `accepted` $\rightarrow$ `preparing` leaves slot `reservedCount` unchanged.
10. **Unauthorized cancellation / rejection**:
    - Student B attempting to cancel Student A's order rejected (`PERMISSION_DENIED`).
    - Slot `reservedCount` unchanged.
    - Order status unchanged.

### Section 6: Admin Rejection & Cross-Canteen Isolation
- Admin 1 transitioning Canteen B order: Rejected (`PERMISSION_DENIED`).
- Admin 2 rejecting Canteen B order with audit reason: Allowed (`rejected`).

### Section 7: Replay Idempotency & Deterministic History
- Replaying transition: Returns identical status with `isIdempotent: true`.
- History event count remains unchanged (no duplicate history docs).

### Section 8: Direct Client Write Denial
- Direct client write to `orders/{orderId}`: Rejected (HTTP 403 / permission denied).
- Direct client write to `orders/{orderId}/statusHistory`: Rejected.

### Section 9: Admin Queue Isolation & Filtering
- Admin 1 fetching Canteen A queue: Succeeded; 100% orders belong to Canteen A.
- Admin 1 fetching Canteen B queue: Rejected (`PERMISSION_DENIED`).
- Status filtering: Succeeded; only matching status orders returned.

### Section 10: Exact Search Isolation & Privacy Masking
- Exact search in Canteen A: Succeeded; customer UID masked as `student_...`.
- Exact search cross-canteen: Throws `NOT_FOUND` without leaking order existence.
