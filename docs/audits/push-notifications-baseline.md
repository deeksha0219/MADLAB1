# GrabNGo — Push Notifications Baseline & Architectural Design Lock

**Date:** 2026-10-02  
**Auditor / Security Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Baseline Commit:** `3751d6f`  
**Current Verdict:** **LOCAL-READY / CLOUD-BLOCKED**  
**Local Test Baseline:** 834 assertions passed across 12 validation suites  

---

## 1. Executive Summary & Design Invariants

This baseline document formally establishes the architectural boundaries, security model, and invariant locks for adding Firebase Cloud Messaging (FCM) push notifications as an additive delivery channel to the GrabNGo platform.

### Core Architectural Principle:
```
Business Event (e.g. createOrder, completeDemoPayment, transitionOrderStatus)
    ↓ [Same Firestore Transaction]
Server-Created In-App Notification Record + Notification Outbox Entry
    ↓ [Asynchronous Background Outbox Worker]
Durable In-App Record Created / Confirmed (Canonical Source of Truth)
    ↓ [Separate Post-Delivery Channel]
FCM Push Notification (Best-Effort Delivery)
```

### Inviolable Invariant Rules:
1. **In-App Notification is the Sole Source of Truth:** The `/users/{uid}/notifications/{notificationId}` collection is the canonical, permanent, and tamper-proof user notification record.
2. **FCM is Best-Effort Delivery:** Push notification delivery is strictly a best-effort convenience channel. If FCM fails, network drops, or tokens expire, the user’s order and notification history remains 100% complete and intact.
3. **Push Delivery Cannot Authorize Any Operation:** A push notification receipt carries zero authority. All business actions (order updates, payments, pickups) require authenticated callable invocations or verifiable server-side state transitions.
4. **Push Delivery Cannot Change Business State:** A push delivery success, failure, timeout, or retry can NEVER mutate, roll back, delay, or affect orders, payments, refunds, pickup slot capacities, or service-desk queues.
5. **Universal In-App Retrieval:** Even if push delivery fails completely, any user can retrieve their notifications at any time via the authenticated `listMyNotifications` callable API.

---

## 2. Inventory of Existing Notification Producers & Types

| Notification Type | Target Recipient | Recipient Derivation Rule | Source Event ID Pattern | Outbox ID Pattern |
|---|---|---|---|---|
| `order_placed` | Student | Derived from `order.customerUid` | `orderId + '_placed'` | `outbox_${orderId}_placed_student` |
| `new_order_for_admin` | Canteen Admins | Active admins assigned to `order.canteenId` | `orderId + '_placed'` | `outbox_${orderId}_placed_admin` |
| `payment_succeeded_demo` | Student | Derived from `order.customerUid` | `paymentId + '_succeeded_demo'` | `outbox_${paymentId}_succeeded_demo_student` |
| `payment_verified_for_admin`| Canteen Admins | Active admins assigned to `order.canteenId` | `paymentId + '_succeeded_demo'` | `outbox_${paymentId}_succeeded_demo_admin` |
| `order_accepted` | Student | Derived from `order.customerUid` | `orderId + '_' + from + '_to_' + to` | `outbox_${sourceEventId}_student` |
| `order_preparing` | Student | Derived from `order.customerUid` | `orderId + '_' + from + '_to_' + to` | `outbox_${sourceEventId}_student` |
| `order_ready_for_pickup` | Student | Derived from `order.customerUid` | `orderId + '_' + from + '_to_' + to` | `outbox_${sourceEventId}_student` |
| `order_completed` | Student | Derived from `order.customerUid` | `orderId + '_' + from + '_to_' + to` | `outbox_${sourceEventId}_student` |
| `order_cancelled` | Student | Derived from `order.customerUid` | `orderId + '_' + from + '_to_' + to` | `outbox_${sourceEventId}_student` |
| `order_rejected` | Student | Derived from `order.customerUid` | `orderId + '_' + from + '_to_' + to` | `outbox_${sourceEventId}_student` |
| `refund_pending_demo` | Student | Derived from `order.customerUid` | `orderId + '_refund_pending'` | `outbox_${refundSourceEventId}_student` |
| `refund_completed_demo` | Student | Derived from `order.customerUid` | `orderId + '_refund_completed'` | `outbox_${refundSourceEventId}_student` |

---

## 3. Existing Outbox & Idempotency Architecture

1. **Deterministic Notification ID:**
   ```typescript
   notif_{SHA256(sourceEventId + '_' + recipientUid + '_' + type).slice(0, 32)}
   ```
   Repeated delivery attempts with identical `sourceEventId` compute the exact same `notificationId`, preventing duplicate in-app records.
2. **Deterministic Outbox ID:**
   Each transactional event produces a deterministic document in `/notificationOutbox/{outboxId}`. If the business transaction retries due to Firestore contention, the outbox record is overwritten with the same payload or exists idempotently.
3. **Lease & Concurrency Guard:**
   - 30-second atomic lease (`leaseUntil`) acquired via Firestore transaction in `deliverOutboxEvent`.
   - Prevents duplicate concurrent delivery by multiple worker instances.
4. **Bounded Retry & Dead-Letter Policy:**
   - Maximum 5 attempts (`MAX_OUTBOX_ATTEMPTS = 5`).
   - Exponential backoff with jitter: `min(60000, 1000 * 2^attempts + jitter)`.
   - Transitions to `'dead_letter'` status upon reaching max attempts or on malformed schemas.
   - Zero business state mutation if an outbox record transitions to `'dead_letter'`.

---

## 4. Additive FCM Architecture Blueprint

### 4.1 Token Registry Schema
Server-only collection at `/users/{uid}/pushTokens/{tokenId}`:
```typescript
export interface PushTokenDoc {
  tokenId: string;            // SHA-256 hash of token (bounded alphanumeric)
  tokenCiphertext?: string;   // Token representation (never exposed to clients)
  tokenHash: string;          // Hex digest for lookup/validation
  platform: 'android' | 'ios';
  environment: 'local' | 'staging' | 'production';
  appVersion: string;
  enabled: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  lastSeenAt: FirebaseFirestore.Timestamp;
  invalidAt: FirebaseFirestore.Timestamp | null;
}
```

### 4.2 Security Rules (Locked)
```
match /users/{userId}/pushTokens/{tokenId} {
  allow read, write: if false;
}
```
Direct client reads and writes are strictly denied. All token management is brokered through authenticated Cloud Functions callables (`registerPushToken`, `unregisterPushToken`).

### 4.3 Safe Push Payload Schema (Zero Secrets)
Push payloads are strictly data-only or generic presentation messages:
```json
{
  "data": {
    "notificationId": "notif_3a59bc81e2b4...",
    "eventType": "order_ready_for_pickup",
    "orderId": "#B9A23D",
    "screen": "notifications"
  }
}
```
**Strictly Excluded:**
- No payment gateway references, transaction IDs, or synthetic webhook secrets.
- No student PII (phone numbers, full names, emails).
- No cart pricing, line-item totals, discounts, or financial data.
- No raw FCM registration tokens in payloads or logs.

---

## 5. Design Verification & Sign-Off
- **Branch:** `development`
- **Pre-edit commit:** `3751d6f`
- **Worktree:** Clean
- **Confirmed:** No order, payment, refund, or slot transaction depends on push delivery.
