# GrabNGo Step 8 Audit — Admin Queue and Exact Search

## 1. Canteen Admin Order Queue

### 1.1 Multi-Canteen Architecture
Staff profiles stored in `admins/{uid}` contain an array of authorized `canteenIds`.
When an admin accesses the Admin Console:
- If assigned to multiple canteens, a switcher allows toggling between authorized outlets.
- If assigned to one canteen, that outlet is locked.
- Backend Cloud Functions verify that the admin's profile explicitly includes the requested `canteenId`.

### 1.2 Queue Retrieval & Filtering
The function `getAdminOrderQueue` accepts:
- `canteenId` (validated against admin assignments).
- `status` (optional filter: `placed`, `accepted`, `preparing`, `ready_for_pickup`, `completed`, `cancelled`).
- `limit` (default 20, max 50).
- `startAfterOrderId` (safe cursor-based pagination).

---

## 2. Exact Search Isolation

### 2.1 Threat Model
In multi-tenant campus dining, kitchen staff must not be able to snoop on order volume, customer names, or items from competitor canteens on campus.

### 2.2 Mechanism
The `searchAdminOrder` function executes:
```ts
const docSnap = await db.collection('orders').doc(queryOrderId).get();
if (!docSnap.exists || docSnap.data()?.canteenId !== canteenId) {
  throw new functions.https.HttpsError(
    'not-found',
    `Order ${queryOrderId} not found in canteen ${canteenId}.`,
  );
}
```
If an order belongs to Canteen B and is searched by Admin A, the server returns generic `not-found`, concealing whether the order ID exists in the system.

---

## 3. Customer Identity Privacy

Operational dining workflows need to associate orders with students at the pickup counter, but should not expose raw Firebase Auth UIDs or personal identifiers in unmasked form:
- The server derives `maskedCustomer: "student_...${rawUid.slice(-4)}"`.
- The raw `studentUid` field is omitted from both `getAdminOrderQueue` and `searchAdminOrder` responses.
