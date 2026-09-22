# GrabNGo Step 8 Audit — Student Order Tracking & Cancellation

## 1. Student Tracking Surface

Students track their placed orders in `OrderHistoryScreen.tsx`:
1. **Status Badges**:
   - `PLACED`: Amber
   - `ACCEPTED`: Indigo
   - `PREPARING`: Purple
   - `READY FOR PICKUP`: Emerald
   - `COMPLETED`: Green
   - `CANCELLED / REJECTED`: Red
2. **Pickup Slot Details**: Date and operational window (`startTime - endTime`).
3. **Cart-Safe Reorder**:
   - Uses `setUserCartItem` directly to re-add items into the user's cart without exposing or manipulating server prices.

---

## 2. Student Cancellation Invariants

### 2.1 Permitted Conditions
Students can cancel an order if and only if all four conditions are met:
1. `auth.uid == order.studentUid` (Caller is order owner).
2. `order.status == 'placed'` (Kitchen has not started or accepted the order).
3. `order.paymentStatus == 'pending'` (No funds have been collected).
4. `currentTime < slot.startTime` in `Asia/Kolkata` (Pickup window has not begun).

### 2.2 Capacity Release
When an eligible student cancels:
- The order status transitions to `cancelled`.
- The pickup slot's `reservedCount` is decremented transactionally:
  $$\text{reservedCount}_{\text{new}} = \max(0, \text{reservedCount}_{\text{old}} - 1)$$
- An audit record is written to `orders/{orderId}/statusHistory`.

### 2.3 Rejection of Ineligible Cancellations
- Cancellation attempted after acceptance $\rightarrow$ `FAILED_PRECONDITION`.
- Cancellation attempted after pickup slot start $\rightarrow$ `FAILED_PRECONDITION`.
- Cancellation attempted on another student's order $\rightarrow$ `PERMISSION_DENIED`.
