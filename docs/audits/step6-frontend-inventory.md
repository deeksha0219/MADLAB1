# GrabNGo Step 6 — Frontend Inventory & Baseline Audit

**Report ID:** `step6-frontend-inventory.md`  
**Date:** September 21, 2026  
**Auditor:** Senior Mobile, Firebase & Application Security Engineer  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Current Commit:** `7634d52 Initial commit`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  
**Staging Status:** Read-only (`mad-lab-a9665` contains Step 4 rules only; Step 6 rules/functions NOT deployed)  
**Production Status:** Untouched (Deployment prohibited)  
**Billing Status:** Spark plan (Blaze upgrade prohibited)  
**Legacy Data Status:** Untouched (Migration prohibited)  

---

## 1. Executive Summary

This inventory documents the pre-Step 6 baseline of the frontend and existing catalog data structures within `MADLAB1`. In accordance with Phase 0 instructions, this review is conducted prior to modifying any source files. It establishes the catalog requirements, hardcoded menu inventories, current Firestore reads, and boundaries around cart/order/payment flows that must remain untouched during Step 6.

---

## 2. Environment & Repository Baseline

- **Current Git Branch:** `development` (isolated from `main`).
- **Commit Hash:** `7634d52 Initial commit`.
- **Working Tree Status:** Cleanly confined to `development`.
- **Local Firebase Emulators:**
  - **Auth Emulator:** Port `9099`
  - **Firestore Emulator:** Port `8085` (configured in `firebase.json` and `src/config/environment.ts` to avoid Windows host conflict on port `8080`)
  - **Functions Emulator:** Port `5001`
  - **Emulator UI:** Port `4000`
- **Current Firestore Security Rules:** Step 4 hardened rules (`allow create: if false;` on `users/{userId}`, `diff().affectedKeys()` update allowlist, `allow write: if false;` on `admins/{adminId}`, deny catch-all).
- **Current Functions Exports:**
  - `createStudentProfile` (callable)
  - `assignAdminRole` (callable)
  - Build script: `npm --prefix functions run build` (`tsc` targeting Node.js `>=20`).

---

## 3. Frontend Screen Inventory & Catalog Analysis

### 3.1 Canteen Selection Screens
1. **`HomeScreen.tsx` (Student Hub):**
   - **Location Selector:** Contains a dropdown modal (Lines 191–216) displaying:
     - `"BIG MINGOS"`
     - `"M.M Foods (Library)"`
     - `"M.M Foods (Admin Block)"`
   - Selecting `"BIG MINGOS"` updates component state `selectedCanteen`.
   - Selecting `"M.M Foods (Admin Block)"` navigates to `MMAdminBlockScreen`.
   - Selecting `"M.M Foods (Library)"` navigates to `MMLibraryScreen`.
2. **`MMAdminBlockScreen.tsx` & `MMLibraryScreen.tsx`:**
   - Dedicated canteen overview screens displaying category tiles and banners for those respective locations.

### 3.2 Category Screens
1. **`CategoryScreen.tsx` (Big Mingos / Primary):**
   - Route params: `{ category: string, canteen?: string, title?: string }`.
   - Supported categories in UI:
     - `SNACKS`
     - `SOUTH` ("SOUTH INDIAN")
     - `NORTH` ("NORTH INDIAN")
     - `DESSERTS`
     - `BEVERAGES`
     - `CHINESE`
2. **`MMAdminCategoryScreen.tsx` & `MMLibraryCategoryScreen.tsx`:**
   - Similar category views tailored for the MM Admin Block and MM Library canteens.

### 3.3 Menu Items & Cards
- Items are rendered via card components featuring:
  - Title/Name (`Text`)
  - Description (`Text`)
  - Price in Rupees (`Text`: e.g. `₹70`)
  - Image Asset (`Image`: local static `.png` imports from `assets/`)
  - Availability Badge / Opacity (`opacity: 0.4` or `0.5`, with `"Currently Unavailable"` text)
  - Stepper Controls: `+` and `-` quantity buttons interacting with a temporary cart collection.

---

## 4. Hardcoded Menu Data Inventory

Across the existing screens, menu items and prices are hardcoded in in-memory JavaScript objects:

| Screen File | Category Key | Sample Hardcoded Items | Prototype Price (Rupees) | Image Assets |
|---|---|---|---|---|
| `HomeScreen.tsx` | `vegItems` | Masala Dosa, Gobi Noodles, Sandwich, Peri Peri Fries | ₹70, ₹70, ₹80, ₹120 | `assets/masala_dosa.png`, `assets/gobi.png` |
| `HomeScreen.tsx` | `nonVegItems` | Chicken Biryani, Chicken Popcorn, Chicken Manchurian | ₹150, ₹130, ₹100 | `assets/chicken_biryani.png`, `assets/chicken_popcorn.png` |
| `CategoryScreen.tsx` | `SNACKS` | Potato Bites, Chicken Popcorn, Boiled Egg, Omelette, Peri Peri Fries, Sandwich | ₹80, ₹90, ₹25, ₹180, ₹120, ₹60 | `assets/potato_bites.png`, `assets/eggs.png` |
| `CategoryScreen.tsx` | `SOUTH` | Idly (2 pcs), Vada, Poori Saagu, Masala Dosa, Akki Roti, Ragi Roti | ₹30, ₹20, ₹70, ₹70, ₹80, ₹50 | `assets/Idlis.png`, `assets/Vada.png` |
| `CategoryScreen.tsx` | `NORTH` | Aloo Bonda, Chole Bhature, Pav Bhaji | ₹60, ₹100, ₹120 | `assets/Aloo_bonda.png`, `assets/chole_bhature.png` |
| `CategoryScreen.tsx` | `DESSERTS` | Gulab Jamun, Fruit Custard, Carrot Halwa, Brownie Sundae | ₹50, ₹100, ₹60, ₹80 | `assets/gulab_jamun.png`, `assets/fruit_custard.png` |
| `CategoryScreen.tsx` | `BEVERAGES` | Coffee, Tea, Kesar Badam Milkshake, Butterscotch Milkshake, Lassi, Lime Soda | ₹40, ₹40, ₹50, ₹60, ₹50, ₹30 | `assets/coffee.png`, `assets/tea.png` |
| `CategoryScreen.tsx` | `CHINESE` | Veg Manchurian, Chilly 65, Honey Chilly Potato, Gobi Noodles | ₹70, ₹90, ₹80, ₹70 | `assets/Veg_manchurian.png`, `assets/chilly_65.png` |
| `MMLibraryCategoryScreen.tsx` | Multiple | Veg Puff, Paneer Puff, Egg Puff, Veg Burger, Chicken Burger, Samosa | ₹20, ₹30, ₹30, ₹50, ₹80, ₹20 | `assets/veg_puff.png`, `assets/paneer_puff.png` |

---

## 5. Current Firestore Reads & Writes (Inventory)

### 5.1 Menu & Availability Queries
In the prototype, food availability was queried via flat collections:
1. `HomeScreen.tsx` (Lines 24–33):
   ```typescript
   firestore()
     .collection("menu")
     .where("available", "==", false)
     .where("canteen", "==", "BIG_MINGOS")
     .onSnapshot(snap => { ... });
   ```
2. `CategoryScreen.tsx` (Lines 26–41):
   ```typescript
   firestore()
     .collection("menu")
     .where("category", "==", category)
     .onSnapshot(snapshot => { ... });
   ```
3. `MMAdminCategoryScreen.tsx` (Lines 48–61):
   ```typescript
   firestore()
     .collection("menu")
     .where("category", "==", category)
     .where("canteen", "==", "MM_ADMIN_BLOCK")
     .onSnapshot(snapshot => { ... });
   ```

### 5.2 Network & API Calls
- There are **no direct REST/HTTP API calls**; all database interactions utilize `@react-native-firebase/firestore` and `@react-native-firebase/functions`.

---

## 6. Admin Menu Screens & Capabilities

- **`AdminLandingScreen.tsx`:**  
  Currently displays the authenticated canteen administrator's identity and assigned canteens (`adminProfile.canteenIds`). In Step 4, this was established as a protected landing placeholder.
- In Step 6, backend APIs and Firestore subcollections will provide the authoritative catalog management operations (creating/updating canteens, categories, and items, and toggling availability).

---

## 7. UI States & Failure Handling Analysis

- **Loading States:** Rudimentary or absent in prototype category screens (items were loaded synchronously from in-memory arrays).
- **Empty States:** Rendered empty scroll views when filters returned no results.
- **Error & Retry Handling:** Basic `Alert.alert()` used on catch blocks; no structured retry hooks or error banners existed.
- **Offline Behavior:** Offline persistence was reliant on default Firestore disk cache.

---

## 8. Preserved Components (Out of Scope for Step 6)

The following components and dependencies are strictly preserved and must **NOT** be modified in Step 6:
1. **Cart Implementation (`CartContext.tsx`, `CartScreen.tsx`):**
   - Direct writes to `cart` collection remain unchanged until Step 7 user-scoped cart migration.
2. **Order Placement (`OrderConfirmedScreen.tsx`, `OrderHistoryScreen.tsx`):**
   - Order schema, status listeners, and history remain untouched.
3. **Payment Processing (`PaymentScreen.tsx`):**
   - Mock/demo payment logic remains untouched.
4. **Authentication Flow (`LoginScreen.tsx`, `AccountScreen.tsx`, `authService.ts`):**
   - Step 4 phone verification and profile functions remain active and untouched.
