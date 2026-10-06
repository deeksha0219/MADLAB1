# GrabNGo Step 7 — Validation & Regression Results Report

**Report ID:** `step7-validation-results.md`  
**Execution Date & Time:** September 22, 2026, 11:27 IST  
**Auditor:** QA Lead & Verification Engineer  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  

---

## 1. Master Regression Test Matrix

All 7 required verification commands were executed directly against the local codebase and local Firebase Emulator Suite:

| Verification Area | Target Files / Suite | Exact Command | Exit Code | Result | Details |
|---|---|---|---|---|---|
| **Client Typecheck** | `src/**/*.ts`, `src/**/*.tsx` | `npm run typecheck` | `0` | **PASS** | 0 TypeScript errors |
| **Functions Typecheck** | `functions/src/**/*.ts` | `npm --prefix functions run build` | `0` | **PASS** | 0 TypeScript compilation errors |
| **Code Quality & Linting** | Project-wide ESLint | `npm run lint` | `0` | **PASS** | 0 errors (163 non-security UI style warnings deferred) |
| **Jest Unit Tests** | `__tests__/**/*.test.*` | `npm test` | `0` | **PASS** | 10/10 test suites passed; 52/52 tests passed |
| **Rules Emulator** | Firestore Rules on port 8085 | `npm run test:rules:emulator` | `0` | **PASS** | 28/28 assertions passed; 0 failed |
| **Functions Emulator** | Catalog Functions on port 5001 | `npm run test:functions:emulator` | `0` | **PASS** | 54/54 assertions passed; 0 failed |
| **Order & Cart Emulator** | Order, Cart & Slot engine | `npm run test:order:emulator` | `0` | **PASS** | 64/64 assertions passed; 0 failed |

---

## 2. Live Emulator Assertion Summary

- **Firestore Rules Emulator Assertions:** `28`
- **Cloud Functions Catalog Assertions:** `54`
- **Order, Cart & Pickup Slot Assertions:** `64`
- **Total Live Emulator Assertions:** `146`
- **Passed Assertions:** `146` (100% pass rate)
- **Failed Assertions:** `0`

---

## 3. Step 7 Final Corrections Confirmation

1. **Client Payload Permitted Fields:** Verified strictly limited to `canteenId`, `items`, `pickupSlotId`, `paymentMethod`, `idempotencyKey`. Client `pickupTime` strictly removed from `createOrder` payload and rejected if submitted.
2. **Server-Derived Pickup Metadata:** Pickup date, start time, end time, and timezone are 100% server-derived from the official pickup slot document.
3. **Collision-Resistant Order ID:** `SHA256(studentUid:idempotencyKey).slice(0, 32)` derivation verified with 128-bit entropy. Tested across cross-user and cross-key combinations.
4. **Cart-Backed Checkout:** Verified all items must exist in `users/{studentUid}/cart/{itemId}` with exact matching `itemId`, `canteenId`, and `quantity`. Missing items, wrong canteens, mismatched quantities, and cross-user cart access are rejected with `FAILED_PRECONDITION`.
5. **`createPickupSlot` Security:** Verified authentication, active admin authorization, canteen isolation, capacity validation (1-500), time validation (`startTime < endTime`), and operating hours (08:00 - 19:00 IST).
