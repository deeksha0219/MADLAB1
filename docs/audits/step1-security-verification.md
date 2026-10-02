# Step 1: Security Verification & Service-Desk Order-Only Isolation Report

**Tested Revision**: `8d57da3e01e96a6bda7232bdb044fd0f82253b9b`  
**Target Branch**: `development`  
**Environment**: Local Firebase Emulator Suite (`demo-grabngo-local`)  
**Audit Date**: September 25, 2026  

---

## 1. Executive Summary & Gate Decision

### Acceptance Gate Status:
```
STEP 1 PASS — LOCAL SECURITY AND CASH-ORDER SERVICE-DESK ELIGIBILITY VERIFIED
```

Every security remediation, cash-order eligibility constraint, and service-desk operational boundary requirement has been implemented in source code and proven through automated emulator test suites. The Service Desk is confirmed to be an **order-operations interface only**, completely devoid of payment, financial, or customer identity data.

---

## 2. Step 1.1 — Service-Desk Operational DTO & Forbidden-Key Verification

### 2.1 Complete Removal of Customer Identity and Financial Keys
- **Action**: Removed all financial, personal identity, and sensitive token fields from:
  - `listOperationalOrders` ([functions/src/index.ts](file:///e:/Madlab/MADLAB1/functions/src/index.ts))
  - `searchOperationalOrders` ([functions/src/index.ts](file:///e:/Madlab/MADLAB1/functions/src/index.ts))
  - `getOperationalOrderDetails` ([functions/src/index.ts](file:///e:/Madlab/MADLAB1/functions/src/index.ts))
  - `getIncomingOrderCount` ([functions/src/index.ts](file:///e:/Madlab/MADLAB1/functions/src/index.ts))
  - `transitionOperationalOrderStatus` ([functions/src/index.ts](file:///e:/Madlab/MADLAB1/functions/src/index.ts))
- **Frontend**: Verified [web/index.html](file:///e:/Madlab/MADLAB1/web/index.html) and client screens contain zero references to `maskedCustomer`, student UIDs, or payment data.

### 2.2 Recursive Forbidden-Key Scanner
Every service-desk response is recursively verified across root objects, nested child objects, and array elements by `scanForbiddenKeys` against the mandatory forbidden list:
```javascript
const FORBIDDEN_KEYS = [
  'paymentStatus', 'paymentMethod', 'amountInPaise', 'totalInPaise',
  'subtotalInPaise', 'refundStatus', 'refundAmount', 'refundedAmountInPaise',
  'activePaymentId', 'paymentId', 'providerReference', 'refundReference',
  'webhookEventId', 'idempotencyKey', 'studentUid', 'maskedCustomer',
  'hmac', 'secret', 'token', 'password'
];
```
- **Result**: Scanned all 5 service-desk callables with **0 forbidden keys detected**.
- **Item Pricing**: All items returned in operational DTOs contain strictly `itemId`, `itemName`, and integer `quantity`. `unitPriceInPaise`, `lineTotalInPaise`, and `price` are absent.

---

## 3. Step 1.2 — Corrected Cash-Order & Backend Payment Eligibility (Truth Table)

Eligibility is computed exclusively server-side using the centralized trusted predicate `isOrderOperationallyEligible` in [functions/src/index.ts](file:///e:/Madlab/MADLAB1/functions/src/index.ts).

### 3.1 Cash-Order Service-Desk Eligibility Rule
- **Pending/Unapproved Cash Orders**: Strictly hidden from service desk (`paymentMethod === 'cash'`, `paymentStatus === 'pending'`, `orderStatus === 'placed'`).
- **Visible Condition**: Visible ONLY after an authorized administrator explicitly records payment verification (`paymentStatus === 'payment_verified'`) and the operational status is valid (`payment_verified`, `accepted`, `preparing`, `ready_for_pickup`, `completed`).
- **Terminal Orders**: Cancelled or rejected orders remain hidden from operational views.
- **Dedicated Approval Endpoint**: Added `approveCashPayment` callable restricted to `canteen_admin` and `platform_operator`. Service desk attendants and students are denied (HTTP 403).

### 3.2 Eligibility Truth-Table Verification Results
All 15 test cases were executed against synthetic emulator orders and verified through both `listOperationalOrders` and `getOperationalOrderDetails`:

| # | Payment Method | Payment Status | Order Status | Expected Service-Desk Result | Measured List Result | Measured Details Result | Result |
| :- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| 1 | `cash` | `pending` | `placed` | **Hidden** | Hidden | Not Found (404) | **PASS** |
| 2 | `cash` | `pending` | `payment_verified`| **Hidden** (invalid state) | Hidden | Not Found (404) | **PASS** |
| 3 | `cash` | `failed` | `placed` | **Hidden** | Hidden | Not Found (404) | **PASS** |
| 4 | `cash` | `expired` | `placed` | **Hidden** | Hidden | Not Found (404) | **PASS** |
| 5 | `cash` | `payment_verified` | `payment_verified`| **Visible** | Visible | Returned (200) | **PASS** |
| 6 | `cash` | `payment_verified` | `accepted` | **Visible** | Visible | Returned (200) | **PASS** |
| 7 | `cash` | `payment_verified` | `preparing`| **Visible** | Visible | Returned (200) | **PASS** |
| 8 | `cash` | `payment_verified` | `ready_for_pickup`| **Visible** | Visible | Returned (200) | **PASS** |
| 9 | `cash` | `payment_verified` | `completed`| **Visible** | Visible | Returned (200) | **PASS** |
| 10 | `cash` | `payment_verified` | `cancelled`| **Hidden** | Hidden | Not Found (404) | **PASS** |
| 11 | `cash` | `payment_verified` | `rejected` | **Hidden** | Hidden | Not Found (404) | **PASS** |
| 12 | `upi_demo` | `pending` | `placed` | **Hidden** | Hidden | Not Found (404) | **PASS** |
| 13 | `upi_demo` | `failed` | `placed` | **Hidden** | Hidden | Not Found (404) | **PASS** |
| 14 | `upi_demo` | `expired` | `placed` | **Hidden** | Hidden | Not Found (404) | **PASS** |
| 15 | `upi_demo` | `succeeded_demo` | `payment_verified`| **Visible** | Visible | Returned (200) | **PASS** |

*Predicate Consistency*: The identical predicate is enforced across `listOperationalOrders`, `searchOperationalOrders`, `getOperationalOrderDetails`, and `getIncomingOrderCount`.

---

## 4. Step 1.3 — Role Authorization Matrix Verification

Tested across synthetic personas with dedicated permissions:

| Caller Role / State | List / Search Operations | Transition Order Status | Approve Cash Payment | Financial Mutations | Assign Admin Roles |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **`service_desk` (Assigned Canteen)** | **Allowed** | **Allowed** (Operational only) | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** |
| **`canteen_admin` (Assigned Canteen)**| **Allowed** | **Allowed** | **Allowed** | **Allowed** | **DENIED (403)** |
| **`platform_operator`** | **Allowed** | **Allowed** | **Allowed** | **Allowed** | **Allowed** |
| **`student`** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | Owner status only | **DENIED (403)** |
| **`inactive service_desk`** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** |
| **`inactive canteen_admin`** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** |
| **Cross-Canteen `service_desk`** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** |
| **Cross-Canteen `canteen_admin`** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** | **DENIED (403)** |
| **Unauthenticated Caller** | **DENIED (401)** | **DENIED (401)** | **DENIED (401)** | **DENIED (401)** | **DENIED (401)** |

---

## 5. Step 1.4 — Direct Firestore Access Denial

Tested and verified against `firestore.rules` via [scripts/run-emulator-rules-test.js](file:///e:/Madlab/MADLAB1/scripts/run-emulator-rules-test.js):
- Direct client read to `/orders/{orderId}`: **DENIED for staff** (`403`); allowed only for the owning student.
- Direct client read to `/orders/{orderId}/statusHistory/{eventId}`: **DENIED for staff** (`403`).
- Direct client read to `/orders/{orderId}/payments/{paymentId}`: **DENIED for all clients** (`allow read, write: if false`).
- Direct client read to `/orders/{orderId}/paymentHistory/{eventId}`: **DENIED for all clients** (`allow read, write: if false`).
- Direct client write to `/notificationOutbox`: **DENIED for all clients** (`allow read, write: if false`).

---

## 6. Step 1.5 — Verification Commands & Reconciled Execution Log

| Test Suite | Exact Command | Exit Code | Assertions | Status |
| :--- | :--- | :---: | :---: | :---: |
| **Service Desk Isolation** | `node scripts/run-emulator-service-desk-test.js` | `0` | 127 passed, 0 failed | **PASS** |
| **Firestore Security Rules** | `node scripts/run-emulator-rules-test.js` | `0` | 43 passed, 0 failed | **PASS** |
| **Payment Foundation** | `node scripts/run-emulator-payment-test.js` | `0` | 147 passed, 0 failed | **PASS** |
| **Order State Machine** | `node scripts/run-emulator-order-test.js` | `0` | 64 passed, 0 failed | **PASS** |
| **Notifications Outbox** | `node scripts/run-emulator-notifications-test.js`| `0` | 144 passed, 0 failed | **PASS** |
| **Order Status History** | `node scripts/run-emulator-status-test.js` | `0` | 65 passed, 0 failed | **PASS** |
| **Core Functions Unit** | `node scripts/run-emulator-functions-test.js` | `0` | 54 passed, 0 failed | **PASS** |

**Total Reconciled Emulator Assertions**: **644 passed, 0 failed**.
