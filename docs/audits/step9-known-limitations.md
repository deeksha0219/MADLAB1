# Step 9 Audit — Known Limitations and Production Readiness

## 1. Demo Mode Only
- Real payment gateways (e.g. Razorpay, Cashfree, Stripe, Paytm PG) are **not configured or enabled**.
- All transactions are simulated with `provider: "demo"`.
- Production billing (Firebase Blaze plan) is **not upgraded**; this implementation operates strictly on the local Firebase Emulator Suite (`demo-grabngo-local`).

## 2. Webhook Implementation
- The synthetic webhook function `verifySyntheticWebhook` is intended as a local-only testing harness and endpoint.
- In production, a secure gateway webhook requires:
  - Gateway secret keys stored in Google Cloud Secret Manager.
  - Gateway IP whitelisting or signature headers (e.g. `X-Razorpay-Signature`).
  - Production TLS terminating endpoints.

## 3. Refunds
- Demo refunds update internal Firestore records and capacity counters only.
- No automated bank or UPI refund payouts are initiated.

## 4. Hardware and Mobile OS Payments
- Apple Pay, Google Pay SDKs, and device hardware NFC are not integrated.
- Native mobile flows simulate checkout via `src/screens/PaymentScreen.tsx` using generic demo options.
