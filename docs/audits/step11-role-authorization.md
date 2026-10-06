# GrabNGo Step 11: Role Authorization and Canteen Isolation

## 1. Role Foundation & Operational Policy

GrabNGo defines four primary operational roles with strict least-privilege boundaries:

```
student
canteen_admin
service_desk
platform_operator (internal operator)
```

### 1.1 Permission Matrix

| Operation | Student | Canteen Admin | Service Desk | Platform Operator |
| --- | --- | --- | --- | --- |
| **View own orders** | Yes | No (unless personal student account) | No (unless personal student account) | No |
| **View assigned-canteen queue** | No | Yes | Yes | Yes (all canteens) |
| **Search assigned-canteen orders** | No | Yes | Yes | Yes (all canteens) |
| **View assigned-canteen order details** | Own order only | Yes | Yes | Yes (all canteens) |
| **Update operational order status** | Self-cancel placed cash orders only | Yes (assigned canteen) | Yes (assigned canteen) | Yes (all canteens) |
| **Add operational notes** | No | Yes | Yes | Yes |
| **Read immutable audit history** | Own order history only | Assigned canteen | Assigned canteen | Yes |
| **Manage menu / catalog** | No | Yes (assigned canteen) | **NO** (Catalog restricted) | Yes |
| **Assign roles / admins** | No | No | No | Server bootstrap only |
| **Direct client write to orders** | No | No | No | No |
| **Direct client write to notes/audit** | No | No | No | No |
| **Direct mutation of payment records** | No | No | No | No |

---

## 2. Server Authorization Derivations

All authorization decisions occur on the trusted server via Firebase Authentication and Firestore `admins/{uid}` records:

1. **Authentication**:
   ```typescript
   if (!context.auth || !context.auth.uid) {
     throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
   }
   ```
2. **Profile Retrieval**:
   ```typescript
   const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
   if (!adminDoc.exists || adminDoc.data()?.status !== 'active') {
     throw new functions.https.HttpsError('permission-denied', 'Active staff or administrative privileges required.');
   }
   ```
3. **Role & Canteen Verification**:
   - `role`: Retrieved from `adminDoc.data().role`.
   - `canteenIds`: Retrieved from `adminDoc.data().canteenIds` array.
   - For canteen-specific actions: `canteenIds.includes(targetCanteenId)` is asserted (or `role === 'platform_operator'`).

---

## 3. Separation of Concerns: Service Desk vs. Canteen Admin

`service_desk` attendants are counter and kiosk operators who facilitate order pickup, status progression, and customer assistance. They are strictly prohibited from catalog administration (creating or editing menu items, prices, or categories):

```typescript
if (data.role === 'service_desk') {
  throw new functions.https.HttpsError(
    'permission-denied',
    'Service desk operators are not authorized to perform catalog administration.',
  );
}
```

This enforces the principle of least privilege, ensuring service-desk personnel cannot tamper with item prices, menus, or catalog configurations.
