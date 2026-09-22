# GrabNGo Step 7 — Security & Authorization Tests Report

**Report ID:** `step7-security-tests.md`  
**Execution Date & Time:** September 22, 2026, 11:27 IST  
**Auditor:** Principal Penetration Tester & Security Auditor  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  

---

## 1. Security Test Assertions & Execution Results

Command executed:
```bash
npm run test:order:emulator
# Underlying: npx firebase-tools emulators:exec --only auth,firestore,functions --project demo-grabngo-local "node scripts/run-emulator-order-test.js"
```

### 1.1 Authentication & Authorization Tests
- `UNAUTHENTICATED` caller rejected from `createOrder`: **PASS (UNAUTHENTICATED)**
- Student A accessing Student B's cart: **DENIED (Rules & Functions)**
- Student A reading Student B's orders: **DENIED (Rules)**
- Direct client writes to `orders`: **DENIED (Rules)**

### 1.2 Cart-Backed Checkout Validation Tests
- Missing cart item (item not in student's cart): **PASS (FAILED_PRECONDITION)**
- Mismatched item quantity (cart quantity !== requested quantity): **PASS (FAILED_PRECONDITION)**
- Wrong canteen item (cart item belongs to different canteen): **PASS (FAILED_PRECONDITION)**
- Cross-user cart access (Student A ordering item present only in Student B's cart): **PASS (FAILED_PRECONDITION)**
- Transactional cart item deletion upon order creation: **PASS**

### 1.3 Order ID Collision Resistance Tests
- Order ID format verification (`GNG-` prefix + 32-character SHA-256 slice = 36 chars): **PASS**
- Different users with same idempotency key produce different order IDs: **PASS**
- Same user with different idempotency keys produces different order IDs: **PASS**
- All cross-user and cross-key combinations produce unique order IDs: **PASS**

### 1.4 Input Sanitization & Forbidden Fields Tests
- Client-supplied `price` field rejected: **PASS (INVALID_ARGUMENT)**
- Client-supplied `status` field rejected: **PASS (INVALID_ARGUMENT)**
- Client-supplied `studentUid` field rejected: **PASS (INVALID_ARGUMENT)**
- Client-supplied `pickupTime` field rejected: **PASS (INVALID_ARGUMENT)**
- Negative quantity rejected: **PASS (INVALID_ARGUMENT)**
- Zero quantity rejected: **PASS (INVALID_ARGUMENT)**
- Decimal float quantity rejected: **PASS (INVALID_ARGUMENT)**
- Quantity above 99 rejected: **PASS (INVALID_ARGUMENT)**
- Out of stock item rejected: **PASS (FAILED_PRECONDITION)**
- Non-existent item rejected: **PASS (NOT_FOUND)**
- Live payment methods (`razorpay`, `card`, etc.) rejected: **PASS (INVALID_ARGUMENT)**

### 1.5 Pickup Slot Validation & Server Derivation
- Non-existent pickup slot rejected: **PASS (NOT_FOUND)**
- Past pickup slot rejected: **PASS (FAILED_PRECONDITION)**
- Full slot capacity overflow rejected: **PASS (RESOURCE_EXHAUSTED)**
- Server derivation of official pickup date, start time, end time, timezone: **PASS**

### 1.6 Idempotency, Concurrency & Snapshot Immutability
- Exact replay returns identical order ID with `isRetry: true`: **PASS**
- Replay does not duplicate slot capacity count: **PASS**
- Replay with tampered payload rejected: **PASS (ALREADY_EXISTS)**
- Concurrent duplicate calls create exactly 1 order: **PASS**
- Modifying catalog price does not alter historical order snapshot: **PASS**

### 1.7 `createPickupSlot` Security & Validation Tests
- Unauthenticated caller rejected: **PASS (UNAUTHENTICATED)**
- Student caller rejected: **PASS (PERMISSION_DENIED)**
- Cross-canteen admin rejected (canteen isolation): **PASS (PERMISSION_DENIED)**
- Negative / invalid capacity rejected: **PASS (INVALID_ARGUMENT)**
- Invalid time (`startTime >= endTime`) rejected: **PASS (INVALID_ARGUMENT)**
- Outside operating hours (`06:00 < 08:00 IST`) rejected: **PASS (INVALID_ARGUMENT)**
- Authorized admin slot creation succeeded and verified in Firestore: **PASS**

---

## 2. Test Execution Summary

**Total Test Assertions:** `64` | **Passed:** `64` | **Failed:** `0` (100% Pass Rate)
