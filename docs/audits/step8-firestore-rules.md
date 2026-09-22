# GrabNGo Step 8 Audit — Firestore Security Rules

## 1. Rule Definitions Added in Step 8

To protect the immutable status history audit log, security rules were extended for the subcollection:
`orders/{orderId}/statusHistory/{eventId}`

```javascript
// --- Step 8: Order Status History Subcollection ---
match /statusHistory/{eventId} {
  // Allow read if authenticated user is the student who placed the parent order,
  // or an active canteen admin assigned to this canteen.
  allow read: if isAuthenticated() && (
    isOrderOwner(orderId) ||
    isAdminForCanteen(get(/databases/$(database)/documents/orders/$(orderId)).data.canteenId)
  );

  // Status transitions and history records are exclusively written by backend Cloud Functions.
  allow write: if false;
}
```

---

## 2. Security Assertions Verified

1. **Direct client creation of status history**: DENIED (`allow write: if false`).
2. **Direct client update/deletion of status history**: DENIED.
3. **Student owner read access**: ALLOWED for orders where `request.auth.uid == resource.data.studentUid`.
4. **Cross-student read access**: DENIED for any other student.
5. **Assigned admin read access**: ALLOWED if admin has `canteenId` in `admins/$(request.auth.uid).canteenIds`.
6. **Cross-canteen admin read access**: DENIED if admin is not assigned to that canteen.
7. **Parent order document immutability**: Direct client update/delete to `orders/{orderId}` remains completely DENIED (`allow write: if false`).
