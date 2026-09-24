# Step 10 — Notification Threat Model

**Date:** 2026-09-23  
**Architecture:** Firebase-first, emulator-only  
**Classification:** LOCAL EMULATOR / PRE-PRODUCTION

---

## 1. Trust Boundaries

| Boundary | Trusted | Untrusted |
|---|---|---|
| Cloud Functions (Admin SDK) | ✅ Full trust — write notifications | — |
| Authenticated mobile client | ✅ Read own notifications via callables | ❌ Direct Firestore write |
| Anonymous client (no auth) | — | ❌ All notification operations denied |
| Admin SDK (server) | ✅ Fan-out, create, delete | — |

---

## 2. Threat Enumeration

### T1 — Unauthorized Notification Injection
**Attack:** Client writes fake notification directly to Firestore.  
**Mitigation:** `allow write: if false` in firestore.rules for `notifications/{notificationId}`. Test 2.1 confirms.

### T2 — Cross-User Read (Horizontal Privilege Escalation)
**Attack:** Student B reads Student A's notifications by guessing the document ID.  
**Mitigation:** Path is `users/{userId}/notifications` — Firestore scopes by `userId`. `isOwner()` check additionally enforced in read rule. Test 11.2 confirms.

### T3 — Admin Cross-Canteen Fan-Out
**Attack:** Admin receives notifications for canteens they are not assigned to.  
**Mitigation:** `notifyAssignedCanteenAdmins` queries `where('canteenIds', 'array-contains', canteenId)` and `where('status', '==', 'active')`. Inactive admins and unassigned admins are excluded. Test 4.9, 11.3, 11.4 confirm.

### T4 — Notification ID Collision / Replay
**Attack:** Replaying the same source event creates a duplicate notification (double-notification spam).  
**Mitigation:** Deterministic ID = `SHA256(sourceEventId + '_' + recipientUid + '_' + type).slice(0,32)`. Idempotent check on `type` and `sourceEventId` — if match, return existing. If collision with different type: fail closed. Test 10.6 confirms idempotency.

### T5 — Client Supplies Arbitrary notificationId
**Attack:** Client constructs a fake notificationId to read/write another user's notification.  
**Mitigation:** Path is scoped by `context.auth.uid` in all callables. `markNotificationRead` additionally verifies `notifData.recipientUid === recipientUid`. Test 11.2 confirms.

### T6 — Sensitive Data Leakage
**Attack:** Notification body contains `providerReference`, HMAC secrets, refundReference, or raw webhook body.  
**Mitigation:** `buildTemplate()` generates static strings from server-owned templates; no payment internals are passed to template function. Test 12.1 confirms.

### T7 — State Mutation via Notification Path
**Attack:** Exploiting notification creation to modify order/payment/refund state.  
**Mitigation:** `createNotificationInternal` only writes to `users/{uid}/notifications/{id}`. It does not touch `orders`, `payments`, `statusHistory`, `paymentHistory`, `slots`, or `cart`. Test 4.11 verifies.

### T8 — Input Injection / Unknown Fields
**Attack:** Client supplies extra fields to notification callables to probe internal state or cause unexpected behavior.  
**Mitigation:** `rejectUnknownFields()` applied to all 4 notification callables. Test 3.1–3.10 confirm.

### T9 — Expiry Notification Confusion
**Attack:** An expired payment triggers a `payment_failed` notification, causing student confusion.  
**Mitigation:** `expirePaymentAttempt` does NOT call any notification creation path. Test 8.4 confirms.

### T10 — Notification Batch Overflow
**Attack:** `markAllNotificationsRead` batch > 500 writes causes transaction failure.  
**Mitigation:** Documented limitation — a single user is unlikely to exceed 500 unread notifications under normal app usage. For production, a paginated batch approach would be required.

---

## 3. Residual Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Notification fan-out is best-effort (fire-and-forget) | Low | Order/payment state is the source of truth; notifications are informational only |
| Poll interval (30s) not real-time | Low | Users see notifications within 30s or on screen focus |
| Batch >500 for markAll | Very Low | Practical limit under demo usage |

---

## 4. Out-of-Scope (by Design)

- Firebase Cloud Messaging
- Push notification tokens
- Background delivery
- APNs / Android notification channels
- Real Razorpay webhook notifications
