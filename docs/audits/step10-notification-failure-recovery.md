# Step 10 — Notification Failure Recovery and Resilience

**Date:** 2026-09-23  
**Status:** Approved & Enforced  

---

## 1. Architectural Strategy: Non-Blocking, Fail-Safe Side Effects

GrabNGo notification delivery follows a strict **fail-closed, state-isolated** architectural pattern. Notification delivery is treated as an asynchronous side effect of a committed business transaction:

```
[Trusted State Transition Commits]
              │
              ▼
   ┌──────────────────────────────────────────────┐
   │ Is transition real & non-duplicate?          │
   └──────────────────────────────────────────────┘
         │ Yes                              │ No
         ▼                                  ▼
[Server-Internal Notification Dispatch]   [Drop / No-Op]
         │
         ├──► Student Notification (idempotent write)
         └──► Admin Fan-Out (canteen-assigned active admins only)
```

### Key Principles
1. **Zero State Pollution:** Notification creation or failure NEVER mutates `orders`, `payments`, `refunds`, or `pickupSlots` documents.
2. **Transaction Separation:** If a source state transition transaction fails or aborts, NO notification is dispatched because notification dispatches execute only in `.then()` handlers after transaction commitment.
3. **Fail-Closed on Collision:** If a notification ID matches an existing record but has a conflicting `type` or `sourceEventId`, the operation throws an error and fails closed rather than overwriting existing records.
4. **Idempotent Ingestion:** If a notification with the identical `sourceEventId` and `type` already exists, the server returns `{ isIdempotent: true }` without performing an update.

---

## 2. Server-Only Outbox & Event Architecture

For background workers or decoupled architectures, the system defines server-only collections:
- `users/{userId}/notificationOutbox/{eventId}`
- `notificationEvents/{eventId}`

### Firestore Security Rules
All direct client access is blocked:
```javascript
match /users/{userId}/notificationOutbox/{eventId} {
  allow read, write: if false;
}

match /notificationEvents/{eventId} {
  allow read, write: if false;
}
```

Clients cannot write to, read from, or inject events into either the outbox or top-level event collections. Only trusted server-side Admin SDK code can interact with these paths.

---

## 3. Failure Scenarios and Recovery Mechanisms

### 3.1 Network Failure During Notification Creation
- **Scenario:** The source transaction (e.g., `createOrder` or `completeDemoPayment`) successfully commits to Firestore, but an ephemeral network error causes `createNotificationInternal` to fail.
- **Handling:** The error is caught and logged at the warning level:
  ```typescript
  .catch((err) => functions.logger.warn('[Step10] notification failed (non-fatal):', err?.message))
  ```
- **Recovery:** Because source event identities are strictly deterministic (e.g., `{paymentId}_succeeded_demo`), any replay (such as an incoming synthetic webhook or user retry) can safely re-trigger notification creation. The server will compute the exact same `notificationId` and write it safely without duplication.

### 3.2 Webhook vs. Callable Concurrency Race
- **Scenario:** The student client calls `completeDemoPayment` while a synthetic webhook (`payment.captured`) arrives simultaneously.
- **Handling:**
  - Both paths derive the identical event identifier: `{paymentId}_succeeded_demo`.
  - Both calculate the exact same notification ID:
    ```
    notif_${SHA256(sourceEventId + '_' + recipientUid + '_' + type).slice(0, 32)}
    ```
  - Whichever transaction commits first writes the record; the second transaction reads the existing document, recognizes matching `sourceEventId` and `type`, and returns `{ isIdempotent: true }`.
  - Exactly one notification document is stored.

### 3.3 Partial Batch Mark-All-Read Recovery
- **Scenario:** A user has 1,200 unread notifications. Firestore batch writes allow a maximum of 500 documents per batch.
- **Handling:**
  - `markAllNotificationsRead` uses a bounded batch:
    ```typescript
    .where('isRead', '==', false).orderBy('createdAt', 'desc').limit(500)
    ```
  - It commits 500 updates and returns:
    ```json
    {
      "success": true,
      "updatedCount": 500,
      "hasMore": true,
      "nextCursor": "notif_..."
    }
    ```
- **Recovery:** The frontend or background scheduler continues the operation using the returned `nextCursor` until `hasMore === false`. If interrupted midway, all previously marked notifications remain `isRead: true`, and the remaining unread count is strictly consistent.

### 3.4 Admin Reassignment / Inactivation
- **Scenario:** An admin assigned to Canteen A is made inactive or their canteen assignment is removed.
- **Handling:**
  - The fan-out query explicitly enforces:
    ```typescript
    db.collection('admins')
      .where('status', '==', 'active')
      .where('canteenIds', 'array-contains', canteenId)
    ```
  - Inactive admins or admins assigned to other canteens are immediately omitted from new notifications.
  - Historical notifications remain accessible in their notification subcollection indefinitely under the indefinite retention policy.

---

## 4. Operational Invariants Verified

| Invariant | Enforcement Mechanism | Failure Mode |
|---|---|---|
| **No client notification forgery** | Server-only `createNotificationInternal` (not exported as HTTP/callable) | Reject / Not Found |
| **No direct Firestore mutation** | `firestore.rules` has `allow read, write: if false` on notifications | 403 Permission Denied |
| **No unbounded writes** | `markAllNotificationsRead` limits batch to 500 docs | Bounded batch, returns cursor |
| **Payment Deduplication** | Identical `${paymentId}_succeeded_demo` for both callable & webhook | Idempotent set, 0 duplicates |
| **Order Transition Deduplication** | `${orderId}_${fromStatus}_to_${toStatus}` source event identity | Same ID, no duplicate |
