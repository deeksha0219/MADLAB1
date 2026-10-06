# Step 10 — Known Limitations

**Date:** 2026-09-23  
**Scope:** Local emulator only

---

## L1 — Best-Effort Delivery

Notifications are created **after** the lifecycle transaction commits, using fire-and-forget `Promise.catch()`.  
If notification creation fails (e.g., Firestore transient error), the notification is silently missed.  
The order/payment/refund state remains correct regardless.

**Impact:** Low — the notification is informational only. The source of truth is the order/payment document.  
**Production fix:** Use Firestore triggers or a task queue for guaranteed delivery.

---

## L2 — Polling (Not Real-Time)

`NotificationBell` polls `getUnreadNotificationCount` every 30 seconds.  
There is no Firestore `onSnapshot` listener or real-time push.

**Impact:** User sees new notification badge within 30s, or immediately on screen focus.  
**Production fix:** Add a Firestore real-time listener on `users/{uid}/notifications` or use FCM to wake the app.

---

## L3 — markAllNotificationsRead Batch Limit

`markAllNotificationsRead` uses `db.batch()`. Firestore batches are limited to 500 operations.  
If a user has >500 unread notifications, the batch commit will fail.

**Impact:** Very low under demo usage (≤50 notifications per user in practice).  
**Production fix:** Paginate the batch into chunks of 500.

---

## L4 — Webhook Duplicate Notifications

In the local emulator, both `completeDemoPayment` (callable) and `verifySyntheticWebhook[payment.captured]` (HTTP) may fire for the same payment. These produce **different** `sourceEventId` values (`_succeeded_demo` vs `_succeeded_demo_wh`), resulting in two `payment_succeeded_demo` notifications.

**Impact:** Minor — demo emulator only. In real integration, only one path fires.  
**Production fix:** Emit from webhook only; remove callable notification trigger.

---

## L5 — No In-App Notification Deletion

Notifications are never deleted. The oldest ones remain indefinitely.  
`listMyNotifications` returns the 20 most recent (up to 50 with custom limit).

**Impact:** Low for demo. For production, implement a TTL field or periodic cleanup.

---

## L6 — No Offline Support

`listMyNotificationsCallable` requires network. Offline users see the cached list from last load, or an error state.

**Impact:** Low — expected for a callable-only architecture.  
**Production fix:** Cache last-fetched notifications in local AsyncStorage.

---

## L7 — Not Push-Notified When App is Closed

This is by design. The implementation is strictly **in-app** only.  
Users will not receive alerts when the app is in the background or terminated.

**Impact:** User must open the app to see notifications.  
**Future:** Firebase Cloud Messaging (Step 11+ scope) would address this.

---

## Summary

| Limitation | Severity | Production Fix Required |
|---|---|---|
| L1 Best-effort delivery | Low | Yes (task queue) |
| L2 Polling not real-time | Low | Yes (onSnapshot) |
| L3 Batch 500 limit | Very Low | Yes (pagination) |
| L4 Webhook duplicates | Minor | Yes (single path) |
| L5 No deletion | Low | Yes (TTL cleanup) |
| L6 No offline support | Low | Yes (AsyncStorage cache) |
| L7 No background delivery | By Design | FCM (future step) |
