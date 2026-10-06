# GrabNGo Step 4 — Authentication & Authorization Hardening Report

**Report ID:** `step4-authentication-authorization.md`  
**Date:** September 21, 2026 (Updated with Mandated Corrections)  
**Auditor:** Senior Firebase Authentication, Cloud Functions & Security Engineer  

---

## 1. Executive Summary

Step 4 eliminates all plaintext password handling, replaces unauthenticated Firestore user enumeration with standard Firebase Phone Authentication, keys user documents to Firebase Auth UIDs (`users/{uid}`), enforces server-authoritative role and canteen assignments (`admins/{uid}`), integrates the mobile registration flow with the callable `createStudentProfile` Cloud Function via `@react-native-firebase/functions`, removes all client writes of authorization fields (`role`, `status`, `createdAt`, `updatedAt`), removes the hardcoded admin bootstrap secret in favor of protected operator authorization or local emulator mode, derives verified phone numbers directly from Auth, establishes session restoration via `auth().onAuthStateChanged`, closes client profile creation in `firestore.rules`, and hardens Firestore Security Rules with a strict `diff().affectedKeys()` allowlist.

---

## 2. Authentication Flow: Before vs. After

### Before (Vulnerable Prototype)
```
User Enters Phone & Password
         │
         ▼
AccountScreen.tsx
writes directly to Firestore:
db.collection("users").add({ collegeId, name, phone, password, createdAt })
[Plaintext password saved, random Doc ID, no Firebase Auth account created]
         │
         ▼
LoginScreen.tsx
queries Firestore: db.collection("users").where("phone", "==", phone)
[Unauthenticated client enumerates registered phone numbers]
         │
         ▼
Sends OTP & sets role in client state:
setRole("student")
[Volatile React state; app restart logs user out; zero server authorization]
```

### After (Step 4 Hardened Architecture)
```
Student / Admin Enters Phone Number
         │
         ▼
authService.ts (Canonical E.164 Normalization: +91XXXXXXXXXX)
         │
         ▼
auth().signInWithPhoneNumber(canonicalPhone)
(App verification enforced in staging; test mode only in local emulator)
         │
         ▼
Student Enters 6-Digit OTP -> confirmation.confirm(otp)
Firebase Authentication issues verified ID token, phone number, & UID
         │
         ▼
AppNavigator.tsx receives auth().onAuthStateChanged(user)
         │
         ├──────────────────────────────────────────────────────┐
         │                                                      │
         ▼                                                      ▼
Query: admins/{user.uid}                               Query: users/{user.uid}
(Protected by Firestore Rules;                         (Protected by Firestore Rules;
status must be 'active')                                status must be 'active')
         │                                                      │
   [Active Admin]                                         [Active Student]
         │                                                      │
         ▼                                                      ▼
Render Admin Stack                                     Render Student Stack
(AdminLandingScreen with                               (HomeScreen, Cart, Profile, etc.)
assigned canteen permissions)                                  │
                                                       [Profile Incomplete]
                                                                │
                                                                ▼
                                                       Render CompleteProfile
                                                       (Invokes createStudentProfile
                                                        Callable Cloud Function;
                                                        Phone derived from Auth;
                                                        NO direct client writes)
```

---

## 3. Profile & Data Models

### Student Profile: `users/{uid}`
- **Document ID:** Matches Firebase Auth UID (`request.auth.uid`).
- **Creation Mechanism:** Exclusively via trusted callable Cloud Function `createStudentProfile`.
- **Direct Client Creation:** Explicitly forbidden in `firestore.rules` (`allow create: if false;`).
- **Permitted Schema:**
  ```typescript
  interface StudentProfile {
    uid: string;                 // Matches Auth UID (immutable)
    name: string;                // Full Name (2-60 chars, validated server-side)
    phone: string;               // Derived from Auth record (+91XXXXXXXXXX)
    collegeId: string;           // Normalized RVU email (e.g. name@rvu.edu.in)
    role: "student";             // Assigned by Cloud Function; immutable by client
    status: "active" | "suspended"; // Assigned by Cloud Function; immutable by client
    createdAt: FieldValue;       // Server timestamp
    updatedAt: FieldValue;       // Server timestamp
  }
  ```
- **Phone Derivation:** Phone numbers are derived directly from the verified Firebase Auth record (`auth().currentUser.phoneNumber` / `admin.auth().getUser(uid)`). If a phone number is submitted by the client, it is strictly validated and checked against the verified Auth phone; any mismatch triggers an immediate error.
- **Dynamic Role Validation:** `getStudentProfile(uid)` strictly inspects `doc.data().role`. If the document's role is not `'student'`, access is rejected. The role is never hardcoded.
- **Update Allowlist:** Updates via Firestore Security Rules are guarded by:
  `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'collegeId', 'updatedAt'])`
- **Email Ownership Note:** `@rvu.edu.in` string validation ensures institutional format compliance. It does not prove ownership of the specific mailbox without an email link verification or SSO.

### Canteen Admin Model: `admins/{uid}`
- **Document ID:** Matches Firebase Auth UID.
- **Permitted Schema:**
  ```typescript
  interface AdminProfile {
    uid: string;                 // Matches Auth UID
    role: "canteen_admin";       // Server assigned
    canteenIds: string[];        // Array of assigned canteens, e.g. ["BIG_MINGOS", "LIBRARY_CANTEEN"]
    status: "active" | "inactive";
    createdAt: FieldValue;
    updatedAt: FieldValue;
  }
  ```
- **Security Invariant:** Clients have ZERO write access to `admins/{uid}` (`allow write: if false;`).
- **Admin Privilege Escalation Protection:**
  - Removed static secret `grabngo-admin-bootstrap-dev`.
  - Static secrets are never accepted from clients.
  - Privilege escalation requires either:
    1. An authenticated caller who already exists as an active admin in Firestore (`callerDoc.data()?.status === 'active'`).
    2. Local emulator mode strictly indicated by `process.env.FUNCTIONS_EMULATOR === 'true'`.

---

## 4. Role-Aware Navigation States

`AppNavigator.tsx` resolves application state reactively:
1. **Initializing:** Renders `SplashScreen` while resolving Firebase Auth state.
2. **Unauthenticated:** Renders `LoginScreen` and `AccountScreen` (allowing switching).
3. **Authenticated Admin:** When UID exists in `admins/{uid}` with `status === 'active'`, renders protected `AdminLandingScreen` displaying assigned canteens.
4. **Authenticated Student:** When UID exists in `users/{uid}` with `role === 'student'` and `status === 'active'`, renders full student ordering stack.
5. **Authenticated (Incomplete Profile):** If a phone login succeeds but no `users/{uid}` exists, renders `AccountScreen` to collect name and RVU college email, saving via `createStudentProfile` Cloud Function.
6. **Suspended / Access Denied:** If account status is not active, renders `AccessDeniedScreen` with sign-out action.

---

## 5. Security Findings Addressed

| Requirement / Vulnerability | Remediation in Step 4 | Verification Method |
|---|---|---|
| Remove hardcoded admin bootstrap secret | Removed `grabngo-admin-bootstrap-dev` from all code and functions | Code review & search |
| Reject client static secret for admin escalation | Require caller admin identity or `process.env.FUNCTIONS_EMULATOR === 'true'` | Cloud Functions unit test & build |
| Direct client profile creation & role selection | Closed in Rules (`allow create: if false;`); student profiles created by `createStudentProfile` | Firestore rules test & live emulator run |
| Client write of role, status, createdAt, updatedAt | Removed from client services; assigned server-side | Client code audit & live emulator tests |
| Missing Firebase Functions client dependency | Installed `@react-native-firebase/functions@24.0.0` and wired in `profileService` | Root typecheck, lint, Jest |
| Plaintext password stored in Firestore | Completely removed; zero password fields in UI, services, or Rules | Source code audit, Firestore Rules deny rule, and unit tests |
| Unauthenticated phone query | Removed from `LoginScreen.tsx`; auth requests OTP directly via Firebase Auth | Source code grep, API inspection |
| Client-assigned role (`setRole('student')`) | Replaced with Firestore `admins/{uid}` and `users/{uid}` backed by Security Rules | AppNavigator architecture, Rules allow/deny test suite |
| Hardcoded role in profile retrieval | `getStudentProfile` validates stored `data.role === 'student'` | Service implementation & tests |
| Arbitrary submitted phone numbers | Phone derived from Auth; mismatching submissions rejected | Service implementation & Cloud Function validation |
| Real emulator testing vs AST simulation | Implemented real `@firebase/rules-unit-testing` against live Firestore Emulator | `npm run test:rules:emulator` (12/12 PASS) |
| Strict validation of Function inputs | Added `rejectUnknownFields`, regex checks on name/collegeId/targetUid, canonical phone | Cloud Functions build & tests |
