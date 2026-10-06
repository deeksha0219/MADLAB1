# GrabNGo Step 11: Operational Notes

## 1. Overview & Data Model

Operational notes allow canteen administrators and service-desk attendants to document counter exceptions, customer requests, ingredient substitutions, or pickup clarifications.

### 1.1 Firestore Storage Path
```
orders/{orderId}/operationalNotes/{noteId}
```

### 1.2 Schema Definition
```typescript
interface OperationalNote {
  noteId: string;
  orderId: string;
  canteenId: string;
  authorUid: string;
  authorRole: 'canteen_admin' | 'service_desk';
  body: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  isDeleted: boolean;
}
```

---

## 2. Server Authorization & Validation (`createOperationalNote`)

1. **Authentication**: Caller must be authenticated with active `canteen_admin` or `service_desk` status.
2. **Canteen Assignment**: Order must belong to caller's assigned canteen(s).
3. **Input Bounds**:
   - `body`: 1 to 1000 characters, trimmed.
   - Rejects control characters `[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`.
4. **Author Derivation**:
   - `authorUid`: Derived strictly from `context.auth.uid`.
   - `authorRole`: Derived strictly from trusted server record (`admins/{callerUid}.role`).
   - Client attempts to supply `authorUid`, `authorRole`, or `canteenId` are rejected via unknown field validation.
5. **Atomic Audit Appending**: Each note creation atomically creates an audit event in `orders/{orderId}/auditEvents`.

---

## 3. Firestore Security Rules

Direct client access to `operationalNotes` is completely disabled:
```javascript
match /orders/{orderId}/operationalNotes/{noteId} {
  allow read, write: if false;
}
```
All reading occurs via `getOperationalOrderDetails` and all writing occurs via `createOperationalNote`.
