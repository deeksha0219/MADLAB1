# GrabNGo Step 7 — Schema & Order Snapshot Specification

**Report ID:** `step7-schema-and-order-snapshot.md`  
**Execution Date & Time:** September 22, 2026, 11:27 IST  
**Auditor:** Principal Backend & Database Architect  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  

---

## 1. Schema Specifications

### 1.1 User-Scoped Cart: `users/{studentUid}/cart/{itemId}`
Stores only minimal, untamperable item intent:
```typescript
interface UserCartItem {
  itemId: string;        // Matches document ID
  canteenId: string;     // Target canteen ID
  quantity: number;      // Strict integer: 1 <= quantity <= 99
  updatedAt: Timestamp;  // Enforced as request.time
}
```
*Design Note: Display properties such as itemName, category, and displayPrice are never persisted in the cart document to eliminate client tampering surfaces.*

### 1.2 Pickup Slot Model: `canteens/{canteenId}/pickupSlots/{slotId}`
Authoritative slot definition managed by canteen admins / seed scripts:
```typescript
interface PickupSlotDocument {
  slotId: string;        // e.g. "SLOT_VALID_TODAY"
  canteenId: string;     // e.g. "CANTEEN_TEST_7"
  date: string;          // Format "YYYY-MM-DD"
  startTime: string;     // Format "HH:mm" (24-hour)
  endTime: string;       // Format "HH:mm" (24-hour)
  timezone: "Asia/Kolkata";
  isOpen: boolean;       // Availability toggle
  capacity: number;      // Maximum concurrent orders (1-500)
  reservedCount: number; // Current reserved orders count
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 1.3 Order Document Schema: `orders/{orderId}`
Server-generated immutable order record:
```typescript
interface OrderDocument {
  orderId: string;              // Deterministic: GNG-<32-char SHA256 hex slice>
  studentUid: string;           // Authenticated student context.auth.uid
  canteenId: string;            // Active canteen ID
  pickupSlot: {
    slotId: string;             // Client-selected slotId
    pickupDate: string;         // Server-derived from slot document
    pickupStartTime: string;    // Server-derived from slot document
    pickupEndTime: string;      // Server-derived from slot document
    timezone: "Asia/Kolkata";   // Server-derived Asia/Kolkata
  };
  itemsSnapshot: Array<{
    itemId: string;
    itemName: string;
    categoryId: string;
    unitPriceInPaise: number;   // Read directly from catalog in paise
    quantity: number;
    lineTotalInPaise: number;   // unitPriceInPaise * quantity
  }>;
  subtotalInPaise: number;      // Non-negative integer paise
  totalInPaise: number;         // Non-negative integer paise
  currency: 'INR';
  status: 'placed';             // Initial server-assigned state
  paymentStatus: 'pending';     // Always 'pending' server-side
  paymentMethod: 'cash' | 'upi_demo'; // Strictly allowlisted
  idempotencyKey: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 1.4 Idempotency Record: `users/{studentUid}/orderRequests/{idempotencyKey}`
```typescript
interface IdempotencyRecord {
  studentUid: string;
  orderId: string;
  requestHash: string;          // SHA256 of canonical payload
  totalInPaise: number;
  status: 'placed';
  createdAt: Timestamp;
}
```

---

## 2. Monetary & Integer Paise Arithmetic

1. **Paise Exclusivity:** All internal and server calculations are integer minor units (paise). Float values (e.g. `12.50`) are rejected at the function boundary.
2. **Deterministic Computation:**
   $$\text{lineTotalInPaise} = \text{unitPriceInPaise} \times \text{quantity}$$
   $$\text{totalInPaise} = \sum \text{lineTotalInPaise}$$
3. **Immutable Price Snapshots:** Later alterations to catalog item prices in `canteens/{canteenId}/items/{itemId}` do not alter existing order snapshots or totals.
