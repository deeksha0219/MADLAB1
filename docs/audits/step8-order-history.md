# GrabNGo Step 8 Audit — Order History & Query Consistency

## 1. Index/Query Mismatch Correction

### 1.1 The Issue
In Step 7, composite indexes were declared on top-level `pickupSlotId`, but the order document schema stored the slot details in a nested object: `pickupSlot.slotId`. Any query or index targeting `pickupSlotId` would either fail to match or require indexing a non-existent field.

### 1.2 Resolution
1. **Document Schema Update (`createOrder`)**:
   Added a documented top-level `pickupSlotId: pickupSlotId` in the order document while preserving the full snapshot in `pickupSlot`.
2. **Composite Indexes (`firestore.indexes.json`)**:
   ```json
   {
     "collectionGroup": "orders",
     "queryScope": "COLLECTION",
     "fields": [
       { "fieldPath": "canteenId", "order": "ASCENDING" },
       { "fieldPath": "pickupSlotId", "order": "ASCENDING" },
       { "fieldPath": "createdAt", "order": "DESCENDING" }
     ]
   },
   {
     "collectionGroup": "orders",
     "queryScope": "COLLECTION",
     "fields": [
       { "fieldPath": "canteenId", "order": "ASCENDING" },
       { "fieldPath": "status", "order": "ASCENDING" },
       { "fieldPath": "createdAt", "order": "DESCENDING" }
     ]
   }
   ```
3. **Student History Query (`getStudentOrderHistory`)**:
   Queries `orders` where `studentUid == authUid` ordered by `createdAt desc`. Matches index on `studentUid ASC, createdAt DESC`.

---

## 2. Status History Subcollection Schema

Each transition writes a document to `orders/{orderId}/statusHistory/{eventId}`:
```typescript
interface OrderStatusHistoryDocument {
  eventId: string;
  orderId: string;
  fromStatus: string;
  toStatus: string;
  actorUid: string;
  actorRole: 'student' | 'canteen_admin' | 'system';
  canteenId: string;
  reason?: string;
  createdAt: FieldValue.serverTimestamp();
}
```

Deterministic Document Keys:
- Order Placement: `${orderId}_initial_placed`
- Status Transitions: `${orderId}_${fromStatus}_to_${toStatus}`

---

## 3. Atomic Consistency and Rollback Guarantees

In Step 8 Capacity Release Hardening:
1. **Atomic Write Commitment**: The order status update, pickup slot capacity decrement, and status history document creation are committed inside a single atomic Firestore transaction.
2. **Strict Invariant Guard**: If the pickup slot capacity check fails (e.g., `reservedCount < 1`, `reservedCount > capacity`, or non-integer count), the transaction aborts before any write occurs. No status history document is created.
3. **Idempotent Retries**: If an identical transition request is repeated, the server recognizes that the order already has `status == nextStatus`, returning `{ success: true, isIdempotent: true }` without writing a duplicate status history document or decrementing capacity a second time.
