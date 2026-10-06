# GrabNGo — Comprehensive Security Threat Model

## 1. Threat Modeling Scope & Methodology

This threat model evaluates the GrabNGo application architecture across its untrusted clients (React Native mobile app, web service desk), network transports (HTTPS callables and webhooks), and data layer (Firebase Auth, Cloud Firestore, and Cloud Functions). 

Each threat persona is assessed against STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) and evaluated for impact across:
- **Confidentiality (C):** Protection of personal student data, financial references, supplier cost data, and internal operational notes.
- **Integrity (I):** Immutability of order pricing, payment state, refund state, pickup capacity, and audit logs.
- **Availability (A):** Resilience against resource exhaustion, locking loops, and transaction starvation within authorized local boundaries.
- **Privacy (P):** Minimization and masking of phone numbers, student UIDs, and personal browsing history.
- **Financial (F):** Prevention of price tampering, double-refunding, unearned capacity capture, or phantom payments.
- **Operational (O):** Protection against cross-canteen queue contamination and unauthorized order status transitions.

---

## 2. Threat Actor Personas & Attack Scenarios

### 2.1 Persona 1: Unauthenticated External Attacker
- **Objective:** Access student profiles, read order queues, manipulate inventory, or execute backend mutations without credentials.
- **Attack Vectors:** Direct invocations of HTTPS Callables without Bearer tokens, unauthenticated REST/gRPC queries to Firestore emulator, or sending spoofed webhook requests.
- **Defenses & Controls:**
  - `firestore.rules` enforces `isAuthenticated()` across all top-level user, admin, order, and canteen documents.
  - All Cloud Functions check `context.auth` at the first line of execution and immediately abort with `HttpsError('unauthenticated')`.
  - `verifySyntheticWebhook` enforces HMAC-SHA256 signature verification over raw body using `x-synthetic-signature`.
- **Assessed Impact:** Low residual risk within authorized local emulator boundary.

### 2.2 Persona 2: Authenticated Student Attempting Privilege Escalation
- **Objective:** Modify personal profile to grant `role: 'canteen_admin'` or `role: 'platform_operator'`, create records in `/admins`, or execute staff administrative functions.
- **Attack Vectors:** Direct Firestore `update` call with `{ role: 'canteen_admin' }`, direct `set` on `/admins/{uid}`, or invoking staff callables (`updateCanteen`, `transitionOrderStatus`).
- **Defenses & Controls:**
  - `firestore.rules` explicitly prohibits direct creation in `/users` and `/admins`. Profile updates in `users/{userId}` are strictly limited via `.affectedKeys().hasOnly(['name', 'collegeId', 'updatedAt'])`.
  - Staff functions query `/admins/{context.auth.uid}` in Firestore via Admin SDK and verify `status == 'active'` and appropriate role (`canteen_admin`, `platform_operator`, or `service_desk`).
- **Assessed Impact:** Controlled; zero escalation permitted.

### 2.3 Persona 3: Student Attempting IDOR (Insecure Direct Object Reference)
- **Objective:** View or modify another student's cart, active orders, order history, payment records, or notifications.
- **Attack Vectors:** Passing another student's `studentUid` in `createOrder`, calling `orders/{orderId}` with an arbitrary ID, querying `/users/{victimUid}/cart`, or invoking `listMyNotifications`.
- **Defenses & Controls:**
  - Server-derived UID: `createOrder`, `createDemoPayment`, and `listMyNotifications` derive the customer identity exclusively from `context.auth.uid`. Any client-supplied `studentUid` is rejected as an invalid/unknown field.
  - Firestore Rules enforce `resource.data.studentUid == request.auth.uid` for order reads and `isOwner(userId)` for user subcollections.
  - Cart-backed checkout validates that all submitted items exist in the authenticated caller's own cart subcollection (`/users/{callerUid}/cart`).
- **Assessed Impact:** Controlled; IDOR attempts fail closed with `permission-denied` or `not-found`.

### 2.4 Persona 4: Canteen Admin Attempting Cross-Canteen Access
- **Objective:** Admin assigned to Canteen A (`BIG_MINGOS`) attempts to inspect, modify, transition orders, or manage categories for Canteen B (`LIBRARY_CANTEEN`).
- **Attack Vectors:** Calling `transitionOrderStatus` for an order belonging to Canteen B, requesting queue for Canteen B, or querying private supplier data under Canteen B.
- **Defenses & Controls:**
  - All admin functions verify that `targetCanteenId in adminDoc.canteenIds`.
  - In `transitionOrderStatus`, the function reads the target order doc, extracts `order.canteenId`, and checks membership in caller's assigned `canteenIds`.
  - `firestore.rules` helper `isCanteenAdmin(canteenId)` checks `canteenId in get(/admins/$(request.auth.uid)).data.canteenIds`.
- **Assessed Impact:** Controlled; cross-canteen queries return `permission-denied` or generic `not-found`.

### 2.5 Persona 5: Service-Desk Operator Overreach
- **Objective:** Service-desk operator attempts to modify menu item pricing, create new categories, alter canteen settings, or trigger manual refunds without authorization.
- **Attack Vectors:** Calling catalog management functions (`updateMenuItem`, `createCategory`) or payment/refund endpoints (`requestDemoRefund`).
- **Defenses & Controls:**
  - Role separation: Catalog management and refund functions strictly require `adminDoc.role === 'canteen_admin'` or `platform_operator`.
  - Service desk role is restricted strictly to operational tasks: `listOperationalOrders`, `searchOperationalOrders`, `getOperationalOrderDetails`, `transitionOperationalOrderStatus`, and `createOperationalNote`.
- **Assessed Impact:** Controlled; service desk users are denied administrative mutations with HTTP 403.

### 2.6 Persona 6: Inactive / Revoked Operator with Stale Token
- **Objective:** Staff member whose access was revoked or account deactivated uses an unexpired JWT session to access customer orders or change statuses.
- **Attack Vectors:** Inactive admin sends requests with cached Firebase Auth ID token before token expiration.
- **Defenses & Controls:**
  - Dynamic Firestore status verification: Functions do not rely solely on static JWT custom claims; every callable queries the live `/admins/{uid}` document in Firestore and asserts `adminDoc.status === 'active'`.
  - Deactivating an admin record (`status: 'inactive'`) immediately revokes access on the next request.
- **Assessed Impact:** Controlled; immediate revocation upon database status update.

### 2.7 Persona 7: Platform Operator Overreach
- **Objective:** Platform operator executes arbitrary state changes without auditing or bypasses canteen isolation improperly.
- **Attack Vectors:** Calling `createCanteen` or `assignAdminRole` with malicious parameters.
- **Defenses & Controls:**
  - Platform operator actions are restricted to designated administrative functions (`createCanteen`, `assignAdminRole`).
  - Strict input validation on role assignments (allowlisted roles: `canteen_admin`, `service_desk`, `platform_operator`).
  - Immutable audit trail records in Firestore.
- **Assessed Impact:** Low residual risk; auditable within backend logs.

### 2.8 Persona 8: Malicious or Outdated Client
- **Objective:** Manipulate client UI code to submit fabricated order totals, bypass client-side validation, submit negative quantities, or alter currency.
- **Attack Vectors:** Submitting custom payloads to `createOrder` with `{ priceInPaise: 1, totalAmountInPaise: 1 }`, negative `quantity: -5`, or `currency: 'USD'`.
- **Defenses & Controls:**
  - Server-Authoritative Pricing: `createOrder` ignores all client-supplied pricing. Prices and totals are computed server-side directly from authoritative catalog items in Firestore.
  - Strict input schema: Any client attempt to provide `price`, `total`, `studentUid`, or `pickupTime` causes an immediate `invalid-argument` rejection.
  - Cart quantities are validated server-side as positive integers between 1 and 99.
- **Assessed Impact:** Controlled; client-supplied financial values are completely rejected.

### 2.9 Persona 9: Replay Attacker
- **Objective:** Replay legitimate network requests (order checkout, payment completion, refund request, status transition) to duplicate orders or financial events.
- **Attack Vectors:** Resending identical HTTPS payloads or replaying synthetic webhook events.
- **Defenses & Controls:**
  - Idempotency Keys: `createOrder` and `createDemoPayment` bind idempotency keys to `(studentUid, idempotencyKey)` and store request fingerprints.
  - Deterministic Event IDs: Status transitions and payment history write to deterministic document paths (e.g., `/statusHistory/{orderId}_{from}_{to}`). Replays detect existing records and return `isRetry: true` or `isIdempotent: true` without performing duplicate state mutations.
  - Webhook deduplication: Global deduplication collection `/webhookEvents/demo:{eventId}` claims the event ID transactionally.
- **Assessed Impact:** Controlled; replay attacks produce idempotent responses with zero duplicated side-effects.

### 2.10 Persona 10: Concurrent Request Attacker (Race Conditions)
- **Objective:** Fire simultaneous requests to deplete pickup slot capacity beyond limits, complete an order twice, or double-refund.
- **Attack Vectors:** High-concurrency parallel HTTP POST requests with the same or distinct idempotency keys.
- **Defenses & Controls:**
  - Firestore Transactions: Pickup slot capacity reservation and release are executed within atomic `db.runTransaction` blocks.
  - Precondition checks: Transactions verify `reservedCount < capacity` before incrementing, and `reservedCount >= 1` before decrementing.
  - Terminal state locking: Order status transitions verify that the order is not in a terminal state (`completed`, `cancelled`, `rejected`).
- **Assessed Impact:** Controlled; proved by concurrency test suites (Groups 8 & 9 of Order and Status tests).

### 2.11 Persona 11: Malformed or Oversized Input Sender
- **Objective:** Trigger uncaught exceptions, stack disclosures, memory exhaustion, or prototype pollution via malformed payloads.
- **Attack Vectors:** Supplying arrays, deeply nested objects, prototype-pollution keys (`__proto__`, `constructor`), control characters, or oversized strings.
- **Defenses & Controls:**
  - Strict type and shape assertions in Cloud Functions before processing.
  - String sanitization: Stripping newlines, control characters, and bounding lengths (e.g., search queries bounded to 64 chars; notes bounded to 1000 chars).
  - Unknown field rejection: Endpoints validate that payload keys match an exact allowlist.
- **Assessed Impact:** Controlled; non-destructive fuzzing passed without unhandled exceptions.

### 2.12 Persona 12: Compromised Kiosk / Browser User
- **Objective:** Service-desk operator leaves browser unattended, or malicious student uses browser history/back navigation to access operator queue.
- **Attack Vectors:** Exploiting hardcoded sessions, extracting tokens from LocalStorage, or using Android back button to re-enter authenticated views.
- **Defenses & Controls:**
  - Local virtual touchscreen keyboard (`TouchKeyboard.tsx`) never captures passwords or OTPs, runs purely in-app memory, and does not persist typed text.
  - Web client (`web/index.html`) masks customer UIDs in search and queue displays (`student_...ce_8`).
  - *Identified Vulnerability:* `web/server.js` exposes unauthenticated `GET /api/token` minting `TEST_OPERATOR` tokens for local testing. (See Finding 1).
- **Assessed Impact:** Medium in development/local emulator; High if deployed without authentication to staging/production.

### 2.13 Persona 13: Insider with Legitimate Access
- **Objective:** Rogue staff member inspects wholesale supplier prices or alters order statuses maliciously.
- **Attack Vectors:** Legitimate canteen admin queries `/canteens/{id}/items/{id}/private/admin` or cancels orders out of spite.
- **Defenses & Controls:**
  - Private wholesale data is strictly isolated in `/private/admin` subcollection and readable only by assigned active admins.
  - Every order status transition writes an immutable audit record to `/statusHistory` containing `actorUid`, `timestamp`, `fromStatus`, `toStatus`, and `reason`.
- **Assessed Impact:** Low residual risk; full non-repudiation audit trail.

### 2.14 Persona 14: Attacker Observing Client Responses & Logs
- **Objective:** Intercept or extract sensitive credentials, HMAC secrets, provider references, or student PII from application logs or error messages.
- **Attack Vectors:** Monitoring console output, inspecting network error responses, or reviewing debug logs.
- **Defenses & Controls:**
  - Generic error messages: Functions throw `HttpsError` with sanitized descriptions.
  - Zero sensitive logging: Logs exclude passwords, OTPs, auth tokens, HMAC secrets, and raw webhook payloads.
  - Search responses mask student UIDs and suppress sensitive financial attributes (`providerReference`).
- **Assessed Impact:** Controlled; error responses and logs are sanitized.

---

## 3. Asset Impact & Classification Matrix

| Asset | Confidentiality (C) | Integrity (I) | Availability (A) | Privacy (P) | Financial (F) | Operational (O) | Primary Defense |
|---|---|---|---|---|---|---|---|
| Student Profiles (`/users`) | High | High | Medium | Critical | Low | Medium | Owner-only Firestore rules, strict field allowlist |
| Admin Records (`/admins`) | High | Critical | High | Medium | Medium | Critical | Server SDK-only write, live status query |
| Menu Catalog & Pricing | Low | Critical | High | Low | Critical | High | Server-side pricing snapshot, Admin SDK-only write |
| Private Item Data (`/private`) | High | High | Medium | Low | Medium | Low | Subcollection isolation, assigned admin only |
| Pickup Slots & Capacity | Low | Critical | High | Low | Low | Critical | Atomic transactions, non-negative capacity bounds |
| Orders & Snapshots (`/orders`) | High | Critical | High | High | Critical | Critical | Immutable snapshots, strict state machine |
| Payments & History (`/payments`)| Critical | Critical | High | High | Critical | High | Callable-only access, state separation |
| In-App Notifications (`/notifications`)| Medium | Medium | Medium | Medium | Low | Medium | Callable-only policy, cursor-based batching |
| Operational Notes & Audit | Medium | Critical | Medium | Low | Low | High | Append-only audit events, bounded note text |
| Webhook Deduplication (`/webhookEvents`)| High | Critical | High | Low | Critical | High | HMAC-SHA256, transactional event claiming |
