# GrabNGo Step 9 Audit — Frontend Integration & Zero Direct Firestore Reads

## 1. UI Label Sanitization (Correction 1)
All references to third-party payment brands (`PhonePe`, `Google Pay`, `Paytm`) were purged from client UI components and replaced with generic simulation labels:
- **`UPI Demo`**: Used for simulated instant UPI payment flow (`paymentMethod: "upi_demo"`, `provider: "demo"`).
- **`Demo Wallet Payment`**: Used for simulated wallet balance deduction (`paymentMethod: "demo_wallet"`, `provider: "demo"`).
- **`Demo Online Payment`**: Used for simulated net banking/card flow (`paymentMethod: "demo_card"`, `provider: "demo"`).

## 2. Removal of Direct Firestore Payment Reads (Correction 10)
- `getOrderPayments` and `getOrderPaymentHistory` have been completely removed from `src/services/paymentService.ts`.
- Direct imports of `@react-native-firebase/firestore` were removed from `src/services/paymentService.ts`.
- All client interactions with the payment subsystem are mediated exclusively through approved callable Cloud Functions:
  - `createDemoPaymentCallable({ orderId, idempotencyKey })`
  - `completeDemoPaymentCallable({ orderId, paymentId })`
  - `failDemoPaymentCallable({ orderId, paymentId, failureCode, failureMessage })`
  - `cancelDemoPaymentCallable({ orderId, paymentId, reason })`
  - `getPaymentStatusCallable({ orderId, paymentId })`
  - `requestDemoRefundCallable({ orderId, paymentId, reason })`
  - `completeDemoRefundCallable({ orderId, paymentId })`

## 3. Student Payment Experience (`src/screens/PaymentScreen.tsx`)
- Displays persistent banner: `⚠️ DEMO MODE: All payments are simulated. No real money or payment accounts are charged.`
- Order summary displays authoritative items and total in Indian paise formatted as rupees (`₹`).
- Client inputs accept only approved options; client-supplied paymentMethod is derived server-side on creation.
- Simulation actions:
  - "Complete Demo Payment" button calls `completeDemoPaymentCallable`.
  - "Simulate Payment Failure" button tests retry flows.
  - "Cancel" button aborts the attempt and returns to order management.
- Once completed, navigates cleanly to `OrderConfirmedScreen` with `paymentStatus: "succeeded_demo"`.

## 4. Order Confirmation & Tracking
- `src/screens/OrderConfirmedScreen.tsx` displays the verified payment method and `Demo Payment Verified` badge.
- `src/screens/OrderHistoryScreen.tsx` reflects the updated status and active payment status without leaking internal gateway tokens or synthetic provider references.
