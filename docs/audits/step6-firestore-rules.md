# GrabNGo Step 6 — Firestore Security Rules Specification

**Report ID:** `step6-firestore-rules.md`  
**Date:** September 21, 2026  
**Auditor:** Senior Security Engineer & Firebase Security Rules Specialist  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  
**Staging Status:** Read-only (Step 6 Rules NOT deployed to staging)  
**Production Status:** Untouched  
**Billing Status:** Spark Plan (Blaze upgrade prohibited)  
**Legacy Data Status:** Untouched  

---

## 1. Executive Summary

This document specifies the declarative security rules implemented in `firestore.rules` for the catalog subcollections (`canteens`, `categories`, `items`, and `private/admin`).

> [!CAUTION]
> **LOCAL EMULATOR ONLY — DO NOT DEPLOY TO STAGING**  
> In accordance with safety constraints and user instructions, Step 6 Security Rules are maintained strictly in the local development environment and verified against the local Firebase Emulator Suite. The staging project `mad-lab-a9665` remains on the Step 4 ruleset.

---

## 2. Core Access Control Rules

### 2.1 Helper Functions
```rules
// Check if user is authenticated
function isAuthenticated() {
  return request.auth != null && request.auth.uid != null;
}

// Check if user is an active canteen admin assigned to a specific canteen
function isCanteenAdmin(canteenId) {
  return isAuthenticated()
    && exists(/databases/$(database)/documents/admins/$(request.auth.uid))
    && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.status == 'active'
    && (canteenId in get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.canteenIds);
}
```

---

### 2.2 Security Rules Matrix by Path

| Resource Path | Operation | Student / Public Condition | Admin Condition | Write Privileges |
|---|---|---|---|---|
| `/canteens/{canteenId}` | `read` | `resource.data.isActive == true` | `isCanteenAdmin(canteenId)` | `allow write: if false;` (Cloud Functions only) |
| `/canteens/{canteenId}/categories/{categoryId}` | `read` | `resource.data.isActive == true` | `isCanteenAdmin(canteenId)` | `allow write: if false;` (Cloud Functions only) |
| `/canteens/{canteenId}/items/{itemId}` | `read` | `resource.data.isActive == true && resource.data.isAvailable == true` | `isCanteenAdmin(canteenId)` (can read out-of-stock items) | `allow write: if false;` (Cloud Functions only) |
| `/canteens/{canteenId}/items/{itemId}/private/{docId}` | `read` | **STRICTLY DENIED** | `isCanteenAdmin(canteenId)` | `allow write: if false;` (Cloud Functions only) |
| All other paths | `read/write` | **DENIED** | **DENIED** | `allow read, write: if false;` |

---

## 3. Defense-in-Depth Analysis

1. **Closed Client Write Path:**  
   By specifying `allow write: if false;` across all canteen, category, and item collections, the client application is physically unable to tamper with prices, descriptions, availability, or timestamps directly in the database.
2. **Confidential Subcollection Isolation:**  
   The `private/admin` subcollection contains supplier data, internal kitchen notes, and cost prices. Rules explicitly reject all non-admin read requests. Even if a student knows the exact document path, the database engine returns `PERMISSION_DENIED`.
3. **Cross-Canteen Admin Isolation:**  
   An administrator assigned exclusively to `BIG_MINGOS` cannot read `private/admin` documents belonging to `LIBRARY_CANTEEN`.
4. **Soft-Delete Filtering:**  
   Students querying active items cannot retrieve items where `isActive == false`, preventing retired menu items from leaking into client interfaces.
