# Step 10 — Baseline and Notification Inventory

**Date:** 2026-09-23  
**Project:** GrabNGo (MADLAB1)  
**Branch:** development  
**Scope:** Local emulator only

---

## 1. Baseline State Before Step 10

### Existing Lifecycle Functions (Step 9 Final State)

| Function | Role | Notification Need |
|---|---|---|
| `createOrder` | Places order, reserves slot | student: order_placed; admin: new_order_for_admin |
| `transitionOrderStatus` | Admin/student status changes | student: per-status type |
| `completeDemoPayment` | Marks payment succeeded | student: payment_succeeded_demo; admin: payment_verified_for_admin |
| `failDemoPayment` | Records immutable failure | student: payment_failed |
| `cancelDemoPayment` | Cancels processing payment | No notification (user-initiated, already knows) |
| `expirePaymentAttempt` | Expires TTL-exceeded payment | No notification (not a failure) |
| `requestDemoRefund` | Initiates demo refund | student: refund_pending_demo |
| `completeDemoRefund` | Completes demo refund | student: refund_completed_demo |
| `verifySyntheticWebhook` | payment.captured / payment.failed / refund.processed | per event type (mirrors callable notifications) |

### Pre-Existing Mobile State

- **HomeScreen.tsx** — static `FeatherIcon name="bell"`, no notification logic
- **AppNavigator.tsx** — no Notifications route
- **src/services/** — no notification service file
- **src/components/** — no notification component

---

## 2. Inventory: New Files

| File | Purpose |
|---|---|
| `functions/src/notifications/notificationService.ts` | Server-side core: deterministic IDs, idempotency, templates, admin fan-out |
| `src/services/notificationService.ts` | Client-side callable wrappers (no direct Firestore) |
| `src/components/NotificationBell.tsx` | Reusable bell + unread badge (polls via Cloud Function) |
| `src/screens/NotificationsScreen.tsx` | Full notifications list screen |
| `scripts/run-emulator-notifications-test.js` | 12-suite emulator test runner |

---

## 3. Inventory: Modified Files

| File | Change |
|---|---|
| `functions/src/index.ts` | Import notificationService; post-commit notification calls in 7 lifecycle functions; 4 new callables |
| `firestore.rules` | Added `notifications/{notificationId}` rule block |
| `src/screens/HomeScreen.tsx` | Replaced static bell with `NotificationBell` component |
| `src/screens/AdminLandingScreen.tsx` | Added `NotificationBell` in header |
| `src/navigation/AppNavigator.tsx` | Registered `NotificationsScreen` in student + admin stacks |
| `package.json` | Added `test:notifications:emulator` script |

---

## 4. Collection Path

```
users/{studentUid}/notifications/{notificationId}
users/{adminUid}/notifications/{notificationId}
```

---

## 5. Baseline Conclusion

Step 9 finalized all payment state machines. Step 10 adds a strictly additive notification layer.  
No existing payment, order, refund, or capacity collection is structurally modified.
