# GrabNGo — Staging Deployment Readiness Checklist

**Date:** 2026-10-02  
**Auditor / Release Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Target Staging Project:** `mad-lab-a9665` (Project Number: `551837939638`)  
**Deployment Status:** **READY FOR CLIENT APPROVAL (DEPLOYMENT NOT EXECUTED)**  

---

## 1. Pre-Deployment Verification Checklist

| Checklist Item | Requirement | Verification Finding | Status |
|---|---|---|---|
| **Staging Project ID** | Approved staging project identifier | Confirmed as `mad-lab-a9665` in `.firebaserc` | **VERIFIED** |
| **No Production Targeting** | Production project excluded | Confirmed `production` is absent from `.firebaserc` | **VERIFIED** |
| **Default Project Safety** | Default points to local emulator | `.firebaserc` has `"default": "demo-grabngo-local"` | **VERIFIED** |
| **Firebase Billing Plan** | Blaze (Pay-as-you-go) plan active | Cloud Functions 2nd gen requires Blaze. Owner confirmation pending. | **AWAITING APPROVAL** |
| **Required Cloud APIs** | Cloud Functions, Cloud Build, Artifact Registry, Firestore, Auth, Scheduler | Must be enabled on `mad-lab-a9665` | **PENDING BLAZE** |
| **Deployer Permissions** | Firebase Admin / Service Usage Admin | Current user logged in via Firebase CLI | **VERIFIED** |
| **Firestore Rules Build** | Locked rules in `firestore.rules` | 43 automated emulator assertions passed | **VERIFIED** |
| **Cloud Functions Build** | Zero TypeScript compilation errors | `npm --prefix functions run build` exits 0; output in `functions/lib/` | **VERIFIED** |
| **Demo Payment Seed** | `/systemConfig/demoPayment` ready | Seed prepared with project allowlist: `['demo-grabngo-local', 'mad-lab-a9665']` | **PREPARED** |
| **Outbox Sweeper Schedule** | Cloud Scheduler job for orphan outbox events | `scheduledOutboxSweeper` defined with cron: `every 5 minutes` | **VERIFIED** |
| **Rollback Plan** | Documented commit rollback | Documented below in Section 4 | **DOCUMENTED** |
| **Budget & Cost Alerts** | Threshold alerts configured | Budget alert at ₹500/month threshold in GCP Console | **SPECIFIED** |

---

## 2. Staging `/systemConfig/demoPayment` Seed Document

Before activating demo payments in staging, the following configuration document must be written to `/systemConfig/demoPayment` via server script or Firebase Admin SDK:

```json
{
  "enabled": true,
  "allowedProjects": [
    "demo-grabngo-local",
    "mad-lab-a9665"
  ],
  "maxAmountPaise": 500000,
  "disclaimerText": "Demo payment — no real money transferred.",
  "syntheticWebhooksEnabled": true,
  "updatedAt": "SERVER_TIMESTAMP"
}
```

*Security Invariant:* Any project ID not explicitly present in `allowedProjects` will cause `createDemoPayment` and `completeDemoPayment` to reject immediately with `PERMISSION_DENIED`.

---

## 3. Approved Staging Deployment Command

When explicit client approval and Blaze billing confirmation are received, the exact deployment command to execute is:

```bash
firebase deploy --only firestore:rules,functions --project mad-lab-a9665
```

**CRITICAL SAFETY GUARD:** Never run `firebase deploy` without `--project mad-lab-a9665`. Never use `--except` or wildcards.

---

## 4. Rollback and Disaster Recovery Plan

If unexpected regressions occur following a staging deployment:

1. **Immediate Rules Rollback:**
   ```bash
   git checkout <PREVIOUS_COMMIT> -- firestore.rules
   firebase deploy --only firestore:rules --project mad-lab-a9665
   ```
2. **Immediate Functions Rollback:**
   ```bash
   git checkout <PREVIOUS_COMMIT> -- functions/
   npm --prefix functions run build
   firebase deploy --only functions --project mad-lab-a9665
   ```
3. **Database Snapshot / Point-in-Time Recovery:**
   - Execute Firestore Cloud Storage export:
     ```bash
     gcloud firestore export gs://mad-lab-a9665-firestore-backups/pre-deployment-$(date +%Y%m%d%H%M%S) --project mad-lab-a9665
     ```
   - Restore using `gcloud firestore import`.

---

## 5. Post-Deployment Verification Test Suite

Upon successful deployment, execute the staging smoke test runner (`scripts/run-staging-smoke-test.js`) against `mad-lab-a9665`:
1. Verify deployed Functions match Git commit hash.
2. Verify Firestore Rules reject unauthenticated client writes.
3. Verify student cannot read another student's profile.
4. Verify student cannot read payments subcollection.
5. Verify demo payment displays: **“Demo payment — no real money transferred.”**
6. Verify service-desk user cannot approve cash payment or trigger refund.
7. Verify outbox sweeper cron is active in Cloud Scheduler.
