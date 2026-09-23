# Step 9 Audit — Webhook Design & Synthetic Verification

## 1. Raw-Body Signature Verification Architecture
Per requirement 2, Firebase callable functions automatically parse incoming JSON payloads into JavaScript objects, discarding raw bytes and rendering cryptographic HMAC verification insecure or corrupted.
Therefore, `verifySyntheticWebhook` is implemented as an HTTP Function (`functions.https.onRequest`) using `req.rawBody`:
```typescript
const computedSignature = crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');

const sigBuffer = Buffer.from(signature, 'utf8');
const computedBuffer = Buffer.from(computedSignature, 'utf8');

if (sigBuffer.length !== computedBuffer.length || !crypto.timingSafeEqual(sigBuffer, computedBuffer)) {
  res.status(401).json({ error: 'Invalid webhook signature' });
  return;
}
```

## 2. Timing-Attack Protection
The signature comparison utilizes Node.js's native `crypto.timingSafeEqual` over fixed-length UTF-8 buffers, preventing timing side-channel attacks during signature validation.

## 3. Webhook Replay Protection & Deduplication
- Processed webhook event IDs are registered in `/webhookEvents/{eventId}` inside a Firestore transaction.
- If an event ID has already been recorded, the handler immediately returns `{ success: true, duplicate: true }` with status 200 without executing side-effects.

## 4. Payload Validations
The webhook payload verifies:
- `event`: e.g. `"payment.captured"`
- `eventId`: Unique synthetic event ID
- `data.orderId`: Corresponds to a real order in `/orders/{orderId}`
- `data.paymentId`: Corresponds to a payment attempt in `/orders/{orderId}/payments/{paymentId}`
- `data.amount`: Compared strictly against the server's authoritative `order.pricing.total`. If amount differs, the webhook is rejected with status 400.
- State transitions adhere to the standard payment state machine and deterministic event logging.
