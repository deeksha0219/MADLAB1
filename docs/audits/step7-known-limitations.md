# GrabNGo Step 7 — Known Limitations & Scope Boundaries

**Report ID:** `step7-known-limitations.md`  
**Execution Date & Time:** September 22, 2026, 11:15 IST  
**Auditor:** Principal Software & Security Architect  
**Repository:** `MADLAB1`  
**Branch:** `development`  
**Commit Hash:** `86f799b`  
**Target Environment:** Local Firebase Emulator Suite (`demo-grabngo-local`)  
**Staging Status:** Read-only (`mad-lab-a9665`); Step 7 Rules & Functions NOT deployed  
**Production Status:** Untouched  
**Billing Status:** Spark Free Tier (Blaze upgrade PROHIBITED)  
**Legacy Data Status:** Untouched; zero migrations executed  

---

## 1. Intentional Architectural Boundaries & Deferred Scope

1. **No Live Payments in Step 7:** Payment processing is restricted strictly to `'cash'` and `'upi_demo'`. Orders are initialized server-side to `paymentStatus: 'pending'`. Live payment gateway integration (Razorpay / UPI sandbox, webhook verification, signature checking) is explicitly deferred to **Step 9**.
2. **Local Firebase Emulator Suite Exclusivity:** Cloud Functions require the Blaze billing plan on live GCP projects. Because billing upgrades are prohibited, all Step 7 Rules and Functions are compiled and verified exclusively against the local Firebase Emulator Suite (`demo-grabngo-local`). Staging contains only Step 4 rules.
3. **Legacy Collections Preserved:** The legacy prototype collections `cart`, `menu`, and `orderHistory` remain untouched in the database.
4. **Order State Lifecycle Transitions:** Step 7 implements order placement (`status: 'placed'`). Order state transitions (`preparing`, `ready_for_pickup`, `collected`) and the live kitchen dashboard are deferred to Step 8.
5. **Push Notifications & Cloud Messaging:** Notification triggers via Firebase Cloud Messaging (FCM) are deferred to Step 10.

---

## 2. Rollback & Revert Procedure

To revert Step 7 changes to the clean Step 6 baseline:
```bash
git checkout development
git checkout 86f799b -- .
git clean -fd
```
Because no changes were pushed to staging or production, zero cloud cleanup or database rollback is required.
