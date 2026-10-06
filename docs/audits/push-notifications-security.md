# GrabNGo — Push Notifications Security & Privacy Audit Report

**Date:** 2026-10-02  
**Auditor / Security Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Verdict:** **PUSH-LOGIC-READY / REAL-DELIVERY-BLOCKED**  

---

## 1. Threat Modeling & Security Review

| Threat Persona / Vector | Attack Description | Applied Defense / Invariant | Verification Status |
|---|---|---|---|
| **P1: Attacker attempting direct Firestore token write** | Malicious client attempts `PATCH /users/{uid}/pushTokens/{tokenId}` | `firestore.rules` enforces `match /pushTokens/{tokenId} { allow read, write: if false; }`. Rejected with HTTP 403. | **PASS (Suite 16.10)** |
| **P2: Attacker attempting cross-user token read** | Student A attempts to read Student B's push tokens | Direct Firestore read rejected by rules (403). Server callables do not expose other users' tokens. | **PASS (Suite 16.9)** |
| **P3: Attacker passing forged recipient UID** | Malicious caller passes `recipientUid: "victim_uid"` to `registerPushToken` | Strict allowlist rejects unknown field `recipientUid` (HTTP 400). Server strictly binds `uid = context.auth.uid`. | **PASS (Suite 16.4)** |
| **P4: Token Flooding / Denial of Service** | Malicious user registers thousands of random tokens | Server-side bounded limit (`MAX_TOKENS_PER_USER = 5`). Automatically disables oldest tokens when threshold reached. | **PASS (Suite 16.18)** |
| **P5: Cross-User Token Deletion** | Student A attempts to unregister Student B's token ID | `unregisterPushToken` scopes search exclusively to `/users/{context.auth.uid}/pushTokens`. B's token is untouched. | **PASS (Suite 16.21)** |
| **P6: Eavesdropping on Push Payloads** | Attacker snoops lock screen notifications or push network traffic | Zero financial data, prices, payment secrets, bank references, OTPs, or customer PII are placed in push payloads. | **PASS (Audit Verified)** |
| **P7: Push Delivery Failure Cascading** | FCM provider outage or network timeout causes order rollback | Outbox worker wraps push attempt in isolated try/catch. In-app outbox delivery marks `delivered` independently. | **PASS (Suite 16.28)** |
| **P8: Raw Token Leaks in Logs** | Attacker gains access to Cloud Logging / structured telemetry | Telemetry logs mask UIDs (`usr_...ce_10`) and log only deterministic `tokenId` (32-char prefix hash). Never raw tokens. | **PASS (Code Verified)** |

---

## 2. Notification Type & Privacy Classification Matrix

| Event Type | In-App Stored | Push Enabled | Safe Push Content | Excluded Sensitive Fields |
|---|---|---|---|---|
| `order_placed` | Yes | Yes | `Order #B9A23D placed. Awaiting canteen confirmation.` | Price, line items, customer phone, raw UID |
| `payment_succeeded_demo` | Yes | Yes | `Demo payment for order #B9A23D verified. (Simulated payment; no real money transferred).` | Payment attempt ID, synthetic webhook secret, bank refs |
| `payment_failed` | Yes | Yes | `Demo payment attempt for order #B9A23D failed. Please retry payment.` | Internal failure traces, payment gateway refs |
| `order_accepted` | Yes | Yes | `Order #B9A23D has been accepted by the canteen.` | Customer UID, kitchen notes |
| `order_preparing` | Yes | Yes | `Order #B9A23D is being prepared by the canteen.` | Customer UID, kitchen internal staff IDs |
| `order_ready_for_pickup` | Yes | Yes | `Your order #B9A23D is ready. Please collect from the canteen.` | Pickup slot internal shard ID |
| `order_completed` | Yes | Yes | `Order #B9A23D has been completed. Enjoy your meal!` | Service-desk staff UID, audit log refs |
| `order_cancelled` | Yes | Yes | `Order #B9A23D was cancelled. Check app for details.` | Cancellation actor role, audit notes |
| `order_rejected` | Yes | Yes | `Order #B9A23D was rejected by the canteen.` | Internal rejection reason code |
| `refund_pending_demo` | Yes | Yes | `Demo refund for order #B9A23D initiated. Processing in progress.` | Transaction IDs, refund amounts |
| `refund_completed_demo` | Yes | Yes | `Demo refund for order #B9A23D completed. (Simulated refund).` | Account balances, ledger traces |

---

## 3. Data Protection & Cryptographic Review

1. **Token Protection at Rest:**
   - Raw FCM registration tokens are stored exclusively within server-only Firestore subcollections (`/users/{uid}/pushTokens/{tokenId}`).
   - Document ID is derived deterministically via `ptok_${sha256(token).slice(0, 32)}`.
2. **Credential Safety:**
   - Zero Firebase service account keys, APNs `.p8` private keys, or cloud credentials are committed to the repository.
   - All environments derive configuration server-side.
3. **Callable Defense-in-Depth:**
   - Every push callable enforces `rejectUnknownFields()`.
   - Every push callable derives identity strictly from authenticated context (`context.auth.uid`).
