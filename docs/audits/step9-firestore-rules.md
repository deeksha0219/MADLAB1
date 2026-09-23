# Step 9 Audit — Firestore Security Rules for Payments

## 1. Rules Overview
Firestore security rules in `firestore.rules` protect all payment-related paths, enforcing the invariant that all payment writes must pass through Cloud Functions and direct client modifications are rejected.

## 2. Protected Collections and Rules
```javascript
// User payment request dedup mapping
match /paymentRequests/{idempotencyKey} {
  allow read: if isOwner(userId);
  allow write: if false; // Only Cloud Functions via Admin SDK
}

// Payment attempt documents under order
match /payments/{paymentId} {
  allow read: if isAuthenticated() && (
    resource.data.userId == request.auth.uid ||
    (isAdmin() && isAssignedAdmin(resource.data.canteenId))
  );
  allow write: if false; // Direct client write denied
}

// Deterministic payment history event documents
match /paymentHistory/{eventId} {
  allow read: if isAuthenticated() && (
    get(/databases/$(database)/documents/orders/$(orderId)).data.studentUid == request.auth.uid ||
    (isAdmin() && isAssignedAdmin(get(/databases/$(database)/documents/orders/$(orderId)).data.canteenId))
  );
  allow write: if false; // Append-only by Cloud Functions
}

// Synthetic webhook idempotency logs
match /webhookEvents/{eventId} {
  allow read, write: if false; // Server-only collection
}
```

## 3. Defense-in-Depth
- Direct client writes to `/orders/{orderId}/payments/{paymentId}`: **DENIED**.
- Direct client writes to `/orders/{orderId}/paymentHistory/{eventId}`: **DENIED**.
- Direct client writes to `/users/{userId}/paymentRequests/{idempotencyKey}`: **DENIED**.
- Direct client writes or reads to `/webhookEvents/{eventId}`: **DENIED**.
- Cross-student reads: **DENIED** (only student owner or assigned admin can read payment subcollection documents).
