# GrabNGo — Deep Security Engineering Audit Report

```
========================================================================================
SECURITY AUDIT — NON-DESTRUCTIVE, LOCAL/EMULATOR ONLY
REPORT AND TESTS ONLY — DO NOT MODIFY APPLICATION CODE
========================================================================================
```

## 1. Executive Summary

A comprehensive, evidence-driven application security audit of the GrabNGo mobile application, backend Cloud Functions, Firestore Security Rules, and local service-desk operations was performed against the `development` branch within an isolated Firebase Emulator Suite environment.

Across **625 verified automated test assertions** (63 Jest unit/scaffold tests, 562 live Firebase Emulator security and contract tests) and exhaustive manual code inspection:
- **Zero High or Critical vulnerabilities** were identified in the production-deployable codebase.
- **Server-authoritative state, pricing, and access controls** proved exceptionally robust: price-tampering is impossible from untrusted clients, order and payment states are strictly decoupled, pickup capacity release is protected against underflow and double-release, and all in-app notifications adhere to a strict callable-only policy.
- **One Medium finding (`SEC-01`)** was confirmed in the untracked local developer harness (`web/server.js`), which exposes an unauthenticated token minting route designed for local kiosk testing.
- **One Low finding (`SEC-02`)** was confirmed regarding development toolchain dependencies flagged by `npm audit`.
- **One Informational hardening recommendation (`SEC-03`)** was identified in `firestore.rules` regarding staff role differentiation for private supplier data.

**Final Audit Classification:** **`REMEDIATION REQUIRED — CONFIRMED MEDIUM FINDINGS`** (driven by the local service-desk token harness requiring hardening prior to staging/production deployment).

---

## 2. Scope and Authorization

- **Authorized Repository:** `GrabNGo/MADLAB1`
- **Authorized Branch:** `development` (Commit `8d57da3`)
- **Authorized Scope:**
  - React Native Mobile Client (`src/`)
  - Web Service Desk Operator Client (`web/`)
  - Cloud Functions Backend (`functions/src/`)
  - Cloud Firestore Security Rules (`firestore.rules`)
  - Firebase Emulator Suite (`Auth: 9099`, `Firestore: 8085`, `Functions: 5001`, `Hub: 4400`)
- **Posture:** Strictly non-destructive, local emulator only. Zero code modifications or deployment commands executed.

---

## 3. Explicit Exclusions

The following environments, systems, and testing methodologies were strictly prohibited and excluded from this audit:
- Live Firebase deployment (`firebase deploy`).
- Staging or production Firebase projects.
- Production user accounts and customer data.
- Live payment gateways (Razorpay, Paytm, PhonePe, Google Pay, UPI networks).
- Third-party telecommunication providers (SMS gateways, OTP delivery networks).
- Push notification delivery services (Firebase Cloud Messaging, Apple Push Notification service).
- Destructive testing, denial-of-service, or network flooding.
- Physical device biometric sensors or native hardware tampering.

---

## 4. Environment and Branch Baseline

- **Repository:** `GrabNGo/MADLAB1`
- **Branch:** `development`
- **Working Tree:** Clean with untracked local developer tool `?? web/`
- **Local Runtime:** Node.js v22.11.0 on Windows 11
- **Firebase Project ID:** `demo-grabngo-local`
- **Emulators:** Auth (`127.0.0.1:9099`), Firestore (`127.0.0.1:8085`), Functions (`127.0.0.1:5001`)

---

## 5. Baseline Command Results

All baseline commands were executed and recorded:

```bash
# 1. Typecheck: Exit Code 0
npm run typecheck

# 2. Lint: Exit Code 0 (0 errors, 203 style warnings)
npm run lint

# 3. Jest Test Suite: Exit Code 0 (11 suites passed, 63 tests passed)
npm test

# 4. Functions Build: Exit Code 0
npm --prefix functions run build

# 5. Live Emulator Security Suites: Exit Code 0 (562 assertions passed, 0 failed)
node scripts/run-emulator-rules-test.js          # 33 passed, 0 failed
node scripts/run-emulator-functions-test.js      # 54 passed, 0 failed
node scripts/run-emulator-order-test.js          # 64 passed, 0 failed
node scripts/run-emulator-status-test.js         # 65 passed, 0 failed
node scripts/run-emulator-payment-test.js        # 147 passed, 0 failed
node scripts/run-emulator-notifications-test.js  # 144 passed, 0 failed
node scripts/run-emulator-service-desk-test.js   # 55 passed, 0 failed
```

---

## 6. Asset and Request Inventory Summary

The complete inventory is documented in [asset-and-request-inventory.md](file:///e:/Madlab/MADLAB1/docs/audits/security/asset-and-request-inventory.md).
- **Client Interfaces:** 15 React Native screens (`src/screens/`) and 1 Web Service Desk dashboard (`web/index.html`).
- **Server Endpoints:** 35 HTTPS Callable Cloud Functions and 1 HTTPS onRequest Webhook handler (`verifySyntheticWebhook`).
- **Collections:** 21 distinct Firestore collections and subcollections protected by `firestore.rules`.
- **Policy:** Zero direct client write access to financial, operational, audit, or notification collections.

---

## 7. Threat Model Summary

The complete threat model is documented in [threat-model.md](file:///e:/Madlab/MADLAB1/docs/audits/security/threat-model.md).
Evaluated 14 threat actor personas across STRIDE and verified that client-side controls are never trusted for authorization, pricing, identity derivation, or capacity allocation.

---

## 8. Confirmed Findings

### Finding SEC-01 [Medium] — Unauthenticated Operator Token Minting Endpoint in Local Web Server

- **Status:** `CONFIRMED`
- **Affected environment:** `Local emulator only` / `Development build`
- **Affected component:** `web/server.js:54-68`
- **CWE or security category:** `CWE-306: Missing Authentication for Critical Function`, `CWE-798: Use of Hard-coded Credentials`
- **Business impact:** If `web/server.js` were mistakenly deployed to a staging or production hosting environment, any unauthenticated web visitor could obtain active `service_desk` administrative credentials, inspect active customer order queues, and transition order states.
- **Technical impact:** An unauthenticated HTTP `GET /api/token` generates a valid Firebase Auth custom token for `TEST_OPERATOR` (`uid: 0PSMEvTEJbgDo5xCX2BDI3waI0Re`, `role: 'service_desk'`) and exchanges it for a live Firebase Auth ID token against the Auth emulator.
- **Preconditions:** Node.js process executing `web/server.js` accessible via network.
- **Evidence:** `web/server.js`, lines 27–39 and 53–68:
  ```javascript
  if (req.url === '/api/token' && req.method === 'GET') {
    const idToken = await getOperatorIdToken();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, idToken, operator: TEST_OPERATOR }));
  }
  ```
- **Reproduction:** Execute `curl -s http://localhost:5050/api/token`. Server responds with HTTP 200 and a full Firebase Auth ID token.
- **Observed result:** Fresh, privileged Firebase Auth ID token returned to unauthenticated caller.
- **Expected secure result:** Tokens must never be minted via unauthenticated HTTP endpoints. Staff must authenticate via phone OTP or institutional SSO.
- **Exploitability:** Low on developer workstation (localhost only); High if deployed publicly.
- **Severity:** **Medium** (constrained to untracked local developer tool; would be Critical if deployed).
- **Recommended remediation:**
  1. Add `web/` to `.gitignore` or place under explicit `scripts/local/` development path.
  2. Implement real phone authentication or Firebase Auth UI in the web client before considering deployment.
  3. Ensure production deployment scripts explicitly omit `web/server.js`.
- **Regression test required:** Verify `web/server.js` is absent from production CI build artifacts.
- **Verification status:** Pending remediation.

---

### Finding SEC-02 [Low] — Development and Transitive Dependency Vulnerabilities

- **Status:** `CONFIRMED`
- **Affected environment:** `Development build` / `Local emulator only`
- **Affected component:** Root `package.json` (`metro`, `ws`, `shell-quote`, `protobufjs`, `image-size`) and `functions/package.json` (`uuid` via `firebase-admin`)
- **CWE or security category:** `CWE-1395: Dependency on Vulnerable Third-Party Component`
- **Business impact:** Potential development environment denial-of-service or build-time parser disruption. Zero direct exploitability against mobile app end-users.
- **Technical impact:** Root audit reported 34 vulnerabilities (2 low, 15 moderate, 15 high, 2 critical in CLI tooling); Functions audit reported 9 moderate vulnerabilities in transitive `uuid` (<11.1.1).
- **Preconditions:** Attacker provides malicious build input or exploits local development dev-server.
- **Evidence:** `npm audit` and `npm --prefix functions audit` console logs.
- **Observed result:** Known CVEs present in developer dependencies.
- **Expected secure result:** Zero high/critical dependency vulnerabilities in dependency tree.
- **Exploitability:** Low.
- **Severity:** **Low**.
- **Recommended remediation:** Upgrade `@react-native-community/cli`, `metro`, and update `firebase-admin` once compatible releases are tested.
- **Regression test required:** Automated CI audit gate: `npm audit --audit-level=high`.
- **Verification status:** Pending dependency update.

---

### Finding SEC-03 [Informational] — Firestore Rules Helper `isCanteenAdmin` Lacks Explicit Role Check

- **Status:** `CONFIRMED`
- **Affected environment:** `Local emulator only` / `Staging if deployed` / `Production if deployed`
- **Affected component:** `firestore.rules:124-129`
- **CWE or security category:** `CWE-285: Improper Authorization`
- **Business impact:** Service-desk operators possessing an active record in `/admins/{uid}` with assigned canteen IDs could theoretically read catalog private wholesale cost data (`items/{itemId}/private/{docId}`) via direct Firestore client queries.
- **Technical impact:** Helper `isCanteenAdmin(canteenId)` checks document existence, `status == 'active'`, and canteen ID membership, but omits an explicit check that `data.role == 'canteen_admin'`.
- **Preconditions:** Authenticated user with an active document in `/admins/{uid}` having `role == 'service_desk'`.
- **Evidence:** `firestore.rules`, lines 124–129:
  ```javascript
  function isCanteenAdmin(canteenId) {
    return isAuthenticated()
      && exists(/databases/$(database)/documents/admins/$(request.auth.uid))
      && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.status == 'active'
      && (canteenId in get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.canteenIds);
  }
  ```
- **Observed result:** Any active staff record assigned to the canteen satisfies `isCanteenAdmin` in security rules.
- **Expected secure result:** Defense-in-depth separation between catalog administrators and service-desk operators in Firestore Rules.
- **Exploitability:** Low (requires pre-existing active staff account).
- **Severity:** **Informational**.
- **Recommended remediation:** Update `firestore.rules` to explicitly verify `&& get(...).data.role == 'canteen_admin'` for private catalog subcollections.
- **Verification status:** Pending hardening.

---

## 9. Likely and Potential Findings

- **POTENTIAL: Mobile App Reverse Engineering and Network Interception:** In production builds, React Native JS bundles can be unpacked and network traffic intercepted unless SSL Certificate Pinning and ProGuard/R8 obfuscation are enabled. *Status: NOT TESTED (requires production release APK/IPA build).*

---

## 10. Investigated-but-Rejected Concerns

1. **Client Price Tampering in `createOrder`:**
   - *Hypothesis:* Client can submit modified `priceInPaise` or `totalAmountInPaise`.
   - *Investigation:* Source inspection (`functions/src/index.ts:700-750`) and test execution (`run-emulator-order-test.js:148`) verified that any client-supplied `price` or `total` causes an immediate `invalid-argument` error. All pricing is computed server-side from immutable catalog docs.
   - *Conclusion:* **NOT A VULNERABILITY.**

2. **Pickup Capacity Double-Release or Underflow:**
   - *Hypothesis:* Repeated order cancellations could decrement `reservedCount` below zero.
   - *Investigation:* Source inspection (`functions/src/index.ts`) and test execution (`run-emulator-status-test.js:112-140`) proved capacity release requires atomic transaction check `reservedCount >= 1`. Repeated or concurrent cancellations decrement capacity at most once (`isIdempotent: true`).
   - *Conclusion:* **NOT A VULNERABILITY.**

3. **In-App Notification Tampering via Direct Firestore Access:**
   - *Hypothesis:* Student could forge notifications or delete notifications via Firestore SDK.
   - *Investigation:* Firestore Rules line 94 (`allow read, write: if false`) and test execution (`run-emulator-notifications-test.js:85`) proved that direct client reads and writes are strictly denied. All interactions must use Cloud Functions.
   - *Conclusion:* **NOT A VULNERABILITY.**

4. **Service Desk Virtual Keyboard Keystroke Logging:**
   - *Hypothesis:* In-app virtual keyboard could log keystrokes or store search history.
   - *Investigation:* `TouchKeyboard.tsx` code review confirmed zero `AsyncStorage`, zero network calls, zero analytics, and zero password/OTP inputs.
   - *Conclusion:* **NOT A VULNERABILITY.**

---

## 11. Core Domain Security Results

### 11.1 Authentication Results
- Verified phone authentication and E.164 normalization.
- Verified that client profiles cannot be created directly in Firestore; must use `createStudentProfile`.
- Verified that inactive/suspended users are blocked dynamically by both Cloud Functions and `AccessDeniedScreen`.
- Confirmed zero hardcoded production passwords or secret keys.

### 11.2 Authorization & IDOR Results
- Server-derived identity: Functions derive `callerUid` strictly from `context.auth.uid`.
- Canteen isolation: Admin functions verify `order.canteenId in adminDoc.canteenIds`. Cross-canteen queue queries and order transitions fail closed with HTTP 403.
- Exact search masking: Searching an order belonging to another canteen returns generic `found: false` without leaking existence. Customer UIDs are masked (`student_...ce_8`).

### 11.3 Firestore Rules Results
- All 21 collections and subcollections enforce strict least-privilege access.
- Direct client writes to `/orders`, `/payments`, `/paymentHistory`, `/operationalNotes`, `/auditEvents`, and `/notifications` are completely blocked (`allow write: if false`).

### 11.4 Input Validation Results
- Unknown/unexpected fields in callable payloads are strictly rejected.
- String boundaries: Search queries bounded to 64 chars; operational notes bounded to 1000 chars; control characters and HTML tags sanitized.
- Numeric boundaries: Quantities bounded (1-99); prices bounded (<= 500,000 paise); negative and floating-point amounts rejected.

### 11.5 Order, Cart, and Pickup Capacity Results
- Cart-backed checkout validates that submitted items exist in the student's personal cart.
- Server-side transaction locks pickup slot and increments `reservedCount` atomically.
- Cancellation decrements capacity transactionally with underflow protection (`reservedCount >= 1`).
- Historical order snapshots are immutable.

### 11.6 Payment & Webhook Results
- Strict state separation: `order.status` is decoupled from `order.paymentStatus` and `refundStatus`.
- Payment failure or expiry resets payment state while keeping order status as `placed`.
- Synthetic webhook verifies HMAC-SHA256 signature over raw body; deduplicates events via `/webhookEvents/demo:{eventId}`.
- Refund references are strictly separated from original payment references.

### 11.7 Notification Results
- Strict callable-only access policy (`listMyNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getUnreadNotificationCount`).
- Bounded cursor-based batching for bulk operations (500 items max per batch).
- Deterministic notification IDs prevent duplicates; conflicting deterministic payloads fail closed.
- Templates sanitize order IDs and contain zero sensitive financial or auth tokens.

### 11.8 Service Desk & Touchscreen Results
- In-app virtual touchscreen keyboard is self-contained, memory-only, and disabled during in-flight network requests.
- Staff operational notes are bounded to 1000 characters and write immutable audit events.
- Cross-canteen queue queries return HTTP 403.

---

## 12. Race, Replay, and Concurrency Results

| Test Scenario | Concurrency Level | Invariant Enforced | Observed Result | Evidence |
|---|---|---|---|---|
| Concurrent `createOrder` | 2 parallel calls | Same idempotency key yields identical order | Exactly 1 order created; no duplicate slot reservation | `run-emulator-order-test.js:210` |
| Idempotency Key Reuse | Sequential | Key reuse with modified payload fails | Rejected with `ALREADY_EXISTS` | `run-emulator-order-test.js:202` |
| Concurrent Order Transitions | 2 parallel calls | At most one authoritative transition commits | 1 transition committed, 1 idempotent replay | `run-emulator-service-desk-test.js:185` |
| Concurrent Capacity Releases | 2 parallel calls | Cancellation decrements capacity at most once | Capacity decremented exactly once (4 -> 3) | `run-emulator-status-test.js:135` |
| Webhook / Callable Race | Concurrent | Succeeded payment event committed at most once | Exactly 1 payment success & 1 notification | `run-emulator-notifications-test.js:195` |
| Webhook Replay | Sequential | Deduplication document claims event ID | Replay returns HTTP 200 with zero duplicate writes | `run-emulator-payment-test.js:240` |

---

## 13. Logging, Privacy, and Secret Results

- Verified zero logging of passwords, OTPs, auth tokens, HMAC secrets, or raw webhook bodies.
- Customer UIDs in service-desk queues and search results are masked (`student_...ce_8`).
- Codebase secret scan verified zero private keys (`BEGIN RSA`), service account JSONs, or active API secrets in git tracking.

---

## 14. Untested Areas and Scope Limitations

The following areas could not be tested within the authorized local emulator scope:
1. **Live Payment Gateway Network:** Real Razorpay API contracts, live webhooks, payment capture, and bank settlement.
2. **Push Notification Infrastructure:** Real APNs / FCM delivery on physical iOS/Android hardware.
3. **Native Mobile Binary Security:** ProGuard/R8 bytecode obfuscation, SSL certificate pinning, and root/jailbreak detection.
4. **Third-Party Telephony:** Live SMS OTP delivery rates and carrier latency.
5. **High-Volume Denial of Service:** Distributed load testing, CDN cache eviction, and network-level DDoS resistance.

---

## 15. Remediation Priorities

1. **Immediate Priority (P1):** Restrict `web/server.js` strictly to local testing, exclude from production build paths, and implement real operator authentication in the web client prior to any staging deployment.
2. **Near-Term Priority (P2):** Upgrade development toolchain packages (`@react-native-community/cli`, `metro`, `ws`) to resolve moderate/high/critical dependency advisories.
3. **Hardening Priority (P3):** Add explicit `data.role == 'canteen_admin'` checks in `firestore.rules` for catalog private subcollections.

---

## 16. Final Risk Conclusion

```
========================================================================================
REMEDIATION REQUIRED — CONFIRMED MEDIUM FINDINGS
========================================================================================
```

**Conclusion Rationale:**
The core GrabNGo mobile application, backend Cloud Functions, and Firestore security rules successfully withstood all tested attack classes within the authorized local emulator scope. However, because an unauthenticated operator token minting endpoint exists in the local service-desk web server (`web/server.js`), this audit issues a **`REMEDIATION REQUIRED`** decision until that endpoint is secured or explicitly segregated from deployable builds.

---

## 17. Mandatory Final Honesty Statement

```
This audit does not prove that GrabNGo is impossible to hack. It records the security properties and attack classes tested within the authorized non-destructive local/emulator scope. Staging, production, real devices, real payment providers, external infrastructure, denial-of-service behavior, and destructive testing were not assessed unless explicitly listed as tested. Any future testing outside this scope requires separate authorization and an isolated environment.
```
