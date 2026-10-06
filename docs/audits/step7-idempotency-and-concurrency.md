# GrabNGo Step 7 — Idempotency & Concurrency Guarantees

**Report ID:** `step7-idempotency-and-concurrency.md`  
**Execution Date & Time:** September 22, 2026, 11:27 IST  
**Auditor:** Principal Concurrency & Reliability Engineer  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  

---

## 1. Idempotency Architecture

To ensure network retries, connection drops, or accidental double-taps by students never produce duplicate orders or duplicate slot reservations:
1. **Idempotency Key:** Client provides a 36–128 character UUID v4 or random key (`idempotencyKey`).
2. **Deterministic Scoping:** Scoped to the authenticated student under `users/{studentUid}/orderRequests/{idempotencyKey}`.
3. **Collision-Resistant Order ID:** The order ID is derived from:
   $$\text{orderId} = \text{"GNG-"} + \text{SHA256}(\text{studentUid} + \text{":"} + \text{idempotencyKey}).\text{slice}(0, 32).\text{toUpperCase}()$$
   This guarantees that:
   - Different students with identical idempotency keys generate distinct order IDs.
   - The same student with different idempotency keys generates distinct order IDs.
   - 32 hex characters provide 128 bits of collision entropy.
4. **Canonical Payload Hash:** The server computes:
   $$\text{requestHash} = \text{SHA256}(\text{canonicalJson}(\{ \text{canteenId}, \text{sortedItems}, \text{paymentMethod}, \text{pickupSlotId} \}))$$

---

## 2. Concurrency & Replay Test Evidence

Verified live against the local Functions and Firestore Emulators (`npm run test:order:emulator`):

### 2.1 Identical Request Replay
- **Input:** Identical payload submitted with same `idempotencyKey`.
- **Observed Behavior:** Returned existing order record `{ isRetry: true, orderId: "GNG-...", totalInPaise: 16000 }`.
- **Slot Capacity:** `reservedCount` remained at 1 (no duplicate reservation).
- **Result:** **PASS**

### 2.2 Tampered Payload Replay
- **Input:** Same `idempotencyKey` submitted with altered item quantities.
- **Observed Behavior:** Threw `already-exists: "Idempotency key reuse with differing request parameters."`.
- **Result:** **PASS**

### 2.3 Concurrent Duplicate Submissions
- **Input:** Two identical requests fired simultaneously via `Promise.all` using the same `idempotencyKey`.
- **Observed Behavior:** Both promises resolved cleanly, returning the identical order ID. Exactly 1 order document was created in Firestore and `reservedCount` incremented by exactly 1.
- **Result:** **PASS**

### 2.4 Collision Resistance Verification
- Verified all combinations of `userA/userB` and `key1/key2` produce 100% unique order IDs.
- **Result:** **PASS**
