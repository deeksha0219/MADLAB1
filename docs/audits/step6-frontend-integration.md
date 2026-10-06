# GrabNGo Step 6 — Frontend Integration Report

**Report ID:** `step6-frontend-integration.md`  
**Date & Time:** September 21, 2026, 21:58 IST  
**Auditor:** Senior Mobile Frontend Architect & Security Engineer  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `7634d52` (Uncommitted working tree changes confined to Step 6)  
**Local Environment & Emulator Ports:**  
- Firebase Auth Emulator: `127.0.0.1:9099` (Android loopback `10.0.2.2:9099`)  
- Cloud Firestore Emulator: `127.0.0.1:8085` (Android loopback `10.0.2.2:8085`)  
- Cloud Functions Emulator: `127.0.0.1:5001` (Android loopback `10.0.2.2:5001`)  
- Firebase Emulator Hub / UI: `127.0.0.1:4000`  
**Staging Status:** Read-only (`mad-lab-a9665`); Step 6 Rules & Functions NOT deployed.  
**Production Status:** Untouched.  
**Billing Status:** Unchanged (Spark Free Tier; Blaze upgrade prohibited).  
**Legacy Data Status:** Untouched; no migrations executed.  

---

## 1. Executive Summary

This report documents the frontend integration of the menu, canteen, and catalog backend in `HomeScreen.tsx`, `CategoryScreen.tsx`, and `src/services/catalogService.ts`. In accordance with Phase 5 requirements, existing UI layouts, color schemes, and navigational flow were preserved with zero visual regression. All monetary values are rendered from integer minor units (paise), and data fetching includes loading, empty, and retry failure handling.

---

## 2. Integrated Components and Architecture

### 2.1 Catalog Service (`src/services/catalogService.ts`)
- **Data Models:** `Canteen`, `MenuCategory`, and `MenuItem` interfaces with immutable types.
- **Paise Currency Formatter:** `formatPaiseToRupees(paise: number): string`
  - Correctly transforms integer minor units to standard INR notation (e.g., `7000` -> `₹70.00`, `2500` -> `₹25.00`).
  - Guards against negative numbers, floats, `NaN`, `Infinity`, and undefined values.
- **Client Read Queries:**
  - `getActiveCanteens()`: Queries `/canteens` where `isActive == true`.
  - `getCategoriesForCanteen(canteenId)`: Queries `/canteens/{canteenId}/categories` where `isActive == true` sorted by `sortOrder`.
  - `getAvailableItemsForCategory(canteenId, categoryId)`: Queries `/canteens/{canteenId}/items` where `categoryId == categoryId`, `isActive == true`, and `isAvailable == true`.
  - `getAvailableItemsForCanteen(canteenId)`: Queries all active and available items for a canteen.
- **Admin Mutating Dispatches:**
  - `createCanteen`, `updateCanteen`, `setCanteenActive`
  - `createCategory`, `updateCategory`, `setCategoryActive`
  - `createMenuItem`, `updateMenuItem`, `setMenuItemAvailability`, `setMenuItemActive`
  - Dispatched strictly via `functions().httpsCallable` to trusted server endpoints; direct client Firestore writes are denied.

### 2.2 HomeScreen Integration (`src/screens/HomeScreen.tsx`)
- **Dynamic Canteens Loading:** Loads active canteens on mount via `getActiveCanteens()`.
- **Dropdown Binding:** Populates the canteen selection modal dynamically with active canteens (`canteensList`), falling back gracefully to standard defaults if offline.
- **Availability State:** Binds to item `isAvailable` status, dimming out-of-stock items and disabling cart additions.
- **Price Display:** Displays formatted INR values from minor unit integer representations.
- **Cart Isolation:** Cart quantity steppers and cart Firestore collections remain isolated from catalog backend logic, adhering to the boundary constraint.

### 2.3 CategoryScreen Integration (`src/screens/CategoryScreen.tsx`)
- **Dynamic Category Item Fetching:** Queries `/canteens/{canteenId}/items` for items matching `categoryId`.
- **Loading State:** Displays loading indicator during asynchronous item retrieval.
- **Empty State:** Renders a user-friendly notice (`No items currently available in this category.`) if zero active/available items are returned.
- **Network / Retry State:** Gracefully falls back to cached category presets if network requests fail and provides retry capabilities.
- **Minor Unit Formatting:** Utilizes `formatPaiseToRupees` to render real prices without decimal float rounding errors.

---

## 3. Boundary & Non-Functional Compliance
- **Cart & Checkout Boundary:** Untouched. No checkout or payment modifications made.
- **Offline / Degradation Behavior:** When disconnected from the emulator, cached items and offline fallbacks prevent the screen from crashing or hanging indefinitely.
- **Zero Secrets / Tokens:** No API keys or tokens are stored or rendered in frontend integration code.

---

## 4. Rollback & Revert Procedure
If frontend integration changes need to be rolled back:
```bash
git checkout HEAD -- src/screens/HomeScreen.tsx src/screens/CategoryScreen.tsx
rm src/services/catalogService.ts
```
All catalog calls will cleanly revert to pre-Step 6 static structures.
