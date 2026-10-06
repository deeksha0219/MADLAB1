# GrabNGo Step 9 Audit — Firestore Security Rules for Payments

## 1. Rules Overview
Firestore security rules in `firestore.rules` protect all payment-related paths, enforcing the invariant that all payment writes and direct payment reads must pass through trusted Cloud Functions (`getPaymentStatus`, `createDemoPayment`, etc.). Direct client access from mobile devices is strictly denied.

## 2. Protected Collections and Strict Rules
```javascript
// User payment request dedup mapping (users/{userId}/paymentRequests/{idempotencyKey})
match /paymentRequests/{idempotencyKey} {
  allow read, write: if false; // Server-only via Cloud Functions
}

// Payment attempt documents under order (orders/{orderId}/payments/{paymentId})
match /payments/{paymentId} {
  allow read, write: if false; // Cloud Functions only (getPaymentStatus)
}

// Deterministic payment history event documents (orders/{orderId}/paymentHistory/{eventId})
match /paymentHistory/{eventId} {
  allow read, write: if false; // Cloud Functions only
}

// Synthetic webhook idempotency logs (orders/{orderId}/webhookEvents/{eventId})
match /webhookEvents/{eventId} {
  allow read, write: if false; // Server-only
}

// Webhook events top-level deduplication collection (webhookEvents/{document=**})
match /webhookEvents/{document=**} {
  allow read, write: if false; // Cloud Functions only
}
```

## 3. Defense-in-Depth & Verified Denials
- Direct client reads to `/orders/{orderId}/payments/{paymentId}`: **DENIED**.
- Direct client writes to `/orders/{orderId}/payments/{paymentId}`: **DENIED**.
- Direct client reads to `/orders/{orderId}/paymentHistory/{eventId}`: **DENIED**.
- Direct client writes to `/orders/{orderId}/paymentHistory/{eventId}`: **DENIED**.
- Direct client reads/writes to `/users/{userId}/paymentRequests/{idempotencyKey}`: **DENIED**.
- Direct client reads/writes to `/webhookEvents/{document=**}`: **DENIED**.

## 4. Frontend Enforcement (Correction 10)
- All direct Firestore payment queries (`getOrderPayments`, `getOrderPaymentHistory`) and direct Firestore imports were purged from `src/services/paymentService.ts`.
- Zero direct payment queries exist anywhere in `src/`. All client interaction is mediated strictly by approved callable Cloud Functions.
