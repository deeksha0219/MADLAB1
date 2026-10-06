# GrabNGo — Physical-Device Smoke Testing Audit

**Date:** 2026-10-02  
**Auditor / QA Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Commit:** `8dee5bf73ca2d2fa159b34a66a1523e5a59339e8`  
**Host Environment:** Windows 11, Node `v23.9.0`  
**Phase Status:** **BLOCKED — NO PHYSICAL TEST DEVICE ATTACHED / ADB COMMAND UNAVAILABLE ON HOST**  

---

## 1. Physical Device Hardware & Connectivity Verification

| Requirement | Host System Finding | Status |
|---|---|---|
| **Android Debug Bridge (`adb`)** | Command `adb` is not recognized in system PATH | **UNAVAILABLE** |
| **Connected Physical Android Device** | No device enumerated via USB or Wi-Fi (`adb devices` cannot be queried) | **NONE CONNECTED** |
| **Physical iOS Device** | Apple mobile device provisioning requires macOS/Xcode | **UNAVAILABLE** |

### Explicit Blocker Statement:
Physical on-device smoke execution is blocked due to the absence of a connected physical test handset and missing Android platform debug bridge (`adb`) on this host. Per prompt safety gates, simulated or faked physical test results are strictly prohibited.

---

## 2. On-Device Acceptance Matrix (Pre-Configured Test Suite)

When an authorized test device is attached, the following 20-point test matrix is ready for manual and automated validation:

| Test # | Test Scenario | Expected Behavior | Automated Pre-Verification Ref | Status |
|---|---|---|---|---|
| **1** | **Fresh Install** | Clean installation without permission escalation requests | APK manifest clean | **PENDING DEVICE** |
| **2** | **App Launch** | Splash screen loads; initial navigation resolves without crash | `__tests__/App.test.tsx` (PASS) | **PENDING DEVICE** |
| **3** | **Student Login/Registration** | Authenticated via Firebase Auth with synthetic credentials | Auth emulator suite (PASS) | **PENDING DEVICE** |
| **4** | **Session Restoration** | Killing and reopening app restores user context | AsyncStorage session check | **PENDING DEVICE** |
| **5** | **Catalog Browsing** | Active canteens and categories display smoothly | Catalog test suite (PASS) | **PENDING DEVICE** |
| **6** | **Category/Item Filtering** | Filtering items responds instantly | Catalog service tests (PASS) | **PENDING DEVICE** |
| **7** | **Cart Operations** | Add, increment, decrement, and remove items with total calculation | Cart component tests (PASS) | **PENDING DEVICE** |
| **8** | **Checkout Validation** | Validates item quantities and operating hours | `createOrder` validation (PASS) | **PENDING DEVICE** |
| **9** | **Pickup-Slot Selection** | Selects valid operating slot (08:00 - 19:00 IST) | Slot sharding suite (PASS) | **PENDING DEVICE** |
| **10** | **Demo Payment Flow** | Displays disclaimer: *"Demo payment — no real money transferred."* | `test:payment:emulator` (PASS) | **PENDING DEVICE** |
| **11** | **Payment Expiry & Retry** | Expired payment transitions cleanly and allows retry | Payment suite Section 14 (PASS) | **PENDING DEVICE** |
| **12** | **Order History** | Student sees only their own historical orders | Security rules suite (PASS) | **PENDING DEVICE** |
| **13** | **In-App Notifications** | Notification bell updates with order state events | Notifications suite (PASS) | **PENDING DEVICE** |
| **14** | **Logout** | Clears tokens and returns to login screen | Auth foundation test (PASS) | **PENDING DEVICE** |
| **15** | **Unauthorized Navigation** | Student cannot navigate to service-desk or admin routes | `Navigation` guards (PASS) | **PENDING DEVICE** |
| **16** | **Network Drop at Checkout** | Shows friendly error dialog; no duplicate order created | Idempotency key tests (PASS) | **PENDING DEVICE** |
| **17** | **Network Drop at Payment** | Payment status checked on reconnect | Payment transaction guards (PASS) | **PENDING DEVICE** |
| **18** | **Retry on Reconnection** | Resumes or polls server status safely | Order status pollers (PASS) | **PENDING DEVICE** |
| **19** | **Service-Desk Interface** | Operational kiosk displays queue for assigned canteen | Service-desk suite (PASS) | **PENDING DEVICE** |
| **20** | **TouchScreen Keyboard** | On-screen virtual keyboard activates for kiosk mode | `TouchKeyboard.test.tsx` (PASS) | **PENDING DEVICE** |

---

## 3. On-Device Security Assertions (Contract Verification)

The application architecture enforces the following on-device security guarantees:
- **No Provider Secrets:** Zero Razorpay or external API keys are bundled or rendered on any screen.
- **Visible Demo Payment:** The payment screen prominently shows the required notice: **“Demo payment — no real money transferred.”**
- **No Client Elevation:** Navigation state manipulation cannot grant student access to `/admin` or `/service-desk`.
- **Fail-Safe Server Outage:** If Cloud Functions are unreachable, the UI surfaces a descriptive error message without exposing stack traces or crashing.
- **Fail-Closed Environment:** In non-development builds, the app fails closed if `GRABNGO_ENV` is unset or attempts to connect to local loopback addresses.
