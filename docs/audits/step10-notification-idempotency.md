# Step 10 — Notification Idempotency

**Date:** 2026-09-23

---

## ID Scheme

```
notificationId = 'notif_' + SHA256(sourceEventId + '_' + recipientUid + '_' + type).slice(0, 32)
```

This ID is deterministic — same inputs always produce the same ID.

---

## Idempotency Algorithm (createNotificationInternal)

1. Compute `notificationId` from source inputs
2. Read the notification document at `users/{recipientUid}/notifications/{notificationId}`
3. **If existing document matches** (`type === input.type && sourceEventId === input.sourceEventId`):
   - Return `{ notificationId, isIdempotent: true }` — no write
4. **If existing document conflicts** (same ID, different type or sourceEventId):
   - Throw `Error(...)` — **fail closed** — no overwrite
5. **If not found**:
   - Write new notification document — return `{ notificationId, isIdempotent: false }`

---

## Source Event ID Design

| Lifecycle Function | sourceEventId |
|---|---|
| `createOrder` | `{orderId}_placed` |
| `completeDemoPayment` | `{paymentId}_succeeded_demo` |
| `failDemoPayment` | `{paymentId}_failed` |
| `requestDemoRefund` | `{paymentId}_refund_pending` |
| `completeDemoRefund` | `{paymentId}_refunded_demo` |
| `transitionOrderStatus` | `{orderId}_{fromStatus}_to_{toStatus}` |
| `verifySyntheticWebhook[payment.captured]` | `{paymentId}_succeeded_demo` (identical to `completeDemoPayment`) |
| `verifySyntheticWebhook[payment.failed]` | `{paymentId}_failed` (identical to `failDemoPayment`) |
| `verifySyntheticWebhook[refund.processed]` | `{paymentId}_refunded_demo` (identical to `completeDemoRefund`) |

Admin fan-out adds `_admin_{adminUid}` suffix to the sourceEventId so each admin gets their own deterministic ID.

---

## Failure Modes

| Scenario | Behavior |
|---|---|
| Notification write fails after transaction commits | Notification is silently missed; order/payment state is correct. Future retry would succeed idempotently. |
| Same source event delivered twice | Second call returns `isIdempotent: true`; no duplicate written |
| ID collision with different type | `Error` thrown; fails closed; no silent overwrite |
| Notification service unreachable | `catch()` logged as warning; function returns success to caller |

---

## Safety Property

> Notification creation never modifies `orders`, `payments`, `statusHistory`, `paymentHistory`, `slots`, or `cart` collections.

This property is enforced by code inspection: `createNotificationInternal` only writes to `users/{uid}/notifications/{id}`.
