# GrabNGo — Push Notifications Known Limitations

**Date:** 2026-10-02  
**Auditor:** Antigravity Engineering  
**Status:** **OPERATIONAL REFERENCE FOR STAGING & PRODUCTION**  

---

## 1. Cloud Infrastructure Dependencies

1. **No Firebase Local FCM Emulator:** The local Firebase CLI emulator suite does not emulate Google Cloud Messaging (FCM) or Apple Push Notification service (APNs). End-to-end device delivery can only be tested in a live Firebase project (e.g. staging) with physical devices.
2. **Google Play Services Dependency (Android):** FCM delivery on Android requires devices with active Google Play Services. AOSP or custom ROM devices without Play Services cannot receive standard FCM messages without fallback to long-polling or in-app sync.
3. **APNs Certificate / Key Dependency (iOS):** iOS push delivery requires an active Apple Developer Program team with an APNs Auth Key (`.p8`) registered in the Firebase Console under Cloud Messaging. Without this, iOS APNs will reject FCM delivery attempts.

---

## 2. Power Management & Doze Modes

1. **Android Doze & Battery Optimization:** Aggressive manufacturer battery savers (e.g. Xiaomi MIUI/HyperOS, Samsung OneUI, OnePlus OxygenOS) may delay background FCM message delivery until the user unlocks their phone.
2. **iOS Background Execution Restrictions:** If low power mode is enabled or background app refresh is disabled, silent background pushes may not wake the React Native app. Critical status updates are delivered as high-priority notification alerts.

---

## 3. Token Churn & Invalidation

1. **FCM Token Expiration:** Tokens change when the app is uninstalled and reinstalled, when app data is cleared, or when Google rotates tokens periodically. The app must register token refresh listeners (`messaging().onTokenRefresh()`).
2. **Unregistered Tokens (HTTP 410 / `messaging/registration-token-not-registered`):** The server-side outbox worker must gracefully catch unregistration errors and disable/prune the stale token document from `/users/{uid}/pushTokens` to avoid sending to dead devices on subsequent events.

---

## 4. Fallback Architecture Guarantees

Because push notifications are inherently best-effort and subject to carrier and OS throttling:
- The **canonical record of truth** remains the durable Firestore `/notifications` collection.
- When opening the app or navigating to the notifications tab, the app always fetches directly from Firestore.
- No business logic, payment confirmation, or order fulfillment depends on push notification delivery confirmation.
