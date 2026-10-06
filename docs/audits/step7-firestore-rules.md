# GrabNGo Step 7 — Firestore Security Rules & Access Control

**Report ID:** `step7-firestore-rules.md`  
**Execution Date & Time:** September 22, 2026, 11:09 IST  
**Auditor:** Principal Security Architect  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  

---

## 1. Step 7 Security Rules Evaluation

The active local [`firestore.rules`](file:///e:/Madlab/MADLAB1/firestore.rules) defines access boundaries across user-scoped carts, pickup slots, and orders.

### 1.1 User Cart Subcollections (`users/{userId}/cart/{itemKey}`)
```
match /cart/{itemKey} {
  allow read: if isOwner(userId);

  allow create: if isOwner(userId)
    && request.resource.data.keys().hasOnly(['itemId', 'canteenId', 'quantity', 'updatedAt'])
    && request.resource.data.itemId == itemKey
    && request.resource.data.quantity is int
    && request.resource.data.quantity >= 1
    && request.resource.data.quantity <= 99
    && request.resource.data.updatedAt == request.time;

  allow update: if isOwner(userId)
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['quantity', 'updatedAt'])
    && request.resource.data.quantity is int
    && request.resource.data.quantity >= 1
    && request.resource.data.quantity <= 99
    && request.resource.data.updatedAt == request.time;

  allow delete: if isOwner(userId);
}
```

### 1.2 Pickup Slots Subcollection (`canteens/{canteenId}/pickupSlots/{slotId}`)
```
match /pickupSlots/{slotId} {
  allow read: if isAuthenticated() && (
    resource.data.isOpen == true || isCanteenAdmin(canteenId)
  );
  allow write: if false; // Cloud Functions only
}
```

### 1.3 Orders Collection (`orders/{orderId}`)
```
match /orders/{orderId} {
  allow read: if isAuthenticated() && (
    resource.data.studentUid == request.auth.uid
    || isCanteenAdmin(resource.data.canteenId)
  );
  allow write: if false; // Cloud Functions only
}
```

---

## 2. Test Verification Summary
All 28 base rules assertions and cart/order rules were verified live against the port `8085` Firestore Emulator:
- Student reading own order: **ALLOWED**
- Student reading another student's order: **DENIED**
- Direct client creation, update, or deletion of orders: **DENIED**
- Direct client manipulation of order totals or status: **DENIED**
