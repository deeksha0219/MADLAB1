# Step 10 — Notification Events Map

**Date:** 2026-09-23

---

## Order Lifecycle → Notification Events

```
createOrder
  ├── student: order_placed
  └── assigned active admins: new_order_for_admin

completeDemoPayment
  ├── student: payment_succeeded_demo
  └── assigned active admins: payment_verified_for_admin

failDemoPayment
  └── student: payment_failed

expirePaymentAttempt
  └── (no notification — expiry ≠ failure)

cancelDemoPayment
  └── (no notification — student-initiated, user already knows)

transitionOrderStatus → {nextStatus}
  └── student: order_{nextStatus} (sourceEventId: {orderId}_{fromStatus}_to_{toStatus})

requestDemoRefund
  └── student: refund_pending_demo (sourceEventId: {paymentId}_refund_pending)

completeDemoRefund
  └── student: refund_completed_demo (sourceEventId: {paymentId}_refunded_demo)

verifySyntheticWebhook[payment.captured]
  ├── student: payment_succeeded_demo (identical sourceEventId: {paymentId}_succeeded_demo)
  └── assigned active admins: payment_verified_for_admin

verifySyntheticWebhook[payment.failed]
  └── student: payment_failed (identical sourceEventId: {paymentId}_failed)

verifySyntheticWebhook[refund.processed]
  └── student: refund_completed_demo (identical sourceEventId: {paymentId}_refunded_demo)
```

---

## Deduplication Across Callable and Webhook Paths

Payment success may be reached by both `completeDemoPayment` and `verifySyntheticWebhook`.
Both paths enforce the **exact same transition event identity**:

```
{paymentId}_succeeded_demo
```

Both calculate the identical notification ID:

```
notif_${SHA256(sourceEventId + '_' + recipientUid + '_' + type).slice(0, 32)}
```

- When `completeDemoPayment` runs first, it writes the notification document.
- When `verifySyntheticWebhook` fires subsequently (or replays), `createNotificationInternal` detects the identical existing document and safely returns `{ isIdempotent: true }`.
- Exactly **one** student notification and **one** admin notification per assigned admin is stored. No duplicates are created.

---

## Non-Events (No Notification)

| Event | Reason |
|---|---|
| `expirePaymentAttempt` | Expiry restores order to `pending` — not a failure visible to user |
| `cancelDemoPayment` | Student-initiated — they already know |
| `getPaymentStatus` | Read-only query |
| `getAdminOrderQueue` | Read-only query |
| `searchAdminOrder` | Read-only query |
| `listMyNotifications` | Read-only |
| `markNotificationRead` | Read-state update only |
| `markAllNotificationsRead` | Read-state update only |
| `getUnreadNotificationCount` | Read-only |
