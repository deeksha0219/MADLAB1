# GrabNGo Step 6 — Backend Callable Functions Contract

**Report ID:** `step6-backend-functions.md`  
**Date:** September 21, 2026  
**Auditor:** Senior Cloud Functions & Backend API Engineer  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  
**Staging Status:** Read-only (Functions NOT deployed to staging)  
**Production Status:** Untouched  
**Billing Status:** Spark Plan (Blaze upgrade prohibited)  
**Legacy Data Status:** Untouched  

---

## 1. Executive Summary

This document specifies the interface contract, schema validation, authorization model, idempotency guarantees, and error codes for the Step 6 serverless backend functions implemented in `functions/src/index.ts`.

All write operations to the catalog are brokered through these trusted callable Cloud Functions. The mobile client application possesses zero direct write privileges to `canteens/` in Firestore Security Rules.

---

## 2. Server Authorization Architecture

Every administrative callable function enforces this multi-step verification sequence before performing any mutation:

```
[ Incoming HTTPS Callable Request ]
                │
                ▼
      [ Step 1: Authentication Check ]
      Is context.auth and context.auth.uid present?
      NO  -> Throw 'unauthenticated'
      YES │
          ▼
      [ Step 2: Schema Hygiene Check ]
      rejectUnknownFields(data, allowedKeys, functionName)
      Has unexpected keys?
      YES -> Throw 'invalid-argument'
      NO  │
          ▼
      [ Step 3: Admin Status Verification ]
      Fetch db.collection('admins').doc(context.auth.uid)
      Is status === 'active'?
      (Or process.env.FUNCTIONS_EMULATOR === 'true')
      NO  -> Throw 'permission-denied'
      YES │
          ▼
      [ Step 4: Canteen Assignment Check ]
      Does admin's canteenIds include the target canteenId?
      NO  -> Throw 'permission-denied' ("Admin not authorized for this canteen")
      YES │
          ▼
      [ Step 5: Execute Idempotent State Mutation ]
      Write with admin.firestore.FieldValue.serverTimestamp()
```

---

## 3. Function Interface Specifications

### 3.1 `createCanteen`
- **Purpose:** Initializes a new campus dining location.
- **Allowed Keys:** `['canteenId', 'name', 'code', 'description', 'sortOrder']`
- **Input Types:**
  - `canteenId`: string (`^[A-Z0-9_]{3,32}$`)
  - `name`: string (1–100 chars, trimmed)
  - `code`: string (`^[A-Z0-9_]{3,20}$`)
  - `description`: optional string (max 1000 chars)
  - `sortOrder`: optional integer (`>= 0`, default `0`)
- **Output:** `{ success: true, message: string, canteen: object }`
- **Idempotency:** Deterministic document ID `canteens/{canteenId}`; if document already exists, updates basic fields without resetting `createdAt`.

### 3.2 `updateCanteen`
- **Purpose:** Modifies name, code, description, or sort order of an existing canteen.
- **Allowed Keys:** `['canteenId', 'name', 'code', 'description', 'sortOrder']`
- **Output:** `{ success: true, message: string }`

### 3.3 `setCanteenActive`
- **Purpose:** Soft-enables or soft-disables an entire canteen location.
- **Allowed Keys:** `['canteenId', 'isActive']`
- **Input Types:**
  - `canteenId`: string
  - `isActive`: boolean
- **Output:** `{ success: true, canteenId: string, isActive: boolean }`

---

### 3.4 `createCategory`
- **Purpose:** Adds a new menu category under an active canteen.
- **Allowed Keys:** `['canteenId', 'categoryId', 'name', 'sortOrder']`
- **Input Types:**
  - `canteenId`: string (must exist and be active)
  - `categoryId`: string (`^[a-zA-Z0-9_-]{1,64}$`)
  - `name`: string (1–100 chars, trimmed)
  - `sortOrder`: optional integer (`>= 0`)
- **Output:** `{ success: true, message: string, category: object }`
- **Validation:** Verifies parent canteen exists. Idempotent set on `canteens/{canteenId}/categories/{categoryId}`.

### 3.5 `updateCategory`
- **Purpose:** Updates category display name or sort order.
- **Allowed Keys:** `['canteenId', 'categoryId', 'name', 'sortOrder']`
- **Output:** `{ success: true, message: string }`

### 3.6 `setCategoryActive`
- **Purpose:** Toggles category visibility (soft-delete / hide).
- **Allowed Keys:** `['canteenId', 'categoryId', 'isActive']`
- **Input Types:**
  - `isActive`: boolean
- **Output:** `{ success: true, categoryId: string, isActive: boolean }`

---

### 3.7 `createMenuItem`
- **Purpose:** Publishes a new food or beverage item under a category.
- **Allowed Keys:** `['canteenId', 'categoryId', 'itemId', 'name', 'description', 'priceInPaise', 'imageUrl', 'sortOrder', 'isAvailable', 'costPriceInPaise', 'internalNotes']`
- **Input Types:**
  - `canteenId`: string
  - `categoryId`: string (must exist under this canteen)
  - `itemId`: string (`^[a-zA-Z0-9_-]{1,64}$`)
  - `name`: string (1–100 chars, trimmed)
  - `description`: optional string (max 1000 chars)
  - `priceInPaise`: **strictly non-negative integer, 0 to 500,000** (rejects floats, negatives, NaN)
  - `imageUrl`: optional string (max 500 chars)
  - `sortOrder`: optional integer (`>= 0`)
  - `isAvailable`: optional boolean (default `true`)
  - `costPriceInPaise`: optional integer (stored in `private/admin` document)
  - `internalNotes`: optional string (stored in `private/admin` document)
- **Output:** `{ success: true, message: string, item: object }`
- **Confidential Field Isolation:** If `costPriceInPaise` or `internalNotes` are supplied, they are written strictly to `canteens/{canteenId}/items/{itemId}/private/admin` and NEVER included in the public item document.

### 3.8 `updateMenuItem`
- **Purpose:** Updates item name, description, price, imageUrl, or sort order.
- **Allowed Keys:** `['canteenId', 'categoryId', 'itemId', 'name', 'description', 'priceInPaise', 'imageUrl', 'sortOrder']`
- **Validation:** Price must remain non-negative integer minor units. Category cannot be changed to another canteen.
- **Output:** `{ success: true, message: string }`

### 3.9 `setMenuItemAvailability`
- **Purpose:** Real-time stock toggle used by canteen staff during daily kitchen operations (e.g. marked out of stock when sold out).
- **Allowed Keys:** `['canteenId', 'itemId', 'isAvailable']`
- **Input Types:**
  - `canteenId`: string
  - `itemId`: string
  - `isAvailable`: boolean
- **Output:** `{ success: true, itemId: string, isAvailable: boolean }`

### 3.10 `setMenuItemActive`
- **Purpose:** Soft-delete toggle to retire an item from the active catalog without breaking referential integrity for existing order history.
- **Allowed Keys:** `['canteenId', 'itemId', 'isActive']`
- **Input Types:**
  - `isActive`: boolean
- **Output:** `{ success: true, itemId: string, isActive: boolean }`

---

## 4. Standardized Error Handling

| HTTPS Error Code | Trigger Condition | Example Client Message |
|---|---|---|
| `unauthenticated` | `context.auth` missing or null | "Authentication required for catalog administration." |
| `permission-denied` | Caller not active admin or not assigned to target canteen | "Caller is not an authorized administrator for canteen [ID]." |
| `invalid-argument` | Unknown fields, negative price, decimal price, empty name, regex mismatch | "priceInPaise must be an integer between 0 and 500,000." |
| `not-found` | Target canteen, category, or item document does not exist | "Category [ID] not found under canteen [ID]." |
| `failed-precondition` | Parent canteen is inactive when attempting to add items | "Cannot add items to an inactive canteen." |

---

## 5. Security & Privacy Guarantees

1. **Zero Credential Logging:** No passwords, phone numbers, or tokens are logged in console statements.
2. **Deterministic Write Isolation:** Each subcollection mutation is scoped by `{canteenId}`, ensuring cross-canteen data contamination is architecturally impossible.
3. **Integer Price Enforcement:** Eliminates floating-point rounding attacks and negative price exploits.
