# GrabNGo Step 9 Audit: Razorpay-Readiness Foundation & Provider Abstraction

## 1. Context & Objectives
While Step 9 executes strictly in local Firebase Emulator mode (`demo-grabngo-local`) without calling Razorpay or using real API credentials, the architecture was intentionally designed to provide a drop-in foundation for a future Razorpay staging integration.

## 2. Provider-Neutral Architecture (`functions/src/payments/types.ts`)
A clean adapter interface (`PaymentProviderAdapter`) abstracts payment gateway operations:
```typescript
export interface PaymentProviderAdapter {
  createPaymentAttempt(order: OrderDocument, attemptNumber: number): Promise<PaymentAttemptResult>;
  verifyPaymentSignature(params: VerifySignatureParams): Promise<boolean>;
  verifyWebhookEvent(rawBody: string | Buffer, signature: string): Promise<WebhookVerificationResult>;
  initiateRefund(params: InitiateRefundParams): Promise<RefundResult>;
}
```
In Step 9:
- `DemoPaymentProvider` implements this interface using local synthetic secrets, deterministic mock transaction references (`demo_txn_<uuid>`), and local HMAC-SHA256 verification.
- For a future Razorpay staging integration, a `RazorpayProvider` adapter will implement the identical contract:
  - `createPaymentAttempt`: calls `razorpay.orders.create({ amount: order.totalInPaise, currency: 'INR', receipt: orderId })`.
  - `verifyPaymentSignature`: verifies `razorpay_order_id|razorpay_payment_id` against `razorpay_signature` using HMAC-SHA256 with key secret.
  - `verifyWebhookEvent`: verifies raw request body with Razorpay webhook secret.
  - `initiateRefund`: calls `razorpay.payments.refund(paymentId, { amount: amountInPaise })`.

## 3. Security Alignments with Razorpay Standards
1. **Paise Precision**: All monetary fields throughout the application (`unitPriceInPaise`, `totalInPaise`, `amountInPaise`, `refundedAmountInPaise`) use 64-bit safe integers in Indian paise, matching Razorpay's native currency representation.
2. **Raw Body Webhook Verification**: The `verifySyntheticWebhook` endpoint receives raw, unparsed request bodies to compute HMAC signatures byte-for-byte, precisely mirroring the requirement for Razorpay webhook signature verification.
3. **Idempotency & Replay Protection**:
   - Outbound payment creation is deduplicated via `users/{userId}/paymentRequests/{idempotencyKey}`.
   - Inbound webhook processing is deduplicated via `/webhookEvents/{provider}:{eventId}` before any mutation is applied.
4. **State Machine Mapping**:
   - `created` / `processing` -> Razorpay `order.created` / client checkout opened.
   - `succeeded_demo` -> Razorpay `payment.captured`.
   - `failed` -> Razorpay `payment.failed`.
   - `refunded_demo` -> Razorpay `refund.processed`.

## 4. Operational Boundaries
- No Razorpay API keys or secrets exist in the repository or local configuration.
- No network requests are made to external payment gateway endpoints.
- Transitioning to staging will require only supplying staging credentials via Firebase Secrets Manager and switching the active adapter.
