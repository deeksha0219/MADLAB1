# Step 9 Audit — Payment Schema and Data Models

## 1. Top-Level / Orders Collection Schema Updates
In Step 9, the top-level order document in `/orders/{orderId}` maintains server-authoritative payment tracking fields:
- `paymentStatus`: `"pending" | "failed" | "cancelled" | "succeeded_demo" | "demo_verified" | "refund_pending" | "refunded_demo"`
- `paymentMethod`: `"upi_demo" | "demo_wallet" | "demo_card" | "cod"`
- `activePaymentId`: `string | null` (Points to the single currently active payment attempt document)
- `activePaymentExpiresAt`: `Timestamp | null`
- `pricing.total`: server-computed, immutable total re-read during all payment and refund validations

## 2. Payments Subcollection: `/orders/{orderId}/payments/{paymentId}`
Each attempt generates an isolated, immutable record:
```typescript
interface DemoPaymentRecord {
  paymentId: string;              // e.g. "pay_<orderId>_<timestamp>"
  orderId: string;                // Parent order ID
  userId: string;                 // Student UID
  canteenId: string;              // Canteen ID
  amount: number;                 // Matches order.pricing.total exactly
  currency: "INR";
  paymentMethod: "upi_demo" | "demo_wallet" | "demo_card";
  provider: "demo";
  status: "created" | "processing" | "succeeded_demo" | "failed" | "cancelled" | "refund_pending" | "refunded_demo";
  idempotencyKey: string;         // Max 128 characters
  providerReference?: string;     // Synthetic gateway transaction reference
  failureCode?: string;           // E.g. "DEMO_INSUFFICIENT_FUNDS"
  failureMessage?: string;        // Max 200 characters
  refundReason?: string;
  refundedAmount?: number;
  refundedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## 3. Payment History Subcollection: `/orders/{orderId}/paymentHistory/{eventId}`
Deterministic audit trail of all payment lifecycle transitions:
- Event IDs use deterministic naming: `{paymentId}_{status}`:
  - `{paymentId}_created`
  - `{paymentId}_processing`
  - `{paymentId}_succeeded_demo`
  - `{paymentId}_failed`
  - `{paymentId}_cancelled`
  - `{paymentId}_refund_pending`
  - `{paymentId}_refunded_demo`
- Fields:
  ```typescript
  {
    eventId: string;
    paymentId: string;
    orderId: string;
    status: DemoPaymentStatus;
    changedBy: string; // UID or "system"
    timestamp: Timestamp;
    metadata?: Record<string, any>;
  }
  ```

## 4. User Payment Requests Subcollection: `/users/{userId}/paymentRequests/{idempotencyKey}`
Stores deduplication mappings preventing duplicate active attempts:
- `paymentId`: string
- `orderId`: string
- `amount`: number
- `createdAt`: Timestamp
- `expiresAt`: Timestamp
