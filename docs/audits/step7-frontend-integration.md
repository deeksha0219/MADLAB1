# GrabNGo Step 7 — Frontend Integration Report

**Report ID:** `step7-frontend-integration.md`  
**Execution Date & Time:** September 22, 2026, 11:27 IST  
**Auditor:** Mobile Frontend Integration Lead  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  

---

## 1. Updated Screens

### 1.1 `CartScreen.tsx`
- **Data Source:** Migrated from global `cart` to private subcollection `users/{studentUid}/cart`.
- **Integrity Checks:** Ensures single-canteen cart consistency.
- **Display Total:** Formatted in INR for student review; clearly treated as non-authoritative client display.
- **Cart-Backed Checkout:** Ensures only items residing in `users/{studentUid}/cart` are submitted for checkout.
- **Intent Passing:** Passes `{ canteenId, items: [{ itemId, quantity }], pickupSlotId }` to `PaymentScreen`.

### 1.2 `PaymentScreen.tsx`
- **Backend Invocation:** Replaced direct Firestore write with `createOrderCallable`.
- **Strict Payload Allowlist:** The client sends strictly 5 fields:
  ```json
  {
    "canteenId": "BIG_MINGOS",
    "items": [{ "itemId": "ITEM_DOSA", "quantity": 2 }],
    "pickupSlotId": "SLOT_DEFAULT",
    "paymentMethod": "cash",
    "idempotencyKey": "..."
  }
  ```
  `pickupTime`, `date`, `time`, prices, totals, or statuses are never included in the payload.
- **Idempotency Key:** Preserved across retries using `useRef<string>(generateUuid())`.
- **Payment Method:** Strictly allowlisted to `cash` or `upi_demo`.
- **Server Cart Clearing:** Client does not attempt manual batch delete; cart clearing is handled transactionally by the Cloud Function.
- **Navigation:** Redirects to `OrderConfirmed` passing confirmed server `orderId`.

### 1.3 `OrderHistoryScreen.tsx`
- **Query Hardening:** Replaced global `orderHistory` with indexed query:
  `firestore().collection('orders').where('studentUid', '==', uid).orderBy('createdAt', 'desc')`
- **Immutable Snapshots:** Renders item details, server-derived pickup time/date, and line totals from the server's immutable `itemsSnapshot` and `pickupSlot`.
- **Display Formatting:** Amounts formatted safely using integer paise division.
