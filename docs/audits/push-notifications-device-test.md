# GrabNGo — Push Notifications Physical Device Testing Protocol

**Date:** 2026-10-02  
**Auditor:** Antigravity Engineering  
**Branch:** `development`  
**Status:** **NOT VERIFIED LOCALLY / BLOCKED PENDING CLOUD STAGING & TEST HARDWARE**  

---

## 1. Physical Device Smoke Test Protocol

Once cloud staging (`mad-lab-a9665`) is deployed on Blaze and test handsets are connected, the following 16-point matrix must be executed:

| Step | Test Case | Target State | Expected Result | Staging Status |
|---|---|---|---|---|
| **1** | Register real Android device token | Authenticated student | Token doc created in `/users/{uid}/pushTokens` | **BLOCKED** |
| **2** | Register real iOS device token | Authenticated student | APNs token exchanged for FCM token and stored | **BLOCKED (NO MACOS)** |
| **3** | Masked token inspection | Network inspector / logcat | Raw tokens absent from logs and network responses | **BLOCKED** |
| **4** | Synthetic order placed event | Foreground app | Order placed notification shown in-app and push received | **BLOCKED** |
| **5** | In-app notification verification | Notifications tab | Durable record exists in Firestore | **BLOCKED** |
| **6** | Background push receipt | App backgrounded | Heads-up notification appears on system tray | **BLOCKED** |
| **7** | Terminated app push receipt | App killed from task switcher | Push notification delivered by system and wakes app on tap | **BLOCKED** |
| **8** | Deep-link navigation | Tap on push alert | Navigates directly to the authenticated Notifications screen | **BLOCKED** |
| **9** | Notification permission denied | System settings revoked | App functions normally; in-app notifications still work | **BLOCKED** |
| **10** | Token rotation | App clear data / re-login | New token registered; old token pruned | **BLOCKED** |
| **11** | Logout cleanup | User logs out | Token disabled (`enabled: false`) on server | **BLOCKED** |
| **12** | Multi-device delivery | User logged into phone & tablet | Both devices receive push alert | **BLOCKED** |
| **13** | Payment demo wording check | Notification lock screen | Displays "Simulated payment; no real money transferred" | **BLOCKED** |
| **14** | Payment expiry push | Expiry worker triggers | Expiry alert received; order remains placed | **BLOCKED** |
| **15** | Cross-user delivery check | Event for Student A | Student B device receives zero alerts | **BLOCKED** |
| **16** | Offline retrieval | Airplane mode enabled | User reconnects and reads notification in in-app screen | **BLOCKED** |

---

## 2. Hardware & Cloud Prerequisites for Execution

1. **Google Cloud / Firebase Staging:**
   - Active Blaze billing on `mad-lab-a9665`.
   - `google-services.json` deployed to Android client.
   - Apple Developer APNs auth key (`.p8`) registered in Firebase Console.
2. **Android Hardware:**
   - Physical test handset running Android 13+ with Google Play Services enabled.
3. **iOS Hardware:**
   - Physical iPhone running iOS 16+ provisioned with Apple Developer development certificate.
