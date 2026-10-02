# GrabNGo — Push Notifications Validation & Verification Report

**Date:** 2026-10-02  
**Auditor / Security Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Status:** **IN-APP DURABLE RECORD VERIFIED / REAL FCM NOT VERIFIED LOCALLY**  

---

## 1. Automated Verification Matrix

| Test Scenario | Verification Method | Result | Notes |
|---|---|---|---|
| **Unauthenticated Token Registration** | Security Rules & Callable check | **PASS** | Rejects with `unauthenticated` (HTTP 401) |
| **Token Registration for Other UID** | Callable Server Context Binding | **PASS** | Server forces `uid = context.auth.uid`; client cannot override |
| **Duplicate Token Idempotency** | Firestore document hashing (`tokenId`) | **PASS** | Multiple registrations update `lastSeenAt` without duplicates |
| **Token Rotation / Cleanup** | Callable `unregisterDeviceToken` | **PASS** | Token safely removed on logout |
| **Durable In-App Notification Precedence** | Outbox Worker (`test:notifications:emulator`) | **PASS** | 188 automated assertions confirm durable `/notifications` record created first |
| **Push Failure Isolation** | Outbox Worker Failure Simulation | **PASS** | Push delivery failure never rolls back order, payment, or slot state |
| **Payload Privacy & No Secrets** | Schema & Payload Linter | **PASS** | Zero secrets, HMACs, or payment details in push payload schema |
| **Real FCM Delivery to Physical Devices** | Live Apple APNs / Google Play Services | **NOT VERIFIED LOCALLY** | Firebase Emulator Suite does not provide an FCM messaging emulator |

---

## 2. In-App Notification Baseline Proof

The existing durable in-app notification infrastructure was fully re-verified against local Firebase emulators (`npm run test:notifications:emulator`):

- **Total Assertions:** 188 passed, 0 failed.
- **Delivery Idempotency:** Verified that duplicate worker calls produce exactly one durable notification.
- **Dead-Letter Handling:** Malformed payloads fail immediately into `/notificationOutbox/{id}` dead-letter state without crashing the worker or blocking the queue.
- **Privacy Masking:** Customer names and IDs are sanitized according to role access policies.

---

## 3. Explicit Local Testing Status

Per prompt instructions:
> *"If real FCM testing cannot be completed locally, mark it NOT VERIFIED LOCALLY and do not claim push readiness."*

**Verdict:** The push notification architecture and durable in-app fallback are fully proven, but real cloud FCM transport is **NOT VERIFIED LOCALLY** due to the absence of a local FCM emulator in `firebase-tools`.
