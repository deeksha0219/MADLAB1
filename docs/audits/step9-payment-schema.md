# GrabNGo Step 9 Audit — Payment Schema and Data Models

## 1. Top-Level / Orders Collection Schema Updates
In Step 9, the top-level order document in `/orders/{orderId}` maintains server-authoritative payment tracking fields:
- `paymentStatus`: `"pending" | "processing" | "succeeded_demo" | "failed" | "cancelled" | "expired"`
- `refundStatus`: `"not_requested" | "pending" | "refunded_demo"`
- `paymentMethod`: `"cash" | "upi_demo" | "demo_wallet" | "demo_card"`
- `activePaymentId`: `string | null` (Points to the single currently active payment attempt document)
- `activePaymentExpiresAt`: `Timestamp | null` (Server-derived expiration timestamp)
- `totalInPaise`: `number` (Server-computed safe integer in paise, re-read during all payment and refund validations)
- `status`: `"placed" | "payment_verified" | "accepted" | "preparing" | "ready_for_pickup" | "completed" | "cancelled" | "rejected"` (Never set to `'refunded'`)

## 2. Payments Subcollection: `/orders/{orderId}/payments/{paymentId}`
Each attempt generates an isolated, immutable record created directly in `'processing'`:
```typescript
interface DemoPaymentRecord {
  paymentId: string;              // Cryptographic UUID e.g. "pay_<uuid>"
  orderId: string;                // Parent order ID
  studentUid: string;             // Authenticated student UID
  canteenId: string;              // Canteen ID
  amountInPaise: number;          // Safe integer matching order.totalInPaise exactly
  currency: "INR";
  paymentMethod: "upi_demo" | "demo_wallet" | "demo_card";
  provider: "demo";
  status: "processing" | "succeeded_demo" | "failed" | "cancelled" | "expired";
  refundStatus: "not_requested" | "pending" | "succeeded_demo";
  attemptNumber: number;          // 1-indexed attempt sequence counter
  idempotencyKey: string;         // 1-128 alphanumeric/hyphen/underscore string
  requestFingerprint: string;     // SHA256(orderId:paymentMethod:amountInPaise:currency)
  providerReference: string;      // Cryptographic UUID e.g. "demo_txn_<uuid>"
  refundReference?: string;       // Assigned when refund requested e.g. "demo_ref_<uuid>"
  failureCode?: string | null;    // E.g. "USER_CANCELLED_UPI", "WEBHOOK_PAYMENT_FAILED"
  failureMessage?: string | null; // Sanitized failure description
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;          // Server-derived: createdAt + 15 minutes TTL
  completedAt?: Timestamp | null;
  expiredAt?: Timestamp | null;
  refundedAt?: Timestamp | null;
}
```

## 3. Payment History Subcollection: `/orders/{orderId}/paymentHistory/{eventId}`
Deterministic audit trail of all payment lifecycle transitions:
- Event IDs use deterministic naming: `{paymentId}_{status}` or `{paymentId}_refund_{status}`:
  - `{paymentId}_processing` (Emitted on attempt creation; initial stored status is processing per Correction 4)
  - `{paymentId}_succeeded_demo`
  - `{paymentId}_failed`
  - `{paymentId}_cancelled`
  - `{paymentId}_expired`
  - `{paymentId}_refund_pending`
  - `{paymentId}_refunded_demo`
- Schema:
  ```typescript
  {
    eventId: string;
    paymentId: string;
    orderId: string;
    fromStatus: string;
    toStatus: string;
    actorUid: string;
    actorRole: "student" | "admin" | "system" | "webhook_simulator";
    canteenId: string;
    reason: string;
    createdAt: Timestamp;
  }
  ```

## 4. User Payment Requests Subcollection: `/users/{userId}/paymentRequests/{idempotencyKey}`
Stores deduplication mappings preventing duplicate active attempts and validating request parameter consistency:
- `idempotencyKey`: string
- `requestFingerprint`: string
- `studentUid`: string
- `orderId`: string
- `paymentId`: string
- `paymentMethod`: string
- `amountInPaise`: number
- `currency`: "INR"
- `createdAt`: Timestamp
- `expiresAt`: Timestamp

## 5. Webhook Events Collection: `/webhookEvents/{provider}:{eventId}`
Top-level collection for provider-scoped deduplication of asynchronous webhook events (Correction 5):
- `provider`: "demo"
- `eventId`: string
- `receivedAt`: Timestamp
- `eventType`: "payment.captured" | "payment.failed" | "refund.processed"
- `processingStatus`: "processed"
- `paymentId`: string
- `orderId`: string
- `amountInPaise`: number
- `providerReference`: string
