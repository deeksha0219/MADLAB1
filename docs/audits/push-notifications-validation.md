# GrabNGo — Push Notifications Validation & Verification Report

**Date:** 2026-10-02  
**Auditor / Security Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Verdict:** **PUSH-LOGIC-READY / REAL-DELIVERY-BLOCKED**  

---

## 1. Automated Verification Matrix

| Suite / Section | Exact Command | Exit Code | Assertions | Result | Notes |
|---|---|---|---|---|---|
| **TypeScript Client & Root** | `npm run typecheck` | `0` | 0 errors | **PASS** | Client push service types validated |
| **ESLint Static Analysis** | `npm run lint` | `0` | 0 errors, 208 warnings | **PASS** | Client push service conforms to lint rules |
| **Jest Test Suites** | `npm test -- --runInBand` | `0` | 80 passed (12 suites) | **PASS** | Core unit test suites pass |
| **Functions Compilation** | `npm --prefix functions run build` | `0` | 0 errors | **PASS** | Server TypeScript functions compile |
| **Notification Emulator (Suites 1–15)** | `npm run test:notifications:emulator` | `0` | 188 passed | **PASS** | Canonical in-app notification tests pass |
| **Push Token Additive Layer (Suite 16)** | `npm run test:notifications:emulator` | `0` | 29 passed | **PASS** | Token registration, unregister, limits & isolation |

**Total In-App & Push Notification Assertions:** **217 passed, 0 failed.**

---

## 2. Detailed Breakdown of Suite 16 Assertions

| Assertion ID | Description | Verified Behavior |
|---|---|---|
| `16.1` | Unauthenticated token registration | Rejected with HTTP 401 |
| `16.2` | Short token registration | Rejected with `INVALID_ARGUMENT` |
| `16.3` | Token with illegal characters | Rejected with `INVALID_ARGUMENT` |
| `16.4` | Client-supplied `recipientUid` | Rejected with `INVALID_ARGUMENT` |
| `16.5` | Invalid platform (`windows`) | Rejected with `INVALID_ARGUMENT` |
| `16.6` | Valid token registration | Successfully registers token doc |
| `16.7` | Deterministic `tokenId` | Returns `ptok_${sha256.slice(0, 32)}` |
| `16.8` | No raw token in response | Raw token excluded from response payload |
| `16.9` | Direct client Firestore read | Denied by rules with HTTP 403 |
| `16.10` | Direct client Firestore write | Denied by rules with HTTP 403 |
| `16.11` | Duplicate token registration | Idempotent; does not duplicate doc |
| `16.12` | Matching `tokenId` | Retains existing `tokenId` on duplicate |
| `16.13` | Firestore token document state | Stored with `enabled: true` |
| `16.14` | Server environment derivation | Correctly derived as `local` |
| `16.15` | Cross-user registration | User B registers their own token cleanly |
| `16.16` | Cross-user doc isolation (A->B) | User A does not contain User B token |
| `16.17` | Cross-user doc isolation (B->A) | User B does not contain User A token |
| `16.18` | Bounded token limit | Active tokens bounded to max 5 per user |
| `16.19` | `unregisterPushToken` | Successfully disables token on logout |
| `16.20` | Disabled token status | Token doc marked `enabled: false` |
| `16.21` | Cross-user unregister | User A cannot unregister User B token |
| `16.22` | Push preferences default | Default preferences returned |
| `16.23` | Push preferences update | Preferences updated via callable |
| `16.24` | Token re-registration | Re-enables token doc successfully |
| `16.25` | Outbox delivery integration | Outbox worker executes push delivery |
| `16.26` | Outbox delivered status | Outbox doc marks `status: delivered` |
| `16.27` | Outbox push metadata | Outbox doc records `pushDeliveryStatus` |
| `16.28` | Push failure isolation | Push provider error does not fail outbox |
| `16.29` | In-app notification preserved | In-app record 100% preserved on push failure |

---

## 3. Explicit Local Testing Status

Per prompt instructions:
> *"The Firebase Emulator Suite does not prove real FCM delivery to Android/iOS devices. If FCM cannot be tested because cloud credentials, a device, or platform configuration is unavailable, mark it BLOCKED or NOT VERIFIED, not PASS."*

**Authoritative Verdict:** **`PUSH-LOGIC-READY / REAL-DELIVERY-BLOCKED`**  
All local push logic, token lifecycle, security rules, and outbox failure independence are thoroughly tested and verified (217/217 passed). Live device delivery via APNs / Google Play Services remains blocked pending cloud staging deployment and physical test handsets.
