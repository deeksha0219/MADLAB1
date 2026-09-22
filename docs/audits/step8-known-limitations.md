# GrabNGo Step 8 Audit — Known Limitations and Deferred Scope

## 1. Pickup Capacity Hardening Status

1. **Explicit Invariant Enforcement**:
   - The previous silent clamping behavior `max(0, reservedCount - 1)` has been completely removed.
   - Any inconsistent slot state (`reservedCount < 1`, `reservedCount > capacity`, missing fields, or non-integers) triggers an explicit `failed-precondition: Pickup slot capacity state is inconsistent.` error and aborts the transaction.
   - Transactions guarantee that neither the order status nor status history is modified if capacity release invariants fail.

---

## 2. Deferred to Step 9 (Live Payment Gateway Integration)

1. **Live Payment Providers**:
   - Integration with external payment gateways (Razorpay, PhonePe, UPI) is strictly deferred to Step 9.
   - `verifyDemoPayment` is an emulator-only simulation helper guarded by `FUNCTIONS_EMULATOR === 'true'`. It must never be deployed or used with real payment credentials.
2. **Webhook Signature Verification**:
   - Asynchronous payment notification webhooks with cryptographic HMAC signatures will be implemented in Step 9.
3. **Automated Refunds**:
   - Online payments currently do not trigger automated payment gateway refunds upon cancellation or rejection.

---

## 3. Infrastructure & Environment Boundaries Preserved

1. **Spark Free Tier / Local Emulator Only**:
   - Cloud Functions require the Blaze plan for deployment to staging or production.
   - Staging project `mad-lab-a9665` remains read-only with Step 4 rules only.
   - No Cloud Functions or Step 8 rules have been deployed to staging or production.
2. **Billing Unchanged**:
   - Firebase billing was not upgraded.
3. **Legacy Prototype Collections**:
   - Collections `cart`, `menu`, and `orderHistory` remain untouched. Zero data migrations have been performed.
4. **Pickup Window Expiration**:
   - Scheduled auto-cancellation of uncollected orders after pickup slot expiration will require a background cron/scheduler (to be integrated alongside notification triggers).
