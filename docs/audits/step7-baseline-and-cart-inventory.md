# GrabNGo Step 7 — Baseline & Cart Inventory Report

**Report ID:** `step7-baseline-and-cart-inventory.md`  
**Execution Date & Time:** September 22, 2026, 11:05 IST  
**Auditor:** Principal Mobile & Security Architect  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Base Commit Hash:** `86f799b Close Step 6 catalog backend verification`  
**Target Environment:** Local Firebase Emulator Suite ONLY (`demo-grabngo-local`)  
**Staging Status:** Read-only (`mad-lab-a9665`); Step 7 Rules & Functions NOT deployed  
**Production Status:** Untouched  
**Billing Plan:** Spark Free Tier (Blaze upgrade PROHIBITED)  
**Legacy Data Status:** Untouched; zero migrations or deletions  

---

## 1. Executive Summary

This report documents the pre-implementation inventory of the existing cart, order, and payment implementations in `MADLAB1` before applying Step 7 hardening. 

The baseline audit revealed critical security vulnerabilities in the legacy prototype implementation (e.g. shared global cart collection, client-authoritative order creation, unvalidated totals, and unisolated order history). Step 7 replaces these mechanisms with a secure, user-scoped cart architecture and server-side pricing engine.

---

## 2. Legacy Inventory & Security Findings

| Component / Screen | Legacy Implementation Details | Security / Architectural Defect | Step 7 Hardening Resolution |
|---|---|---|---|
| **Cart Collection** | Flat global `firestore().collection('cart')` | **Critical Data Leakage & Tampering:** Any user could read, modify, or delete any other user's cart items. | Migrated to private user-scoped subcollections `users/{studentUid}/cart/{itemId}` with strict Firestore Rules. |
| **Cart State Ownership** | Shared across all app instances | Cross-tenant cart pollution. | Each student possesses a completely isolated cart scoped to their authenticated UID. |
| **Item Pricing & Totals** | Stored in cart document and passed from client UI | **Client Price Tampering Vulnerability:** Clients could send arbitrary `price` and `total` values. | Zero price trust: Cart documents store only `itemId`, `canteenId`, `quantity`, and `updatedAt`. Server recalculates totals in paise from the catalog. |
| **Order Creation** | Client executed direct `firestore().collection('orders').add(orderData)` | **Arbitrary Order Injection:** Students could forge orders, set status to `paid`, and modify prices. | Direct client writes blocked (`allow write: if false`). Order creation must execute via trusted Cloud Function `createOrder`. |
| **Order History** | Flat global collection `firestore().collection('orderHistory')` | **Order Privacy Violation:** All student orders were readable by anyone. | Orders queried securely from `orders` with `where('studentUid', '==', uid)` backed by composite indexes. |
| **Pickup Times** | Client-generated string from device clock | **Unvalidated Timing:** Allowed arbitrary past or out-of-bounds pickup strings. | Official pickup slot model `canteens/{canteenId}/pickupSlots/{slotId}` in `Asia/Kolkata` with server-enforced operating hours and capacity. |
| **Payment Status** | Client set `payment: "Paid Online"` or `"Pay at Counter"` | **Payment Spoofing:** Simulated local payments were immediately treated as authoritative. | Server assigns `paymentStatus: 'pending'`. Live payment integration deferred to Step 9. |

---

## 3. Legacy Migration Invariance

- **Legacy Collection Preservation:** The unhardened legacy collections (`menu`, `cart`, `orderHistory`) were **not** deleted, copied, bulk-updated, or migrated.
- **New Path Exclusivity:** All Step 7 features operate strictly on the new paths (`users/{studentUid}/cart`, `canteens/{canteenId}/pickupSlots`, and `orders/{orderId}`).
