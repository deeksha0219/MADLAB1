# GrabNGo Step 7 — Pickup Slots & Capacity Management

**Report ID:** `step7-pickup-slots.md`  
**Execution Date & Time:** September 22, 2026, 11:27 IST  
**Auditor:** Backend Systems & Operations Engineer  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  

---

## 1. Pickup Slot Model

1. **Location:** `canteens/{canteenId}/pickupSlots/{slotId}`
2. **Time Zone:** Strictly `Asia/Kolkata` (UTC + 05:30).
3. **Operating Hours:** 08:00 to 19:00 IST. Slots outside these hours are rejected by the server.
4. **Non-Past Validation:** The server reads system time in `Asia/Kolkata`.
   - If slot date is before today: Rejected with `failed-precondition`.
   - If slot date is today and `startTime` is before or equal to current time: Rejected with `failed-precondition`.
5. **Server Derivation:** The client does not supply pickup times or dates. The order document derives:
   - `pickupSlot.slotId`
   - `pickupSlot.pickupDate` (from slot document `date`)
   - `pickupSlot.pickupStartTime` (from slot document `startTime`)
   - `pickupSlot.pickupEndTime` (from slot document `endTime`)
   - `pickupSlot.timezone: "Asia/Kolkata"`

---

## 2. Capacity & Concurrency Strategy

- **Design Selected:** Fixed capacity per slot with atomic transactional reservations (Option B).
- **Reservation Workflow:**
  - `createOrder` reads `slotDoc.reservedCount` and `slotDoc.capacity`.
  - If `reservedCount >= capacity`, transaction aborts with `resource-exhausted: "Pickup slot [ID] is full"`.
  - Otherwise, `reservedCount` is incremented by 1 inside the same transaction that writes the order.
  - Replays of identical `idempotencyKey` do **not** re-increment `reservedCount`.

---

## 3. Administrative Function: `createPickupSlot`

- **Callable Status:** Implemented and exposed as an authenticated HTTPS callable in `functions/src/index.ts`.
- **Security & Authorization Invariants:**
  - Authentication: Requires valid Firebase Auth token (`unauthenticated` on missing auth).
  - Admin Role: Requires active administrator document in `admins/{uid}` (`permission-denied` for students/inactive admins).
  - Canteen Isolation: Enforces `adminDoc.canteenIds.includes(canteenId)` (`permission-denied` for cross-canteen admins).
  - Capacity Validation: Rejects non-integers, negative numbers, zero, or numbers > 500 with `invalid-argument`.
  - Time Validation: Enforces `startTime < endTime` and boundary operating hours (08:00 to 19:00 IST) with `invalid-argument`.
- **Test Evidence:** Fully verified across 8 automated tests in `npm run test:order:emulator`.
