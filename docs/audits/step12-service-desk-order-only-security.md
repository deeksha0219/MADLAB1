# Step 12: Service Desk Order-Only Security & Operational Isolation Audit

## 1. Overview & Trust Boundary Separation

The GrabNGo Service Desk is strictly an **order-operations interface**, designed for canteen counter staff. It is decoupled completely from financial workflows, payment authorization, refund management, and transaction records.

All operational eligibility decisions and masking are computed server-side in trusted Cloud Functions. The client UI is completely untrusted for authorization or filtering.

---

## 2. Server-Side Operational Eligibility Predicate

### 2.1 Online Orders
- Must have backend-confirmed payment before the order is returned to the service desk.
- Required state: `payment_verified` or operational state `accepted`, `preparing`, `ready_for_pickup`, `completed`.
- Orders in `placed` (awaiting payment), `payment_failed`, `expired`, `cancelled`, or `rejected` prior to payment verification are strictly omitted from service-desk queries (`listOperationalOrders`, `searchOperationalOrders`, `getOperationalOrderDetails`).

### 2.2 Cash Orders
- Cash orders are marked `payment_pending_cash` or `placed` until explicitly approved or verified by administrative staff.
- Once verified, the operational order enters `payment_verified` and becomes visible to counter staff for preparation.
- Service desk staff cannot approve cash payments.

### 2.3 Centralized Backend Predicate Implementation
Implemented in [functions/src/index.ts](file:///e:/Madlab/MADLAB1/functions/src/index.ts#L2430-L2465):
```typescript
export function isOrderOperationallyEligible(order: any): boolean {
  if (!order || typeof order !== 'object') return false;
  const status = order.status;
  const paymentStatus = order.paymentStatus;
  const paymentMethod = order.paymentMethod;

  // Ineligible terminal states
  if (['cancelled', 'rejected'].includes(status)) {
    if (!['payment_verified', 'paid', 'approved'].includes(paymentStatus)) {
      return false;
    }
  }

  // Pending/failed/expired payments are never eligible
  if (['pending', 'failed', 'expired'].includes(paymentStatus)) {
    return false;
  }

  // Cash orders require operational approval or verified status
  if (paymentMethod === 'cash') {
    return ['payment_verified', 'accepted', 'preparing', 'ready_for_pickup', 'completed'].includes(status);
  }

  // Online orders require payment approval
  if (status === 'placed' && paymentStatus !== 'payment_verified' && paymentStatus !== 'paid') {
    return false;
  }

  return ['payment_verified', 'accepted', 'preparing', 'ready_for_pickup', 'completed', 'cancelled', 'rejected'].includes(status);
}
```

---

## 3. Strict Service-Desk Operational DTO (Zero Financial Data)

The service desk response contains **operational data only**. All financial, payment, refund, and raw identity data are stripped at the backend layer prior to serialization.

### 3.1 Allowed Fields
- `orderId`: Canonical order identifier.
- `shortOrderReference`: 8-character uppercase identifier for counter callout.
- `canteenId`: Assigned canteen identifier.
- `items`: Array of items containing `itemId`, `itemName`, and integer `quantity`.
- `pickupSlot`: Slot interval (`pickupDate`, `pickupStartTime`, `pickupEndTime`, `timezone`).
- `status` / `orderStatus`: Operational state (`placed`, `accepted`, `preparing`, `ready_for_pickup`, `completed`, `cancelled`, `rejected`).
- `itemCount`: Sum of item quantities.
- `maskedCustomer`: Sanitized identifier (e.g., `student_...4a2b`).
- `createdAt` / `updatedAt`: Timestamps.
- `operationalReason`: Reason for cancellation or rejection where needed for staff workflow.

### 3.2 Omitted & Forbidden Fields
The following fields are strictly omitted from service-desk callables, logs, and UI:
- `paymentStatus`
- `paymentMethod`
- `totalInPaise` / `subtotalInPaise` / item prices
- `refundStatus` / `refundAmount`
- `activePaymentId` / `paymentId`
- `providerReference` / transaction references
- `webhookEventId` / idempotency keys
- HMAC, secrets, or provider payloads
- Raw `studentUid`

### 3.3 Separate Administrative Financial Interface
A separate admin/payment interface exists for authorized `canteen_admin` and `platform_operator` roles to inspect payments. This interface remains completely isolated from the service-desk callable endpoints and UI.

---

## 4. Role Authorization Matrix

Every backend callable enforces explicit role allowlists through centralized authorization helpers in [functions/src/index.ts](file:///e:/Madlab/MADLAB1/functions/src/index.ts):

| Callable Endpoint | Allowed Roles | `service_desk` Permitted? |
| :--- | :--- | :--- |
| `listOperationalOrders` | `service_desk`, `canteen_admin`, `platform_operator` | Yes (Assigned Canteen Only) |
| `searchOperationalOrders` | `service_desk`, `canteen_admin`, `platform_operator` | Yes (Assigned Canteen Only) |
| `getOperationalOrderDetails`| `service_desk`, `canteen_admin`, `platform_operator` | Yes (Assigned Canteen Only) |
| `transitionOperationalOrderStatus` | `service_desk`, `canteen_admin`, `platform_operator` | Yes (Operational transitions only) |
| `getIncomingOrderCount` | `service_desk`, `canteen_admin`, `platform_operator` | Yes (Assigned Canteen Only) |
| `createDemoPayment` | `student` (Order owner only) | **DENIED (403)** |
| `verifyDemoPayment` | `canteen_admin`, `platform_operator` | **DENIED (403)** |
| `completeDemoPayment` | `canteen_admin`, `platform_operator` | **DENIED (403)** |
| `failDemoPayment` | `canteen_admin`, `platform_operator` | **DENIED (403)** |
| `expirePaymentAttempt` | `canteen_admin`, `platform_operator` | **DENIED (403)** |
| `getPaymentStatus` | `student` (owner), `canteen_admin`, `platform_operator` | **DENIED (403)** |
| `requestDemoRefund` | `canteen_admin`, `platform_operator` | **DENIED (403)** |
| `completeDemoRefund` | `canteen_admin`, `platform_operator` | **DENIED (403)** |
| `assignAdminRole` | `platform_operator` only | **DENIED (403)** |

Hiding buttons in the frontend is not authorization. The backend rejects all unauthorized invocations with HTTP 403 `permission-denied`.

---

## 5. Direct Raw Read Denial (`firestore.rules`)

Direct client reads to `/orders/{orderId}` and `/orders/{orderId}/statusHistory/{eventId}` are restricted to authenticated students for their own orders (`resource.data.studentUid == request.auth.uid`).

Staff and service-desk members are denied direct client read access (`allow read: if isOwner(studentUid)`). All staff operations must query through the sanitized Cloud Functions. This guarantees that staff cannot bypass backend data masking or read unredacted payment documents.

---

## 6. Live Incoming-Order Counter

The service desk displays a live count of incoming eligible orders:
- Computed via `getIncomingOrderCount` and returned in `listOperationalOrders` as `incomingEligibleCount`.
- Calculated server-side using the authoritative predicate:
  `status in ['placed', 'payment_verified']` filtered through `isOrderIncomingEligible(doc.data())`.
- Decreases immediately when an order transitions out of incoming status (e.g. `accepted`).
- Handles pagination, network reconnects, and role verification.

---

## 7. Touch-Screen On-Screen Keyboard

The in-screen keyboard (`web/index.html` and `src/components/TouchKeyboard.tsx`):
- Provides search by short order reference and operational status filtering.
- Includes toggle for physical vs. on-screen keyboard, space, backspace, and clear.
- Does not capture or transmit financial credentials, admin credentials, or payment secrets.

---

## 8. Verification Results

All assertions were verified against the local Firebase Emulator Suite:
- `node scripts/run-emulator-service-desk-test.js`: **78 passed, 0 failed** (Exit code: 0)
- `node scripts/run-emulator-rules-test.js`: **43 passed, 0 failed** (Exit code: 0)
