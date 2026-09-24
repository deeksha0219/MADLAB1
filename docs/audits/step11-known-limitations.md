# GrabNGo Step 11: Known Limitations and Architectural Boundary

## 1. Emulator-Only Scope
Step 11 was developed and verified strictly within the local Firebase Emulator Suite:
- **Auth Emulator**: `127.0.0.1:9099`
- **Firestore Emulator**: `127.0.0.1:8085`
- **Functions Emulator**: `127.0.0.1:5001`
- Staging and production Firebase projects are completely untouched.
- No Firebase billing upgrade was initiated or required.

---

## 2. In-App Virtual Keyboard Boundaries
- The virtual keyboard is implemented as a React Native component (`TouchKeyboard.tsx`) tailored for touch kiosks and Android touch displays.
- It is not an Android IME or operating system input driver.
- It is bound strictly to order search input and does not intercept system-level typing, passwords, or OTPs.

---

## 3. Demo Payment & Refund Boundaries
- All payment records reflect demo transactions (`succeeded_demo`, `cash`).
- No real banking or payment gateways (Razorpay, Stripe, Paytm, UPI) are integrated.
- Service-desk operators cannot create real monetary refunds or directly modify payment ledger documents.
- Operational status transitions do not mutate financial documents.

---

## 4. Notifications & Push Boundaries
- Real Firebase Cloud Messaging (FCM) or APNs push notifications are NOT implemented in Step 11.
- All notifications are local in-app records stored in Firestore via Step 10 callable-only functions.
