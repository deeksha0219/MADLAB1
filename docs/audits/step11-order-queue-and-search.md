# GrabNGo Step 11: Order Queue and Search Operations

## 1. Incoming Order Queue (`listOperationalOrders`)

The `listOperationalOrders` Cloud Function provides canteen-scoped order queue retrieval for operators.

### 1.1 Input Contract
```json
{
  "canteenId": "optional-assigned-canteen",
  "status": "optional-valid-order-status",
  "pickupDate": "YYYY-MM-DD",
  "limit": 20,
  "cursor": "optional-document-id"
}
```

### 1.2 Validation & Bounds
- **Pagination Limit**: 1 <= `limit` <= 50. Defaults to 20. Rejects negative numbers, zero, fractional numbers, oversized limits, strings, and non-primitives with HTTP 400.
- **Date Format**: Validated against `^\d{4}-\d{2}-\d{2}$`.
- **Status Filter**: Must match approved `VALID_ORDER_STATUSES`.
- **Canteen Authorization**: If `canteenId` is supplied, it must be present in `caller.canteenIds`. If omitted, defaults to caller's first assigned canteen.

### 1.3 Sanitized Queue Output
Each order record returned exposes only operational fields:
- `orderId`, `shortOrderReference` (e.g. `ABC12345`)
- `canteenId`, `orderStatus`, `status`
- `paymentStatus`, `refundStatus`
- `pickupSlot` (pickupDate, pickupStartTime, pickupEndTime)
- `itemCount`, `totalInPaise`
- `maskedCustomer` (e.g. `student_...1a2b`, protecting student privacy)
- `createdAt`, `updatedAt`
- `activePaymentId` (sanitized identifier only, zero secrets or provider signatures)

---

## 2. Order Search (`searchOperationalOrders`)

The `searchOperationalOrders` Cloud Function provides exact-match lookup by Order ID or reference.

### 2.1 Input Contract
```json
{
  "query": "exact-order-id-or-reference",
  "canteenId": "optional-assigned-canteen"
}
```

### 2.2 Security & Normalization
- **Length Bounds**: 1 to 64 characters.
- **Whitespace Normalization**: Automatically trimmed server-side.
- **Control Character Rejection**: Queries containing `[\x00-\x1F\x7F]` are rejected with HTTP 400.
- **Arbitrary Field Query Prevention**: Only designated `orderId` or document lookup is performed. No arbitrary client Firestore queries are permitted.

### 2.3 Canteen Isolation & Anti-Probing
If an order does not exist OR belongs to a canteen outside the caller's assigned `canteenIds`, the function returns:
```json
{
  "success": true,
  "found": false,
  "order": null
}
```
This fail-closed, uniform response guarantees zero leakage regarding whether an order exists in a competing or unassigned canteen.
