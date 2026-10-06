# Step 10 — Notification Schema

**Date:** 2026-09-23

---

## Firestore Path

```
users/{recipientUid}/notifications/{notificationId}
```

---

## Document Schema

| Field | Type | Description |
|---|---|---|
| `notificationId` | `string` | Deterministic: `notif_{SHA256(sourceEventId + '_' + recipientUid + '_' + type).slice(0,32)}` |
| `recipientUid` | `string` | Firebase Auth UID of the recipient. Never derived from client payload. |
| `recipientRole` | `'student' \| 'admin'` | Role of recipient: `'student'` or `'admin'`. Server-derived. |
| `type` | `NotificationType` | See canonical type list below. |
| `title` | `string` | Server-generated display title. Never client-supplied. |
| `body` | `string` | Server-generated display body. Never client-supplied. |
| `isRead` | `boolean` | Initial: `false`. Only updated by `markNotificationRead` / `markAllNotificationsRead`. |
| `orderId` | `string` | The related order ID for navigation / correlation. |
| `sourceEventId` | `string` | The source event string used to compute the deterministic ID. |
| `sourceEventType` | `'order' \| 'payment' \| 'refund'` | Category of the triggering event. |
| `canteenId` | `string?` | Present for admin notifications; omitted for some student notifications. |
| `createdAt` | `Timestamp` | Server timestamp set on creation. **Never updated.** |
| `readAt` | `Timestamp?` | Set when `isRead` transitions from `false` → `true`. **Never updated again.** |

---

## Canonical Notification Types

### Student Types

| Type | Trigger |
|---|---|
| `order_placed` | `createOrder` completes successfully |
| `payment_succeeded_demo` | `completeDemoPayment` or `verifySyntheticWebhook[payment.captured]` |
| `payment_failed` | `failDemoPayment` or `verifySyntheticWebhook[payment.failed]` |
| `order_accepted` | `transitionOrderStatus` → `accepted` |
| `order_preparing` | `transitionOrderStatus` → `preparing` |
| `order_ready_for_pickup` | `transitionOrderStatus` → `ready_for_pickup` |
| `order_completed` | `transitionOrderStatus` → `completed` |
| `order_cancelled` | `transitionOrderStatus` → `cancelled` |
| `order_rejected` | `transitionOrderStatus` → `rejected` |
| `refund_pending_demo` | `requestDemoRefund` or `verifySyntheticWebhook[refund.processed]` |
| `refund_completed_demo` | `completeDemoRefund` |

### Admin Types

| Type | Trigger |
|---|---|
| `new_order_for_admin` | `createOrder` completes (fan-out to all active admins for canteen) |
| `payment_verified_for_admin` | `completeDemoPayment` or `verifySyntheticWebhook[payment.captured]` |

---

## Field Restrictions

The following fields are **intentionally absent** from all notification documents:

- `providerReference` — internal payment reference
- `hmac` — webhook signature
- `secret` — any internal secret
- `refundReference` — internal refund reference
- `rawBody` — raw webhook payload
- `failureCode` / `failureMessage` — internal payment failure details
- `studentUid` (on admin notifications) — student privacy protection
