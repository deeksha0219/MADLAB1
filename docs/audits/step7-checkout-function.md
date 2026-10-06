# GrabNGo Step 7 — Checkout Function & Pricing Engine

**Report ID:** `step7-checkout-function.md`  
**Execution Date & Time:** September 22, 2026, 11:27 IST  
**Auditor:** Senior Serverless Backend Engineer  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  

---

## 1. Cloud Function Interface: `createOrder`

Exported from [`functions/src/index.ts`](file:///e:/Madlab/MADLAB1/functions/src/index.ts).

### 1.1 Permitted Input Fields
The client payload is strictly restricted to 5 allowlisted keys:
```json
{
  "canteenId": "CANTEEN_TEST_7",
  "items": [
    { "itemId": "ITEM_DOSA", "quantity": 2 },
    { "itemId": "ITEM_TEA", "quantity": 1 }
  ],
  "pickupSlotId": "SLOT_VALID_TODAY",
  "paymentMethod": "cash",
  "idempotencyKey": "00000000-0000-0000-0000-000000000020"
}
```

### 1.2 Forbidden Fields (Rejected with `invalid-argument`)
Any request containing client-supplied price, identity, time, or metadata fields is rejected immediately:
- `pickupTime`, `scheduledTime`, `date`, `time` (Client pickup time is strictly forbidden; slot metadata is 100% server-derived)
- `price`, `unitPriceInPaise`, `lineTotalInPaise`, `subtotalInPaise`, `totalInPaise`
- `studentUid`, `role`, `status`, `paymentStatus`
- `createdAt`, `updatedAt`

### 1.3 Order ID Derivation & Entropy
- Order ID format: `GNG-<SHA256(studentUid:idempotencyKey).slice(0, 32)>`
- Uses at least 32 hexadecimal characters (128 bits of collision entropy).
- Prevents collisions across different users with identical keys, and across different keys for the same user.

### 1.4 Cart-Backed Checkout Architecture
Cart-backed checkout requires that:
1. Every submitted item in `items: [{ itemId, quantity }]` must exist in `users/{studentUid}/cart/{itemId}`.
2. The item's `canteenId` in the cart document must match the submitted `canteenId`.
3. The item's `quantity` in the cart document must exactly equal the submitted `quantity`.
4. Any missing cart item, canteen mismatch, or quantity mismatch immediately aborts the transaction with `failed-precondition`.
5. Upon successful checkout, all submitted items are deleted from `users/{studentUid}/cart/{itemId}` in the same atomic transaction.

### 1.5 Execution Flow & Transaction Guarantees
```
[ Incoming HTTPS Callable Request ]
                │
                ▼
1. Authentication: Derive studentUid = context.auth.uid
                │
                ▼
2. Schema Hygiene: Reject unknown fields (strictly allows only canteenId, items, pickupSlotId, paymentMethod, idempotencyKey)
                │
                ▼
3. Input Validation:
   - Validate canteenId regex
   - Validate idempotencyKey regex (36-128 chars)
   - Validate paymentMethod strictly in ('cash', 'upi_demo')
   - Validate items array (1 <= items.length <= 50, unique itemIds, 1 <= quantity <= 99)
                │
                ▼
4. Deterministic Order ID & Canonical Hash:
   - Compute SHA256 requestHash of canonical payload
   - Derive orderId = GNG-<SHA256(studentUid:idempotencyKey).slice(0, 32)>
                │
                ▼
5. Atomic Firestore Transaction (ALL READS FIRST):
   [READ 1] Check users/{studentUid}/orderRequests/{idempotencyKey}
            - If exists & hash matches: Return existing order (idempotent replay)
            - If exists & hash differs: Throw 'already-exists'
   [READ 2] Check canteens/{canteenId} (Must exist & isActive == true)
   [READ 3] Check canteens/{canteenId}/pickupSlots/{pickupSlotId}
            - Validate isOpen == true, operating hours (08:00-19:00 IST), non-past, reservedCount < capacity
   [READ 4] Cart-Backed Checkout Verification:
            - Check users/{studentUid}/cart/{itemId} for every submitted item
            - Verify item exists in cart (reject missing items with 'failed-precondition')
            - Verify cartItem.canteenId == canteenId (reject wrong canteen with 'failed-precondition')
            - Verify cartItem.quantity == item.quantity (reject quantity mismatch with 'failed-precondition')
   [READ 5] Catalog Items Verification & Authoritative Pricing:
            - Check canteens/{canteenId}/items/{itemId}
            - Validate exists, isActive == true, isAvailable == true
            - Extract authoritative priceInPaise and compute line totals in paise
                │
                ▼
6. Atomic Firestore Transaction (ALL WRITES):
   [WRITE 1] transaction.set(orders/{orderId}, newOrderData)
   [WRITE 2] transaction.set(users/{studentUid}/orderRequests/{idempotencyKey}, requestRecord)
   [WRITE 3] transaction.update(pickupSlotRef, { reservedCount: count + 1 })
   [WRITE 4] transaction.delete(cartItemRef) for each ordered item
                │
                ▼
7. Return Sanitized Response
```
