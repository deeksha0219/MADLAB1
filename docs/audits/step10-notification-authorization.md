# Step 10 — Notification Authorization

**Date:** 2026-09-23

---

## Firestore Rules (notifications subcollection)

```javascript
match /databases/{database}/documents {
  match /users/{userId}/notifications/{notificationId} {
    allow read, write: if false;
  }

  match /users/{userId}/notificationOutbox/{eventId} {
    allow read, write: if false;
  }

  match /notificationEvents/{eventId} {
    allow read, write: if false;
  }
}
```

- Mandatory Access Policy: Callable-Only Access. All notification reads and mutations are brokered exclusively through Cloud Functions.
- `allow read, write: if false` on notifications, outbox, and event collections ensures clients cannot bypass pagination, response masking, or server-side authorization checks.
- Direct client reads, creates, updates, and deletes are all denied (HTTP 403 / permission-denied).

---

## Callable Function Authorization

### listMyNotifications
- Requires: `context.auth.uid` (unauthenticated → 401)
- UID derived from token — never from client payload
- Queries: `users/{context.auth.uid}/notifications`

### markNotificationRead
- Requires: `context.auth.uid`
- Validates: `notifData.recipientUid === context.auth.uid` (defense-in-depth)
- Allowed fields: `{ notificationId }`
- Mutates: only `isRead` and `readAt`

### markAllNotificationsRead
- Requires: `context.auth.uid`
- Allowed fields: `{}` (empty)
- Mutates: only `isRead` and `readAt` on caller's own records

### getUnreadNotificationCount
- Requires: `context.auth.uid`
- Allowed fields: `{}` (empty)
- Returns count of `isRead === false` for caller only

---

## Admin Fan-Out Authorization

`notifyAssignedCanteenAdmins` enforces:

```typescript
db.collection('admins')
  .where('status', '==', 'active')
  .where('canteenIds', 'array-contains', canteenId)
```

- Only `status === 'active'` admins receive notifications
- Only admins whose `canteenIds` includes the order's `canteenId`
- Inactive admins are excluded
- Admins assigned to other canteens are excluded

---

## Unknown Fields Rejection

All 4 callables call `rejectUnknownFields(data, allowedFields, fnName)` before any processing:
- Returns `HttpsError('invalid-argument', ...)` if any unexpected field is present
- Prevents field-stuffing and probing attacks
