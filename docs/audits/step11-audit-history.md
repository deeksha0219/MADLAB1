# GrabNGo Step 11: Immutable Audit History

## 1. Overview & Data Model

Step 11 establishes append-only, tamper-evident audit logging for operational order actions.

### 1.1 Firestore Storage Path
```
orders/{orderId}/auditEvents/{eventId}
```

### 1.2 Schema Definition
```typescript
interface OrderAuditEvent {
  eventId: string;
  orderId: string;
  canteenId: string;
  eventType: string; // e.g. "order_status_accepted", "operational_note_created"
  fromStatus?: string;
  toStatus?: string;
  actorUid: string;
  actorRole: 'student' | 'canteen_admin' | 'service_desk' | 'platform_operator';
  reason?: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: FirebaseFirestore.Timestamp;
}
```

---

## 2. Immutability & Event ID Determinism

1. **Deterministic Event IDs**:
   - Status transitions use deterministic keys: `${orderId}_${fromStatus}_to_${toStatus}`.
   - Note additions use `${orderId}_note_${noteId}`.
2. **Append-Only Invariant**:
   - Audit documents can never be updated or deleted.
   - Direct client writes are rejected by Firestore Rules:
     ```javascript
     match /orders/{orderId}/auditEvents/{eventId} {
       allow read, write: if false;
     }
     ```
3. **Actor Integrity**:
   - `actorUid` and `actorRole` are determined strictly by server verification; client forgery attempts are impossible.
   - Replayed operations produce idempotent outcomes without generating duplicate audit entries.
