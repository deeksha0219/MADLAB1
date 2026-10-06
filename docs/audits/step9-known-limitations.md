# GrabNGo Step 9 Audit — Known Limitations and Production Boundaries

## 1. Local Emulator & Demo Mode Only
- Real payment gateways (e.g. Razorpay, Cashfree, PhonePe PG, Stripe, Paytm PG) are **strictly not configured or enabled**.
- All transactions are simulated with `provider: "demo"`.
- Production billing (Firebase Blaze plan) is **not upgraded**; this implementation operates strictly on the local Firebase Emulator Suite (`demo-grabngo-local`).
- Staging and production projects remain untouched and read-only.

## 2. Webhook Implementation
- The synthetic webhook function `verifySyntheticWebhook` is intended as a local-only testing harness and endpoint.
- In a live production environment:
  - Gateway secret keys must be retrieved from Google Cloud Secret Manager at runtime.
  - Gateway IP whitelisting or provider signature headers (e.g. `X-Razorpay-Signature`) must be enforced.
  - Public TLS terminating endpoints with DDoS protection must be used.

## 3. Refunds
- Demo refunds update internal Firestore records and release pickup capacity only.
- No automated bank transfer, UPI reversal, or gateway API calls are performed.
- Only full refunds are currently supported; partial refunds require subsequent operational policy definitions.

## 4. Hardware and Mobile OS Payments
- Apple Pay, Google Pay native SDKs, and device hardware NFC are not integrated.
- Native mobile flows simulate checkout via `src/screens/PaymentScreen.tsx` using generic demo options (`UPI Demo`, `Demo Wallet Payment`, `Demo Online Payment`).
