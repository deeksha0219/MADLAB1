# GrabNGo Step 8 Audit — Cloud Functions Implementation

## 1. Cloud Functions Deployed (Local Emulator)

### 1.1 `transitionOrderStatus`
- **Trigger**: HTTPS onCall
- **Access Control**: Authenticated callers (verified Student owner or assigned Canteen Admin).
- **Execution Model**: Pure Firestore Transaction (`db.runTransaction`).
- **All Reads Precede All Writes**: Reads order doc, admin profile (if admin), student profile (if student), and pickup slot doc before performing any mutations.
- **Capacity Floor**:
  ```ts
  const newReserved = Math.max(0, currentReserved - 1);
  transaction.update(slotRef, {
    reservedCount: newReserved,
    updatedAt: FieldValue.serverTimestamp(),
  });
  ```
- **Deterministic History Key**:
  ```ts
  const eventId = `${orderId}_${fromStatus}_to_${toStatus}`;
  ```

### 1.2 `verifyDemoPayment`
- **Trigger**: HTTPS onCall
- **Environment Gate**:
  ```ts
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'verifyDemoPayment is strictly an emulator-only demonstration helper.',
    );
  }
  ```
- **Validation**: Rejects cash orders; rejects non-placed orders.
- **Outcome**: Transitions `paymentStatus` to `'demo_verified'` and `status` to `'payment_verified'`.

### 1.3 `getAdminOrderQueue`
- **Trigger**: HTTPS onCall
- **Access Control**: Active Canteen Admin assigned to the target `canteenId`.
- **Filtering**: Optional `status` filter (`placed`, `accepted`, etc.).
- **Bounded Pagination**: Max limit 50; supports `startAfterOrderId`.
- **Privacy Masking**: Customer UID is replaced with `maskedCustomer: "student_...${rawUid.slice(-4)}"`. The raw `studentUid` is omitted from the client response.

### 1.4 `searchAdminOrder`
- **Trigger**: HTTPS onCall
- **Access Control**: Active Canteen Admin assigned to `canteenId`.
- **Canteen Isolation**: If the order belongs to another canteen or does not exist, throws `not-found`. It never returns metadata or confirms existence across canteen boundaries.
- **Privacy Masking**: Exposes `maskedCustomer`.
