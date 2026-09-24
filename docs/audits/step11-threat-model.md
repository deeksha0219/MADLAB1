# GrabNGo Step 11: Threat Model and Trust Boundaries

## 1. System Context & Overview

Step 11 introduces operational roles (`service_desk` alongside `canteen_admin`), a touch-screen kiosk/monitor interface for service-desk attendants, order queue retrieval, exact search, operational notes, and audit history.

All client-supplied parameters are treated as untrusted and potentially hostile. The system enforces server-authoritative state transitions, strict canteen isolation, and callable-only Firestore access for sensitive operational data.

---

## 2. Threat Actors & Scenarios

| Threat Actor | Capabilities & Motivations | Potential Attack Vectors |
| --- | --- | --- |
| **Malicious Student** | Authenticated as student; seeks free food, unauthorized queue insight, or order tampering. | - Call operational callables directly with forged roles or canteen IDs.<br>- Attempt to read operational notes or audit events via direct Firestore queries.<br>- Forge status transitions (e.g. marking order `ready_for_pickup` or `completed`).<br>- Read or manipulate orders belonging to other students. |
| **Rogue or Cross-Canteen Staff** | Authenticated staff assigned to Canteen A; attempts to view or modify Canteen B orders. | - Pass Canteen B's `canteenId` to `listOperationalOrders`, `searchOperationalOrders`, or `transitionOperationalOrderStatus`.<br>- Attempt cross-canteen search to discover order IDs.<br>- Add deceptive operational notes to another canteen's orders. |
| **Inactive / Deactivated Operator** | Former employee whose account status is marked `inactive`. | - Use cached ID tokens to perform status transitions or view active queues.<br>- Submit notes or tamper with orders post-revocation. |
| **Network Attacker / Replay** | Intercepts or repeats legitimate operator requests. | - Replay `transitionOperationalOrderStatus` requests.<br>- Race concurrent transitions on the same order to trigger inconsistent state or duplicate notifications. |
| **Kiosk / Touchscreen Physical Attacker** | Unauthorized person approaching an unattended service-desk touch kiosk. | - Exploit virtual keyboard to inject commands, SQL/NoSQL payloads, or control characters.<br>- Inspect local storage for retained order details, customer PII, or credentials.<br>- Attempt privilege escalation through keyboard toggles. |

---

## 3. Trust Boundaries & Server-Authoritative Derivations

The client is completely untrusted. The server must derive or authoritatively verify all security-critical context:

```
[Untrusted Client / Touch Kiosk]
       │
       │ (context.auth.uid, payload)
       ▼
[Cloud Functions Security Layer]
       ├── 1. Verify context.auth.uid != null
       ├── 2. Fetch admins/{callerUid} from Firestore
       │       - Verify status === 'active'
       │       - Derive callerRole: 'canteen_admin' | 'service_desk' | 'platform_operator'
       │       - Derive assignedCanteens: string[]
       ├── 3. For target order:
       │       - Read order doc in transaction
       │       - Derive order.canteenId
       │       - Assert order.canteenId IN assignedCanteens
       │       - Derive currentStatus & currentPaymentStatus
       ├── 4. Evaluate Server State Machine:
       │       - Assert transition(currentStatus, targetStatus) is valid
       │       - Assert role allows operation
       └── 5. Transactional Commit:
               - Update order status, updatedAt (serverTimestamp)
               - Append audit event (actorUid = callerUid, actorRole = callerRole)
               - Release pickup capacity if cancelled/rejected
               - Zero mutation of payment records
```

### Table of Invariants

| Attribute | Client Claim (Untrusted) | Server Derivation (Trusted) |
| --- | --- | --- |
| **Caller UID** | Ignored | `context.auth.uid` from Firebase Auth token |
| **Caller Role** | Ignored | Stored in `admins/{callerUid}.role` |
| **Account Status** | Ignored | Stored in `admins/{callerUid}.status` (`active`) |
| **Canteen Assignment** | Ignored | Stored in `admins/{callerUid}.canteenIds` |
| **Order Canteen ID** | Ignored | Stored in `orders/{orderId}.canteenId` |
| **Current Status** | Ignored | Stored in `orders/{orderId}.status` |
| **Payment Status** | Ignored | Stored in `orders/{orderId}.paymentStatus` |
| **Note Author UID** | Ignored / Rejected | `context.auth.uid` |
| **Note Author Role** | Ignored / Rejected | Derived from `admins/{callerUid}.role` |
| **Audit Actor UID** | Ignored / Rejected | `context.auth.uid` |
| **Audit Actor Role** | Ignored / Rejected | Derived from `admins/{callerUid}.role` |
| **Timestamps** | Ignored | `FieldValue.serverTimestamp()` |

---

## 4. Specific Attack Mitigation Strategies

### 4.1 Cross-Canteen Leakage in Search
- **Risk**: An operator in Canteen A searches for an order ID belonging to Canteen B to determine if an order exists or probe customer activity.
- **Mitigation**: `searchOperationalOrders` verifies that the matching order's `canteenId` is in the caller's assigned `canteenIds`. If not assigned or not found, it returns a generic not-found response (`404 not-found` or `{ found: false, order: null }`), leaking zero information regarding whether the order exists in another canteen.

### 4.2 Stale Queue Data and Concurrent Status Updates
- **Risk**: Two attendants simultaneously view an order as `preparing` and both attempt to mark it `ready_for_pickup` or `cancelled`.
- **Mitigation**: Status transitions run inside a Firestore transaction. The transaction asserts the precondition `currentStoredStatus === expectedSourceStatus`. Exactly one transition commits; concurrent or replayed attempts receive an idempotent success or a precondition error, preventing duplicate capacity releases or notification spam.

### 4.3 Virtual Keyboard Security
- **Risk**: In-screen virtual keyboard is abused to intercept credentials or manipulate system input.
- **Mitigation**:
  1. Virtual keyboard only inserts characters into designated, focused search inputs.
  2. Virtual keyboard is never attached to password, OTP, or sensitive profile fields.
  3. No keystrokes are ever logged, sent to analytics, or written to Firestore.
  4. Toggle state (`In-Screen Keyboard: ON/OFF`) is purely a local client UI setting. It cannot bypass authentication or elevate user privileges.
  5. Search input is trimmed, bounded to max 64 characters, and control characters are stripped.

### 4.4 Operational Notes Injection
- **Risk**: An operator writes an excessively large note, attempts to inject scripts, or stores raw payment data / credentials in notes.
- **Mitigation**:
  1. `createOperationalNote` enforces length bounds (1 to 1000 characters).
  2. Control characters (except standard newlines/spaces) are stripped.
  3. Notes are restricted to operational comments; client cannot write to payments or modify order state.
  4. Direct client write to `orders/{orderId}/operationalNotes` is rejected by Firestore Rules (`allow write: if false`).
