# Step 10 — Notification Frontend Design

**Date:** 2026-09-23

---

## Components

### NotificationBell (src/components/NotificationBell.tsx)

- **Props:** `color`, `size`, `pollIntervalMs`
- **Data access:** `getUnreadNotificationCount` callable — never direct Firestore
- **Polling:** Every 30s (configurable) + on navigation focus event
- **Badge:** Shows count up to 99+; hidden when count = 0
- **Navigation:** `navigation.navigate('Notifications')` on press

### NotificationsScreen (src/screens/NotificationsScreen.tsx)

- **Data access:** `listMyNotificationsCallable({ limit: 50 })` — never direct Firestore
- **Features:**
  - Pull-to-refresh
  - Unread count badge in header
  - "Mark all read" button (disabled when 0 unread)
  - Individual tap → marks read → navigates to OrderHistory
  - Empty / loading / error states
  - In-app disclaimer banner

---

## Integration Points

| Screen | Integration |
|---|---|
| HomeScreen | Header: static `FeatherIcon bell` replaced by `NotificationBell` |
| AdminLandingScreen | Header: `NotificationBell` added beside Sign Out button |
| AppNavigator | `Notifications` screen registered in both student and admin stacks |

---

## Direct Firestore Read Prohibition

The following patterns are **strictly absent** from all notification client code:

```typescript
// ❌ NEVER: Direct Firestore read
firestore().collection('users').doc(uid).collection('notifications').get()

// ✅ ALWAYS: Via callable
functions().httpsCallable('listMyNotifications')({ limit: 20 })
```

---

## In-App Only Disclaimer

`NotificationsScreen` displays a persistent disclaimer:

> 🔔 In-App Notifications: Displayed within GrabNGo while using the app.  
> Background push delivery is not enabled.

This ensures the user understands the scope limitations and that no FCM or push delivery is configured.

---

## Screen Flow

```
HomeScreen (bell with badge)
  └── tap → NotificationsScreen
    ├── list of notifications (newest first)
    ├── tap notification → markNotificationRead → navigate OrderHistory
    └── "Mark all read" → markAllNotificationsRead
```
