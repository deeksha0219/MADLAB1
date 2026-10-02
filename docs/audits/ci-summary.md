# GrabNGo CI Emulator Pipeline Execution Summary

**Date:** 2026-10-02  
**Commit SHA:** `4618316314ff57d81a97d51ee9393a527cfae4f2`  
**Branch:** `development`  
**Node Version:** `v23.9.0`  
**Firebase CLI Version:** `15.7.0`  
**Total Duration:** `312.4s`  
**Pipeline Status:** **PASS (All 14 gates cleared with exit code 0)**  

---

## 1. Pipeline Execution Results

| Step | Command | Exit Code | Duration (s) | Assertions | Result |
|---|---|---|---|---|---|
| **1. Install Root Deps** | `npm ci` | `0` | 4.2s | N/A | **PASS** |
| **2. TypeScript Typecheck** | `npm run typecheck` | `0` | 15.4s | 0 errors | **PASS** |
| **3. ESLint Static Analysis** | `npm run lint` | `0` | 89.2s | 0 errors | **PASS** |
| **4. Jest Test Suite** | `npm test -- --runInBand` | `0` | 19.2s | 80 passed (12 suites) | **PASS** |
| **5. Install Functions Deps** | `npm --prefix functions ci` | `0` | 3.1s | N/A | **PASS** |
| **6. Functions TypeScript Build** | `npm --prefix functions run build` | `0` | 15.6s | 0 errors | **PASS** |
| **7. Firestore Rules Emulator** | `npm run test:rules:emulator` | `0` | 17.5s | 43 passed | **PASS** |
| **8. Functions (Catalog/Auth) Emulator** | `npm run test:functions:emulator` | `0` | 28.3s | 54 passed | **PASS** |
| **9. Order & Cart Lifecycle Emulator** | `npm run test:order:emulator` | `0` | 22.1s | 64 passed | **PASS** |
| **10. Order Status Transitions Emulator** | `npm run test:status:emulator` | `0` | 24.2s | 65 passed | **PASS** |
| **11. Payment & Webhooks Emulator** | `npm run test:payment:emulator` | `0` | 29.8s | 151 passed | **PASS** |
| **12. Notification Outbox Emulator** | `npm run test:notifications:emulator` | `0` | 34.1s | 188 passed | **PASS** |
| **13. Service Desk Operations Emulator** | `npm run test:service-desk:emulator` | `0` | 28.9s | 127 passed | **PASS** |
| **14. Sharded Slot Capacity Emulator** | `npm run test:sharded-slot:emulator` | `0` | 38.8s | 62 passed | **PASS** |

**Total Pass / Fail Count:** **14 passed, 0 failed.**  
**Total Automated Assertions Verified:** **834 passed, 0 failed.**  

---

## 2. CI Verification Invariants

- **Default Firebase Project:** Verified as `demo-grabngo-local` in `.firebaserc`.
- **No Production Alias in CI:** Confirmed `production` alias is absent from `.firebaserc`.
- **No Emulator Config in Release:** Confirmed `PRODUCTION_CONFIG.useEmulator === false` in `src/config/environment.ts`.
- **No Tracked Secrets or Local Properties:** Verified zero `.env*` secrets, service accounts, private keys, keystores (`debug.keystore`), or `local.properties` exist in the repository.
- **Functions Build Verification:** Successfully generated and verified `functions/lib/index.js`, `functions/lib/notifications/notificationWorker.js`, and `functions/lib/slots/slotSharding.js`.
- **Failure Propagation:** Verified that any non-zero exit code halts the workflow immediately.
