# GrabNGo Step 4 — Migration Safety & Rollback Strategy

**Report ID:** `step4-migration-and-rollback.md`  
**Date:** September 21, 2026 (Updated with Mandated Corrections)  
**Auditor:** Senior Database & Security Engineer  

---

## 1. Executive Summary

This document establishes the safe, non-destructive migration design and rollback protocols for transitioning legacy user records to the Step 4 Firebase Auth and UID-keyed profile architecture.

> [!IMPORTANT]
> **NO CLIENT-SIDE MIGRATION POLICY**:
> In accordance with user correction #1, the mobile application client does NOT execute any data migration, document deletion, or bulk update. Any legacy data migration must be executed exclusively via an approved, trusted Cloud Function or controlled admin script that includes pre-migration backups, a dry-run mode, comprehensive audit logging, and automated rollback capability.

---

## 2. Legacy Data Inventory & Schema Discrepancies

### Current Prototype Schema in Firestore `users/{autoId}`:
```json
{
  "collegeId": "user@rvu.edu.in",
  "name": "Student Name",
  "phone": "9876543210",
  "password": "plaintext_password_here",
  "createdAt": "2026-09-19T15:30:00.000Z"
}
```

### Critical Discrepancies:
1. **Unindexed / Random Document ID:** Legacy documents were created via `.add()`, generating arbitrary document IDs (e.g. `users/AbCdEf12345`).
2. **Missing Firebase Auth UID:** Documents have no relationship to Firebase Authentication UIDs.
3. **Plaintext Password Exposure:** Passwords are stored in plaintext. These cannot and must not be imported into Firebase Auth or copied into the hardened `users/{uid}` schema.
4. **Phone Formatting:** Legacy phones are 10-digit unnormalized strings lacking the canonical `+91` E.164 country code.
5. **Duplicate Risk:** Without document-level UID enforcement, multiple documents could have been created for the same phone number.

---

## 3. Trusted Server-Side Migration Design

When staging data migration is approved, it will follow this 5-stage protocol:

```
[ Stage 1: Full Backup ]
Firestore Collection Export to GCS Bucket
           │
           ▼
[ Stage 2: Dry Run & Validation ]
Parse legacy users, identify collisions, validate phone formats
           │
           ▼
[ Stage 3: Phone Verification Onboarding ]
Users sign in via Firebase Phone Auth -> Firebase Auth creates verified UID
           │
           ▼
[ Stage 4: Server-Side Profile Linking ]
Cloud Function (admin context) reads legacy document by phone,
strips password, sanitizes data, writes users/{uid}, tags legacy as _migrated: true
           │
           ▼
[ Stage 5: Quarantine & Decommission ]
Quarantine legacy documents into legacy_users_archive/{docId}
(Zero plaintext passwords retained in active collections)
```

### Server Migration Script Specifications:
1. **Pre-requisite:** Export active database using `gcloud firestore export gs://mad-lab-a9665-backups/pre-step4`.
2. **Password Disposal:** The `password` field is deleted in memory during migration; it is NEVER written to the destination document.
3. **Idempotency:** The script can run multiple times without duplicating data or overwriting existing user profiles.
4. **Audit Logging:** Every migration event records `{ legacyDocId, newUid, phone, migratedAt: timestamp }` in an immutable `migration_audit_log` collection.

---

## 4. Rollback Plan

If an unexpected regression or service disruption occurs during Step 4:

### Code Rollback
1. **Repository Rollback:**
   ```bash
   git checkout main
   # To discard the unmerged development branch:
   git branch -D development
   ```
2. **Firebase Rules Rollback:**
   - Since `firestore.rules` has NOT been deployed to staging in Step 4, staging security rules remain completely unaffected.
   - For local development, restore the initial deny-all placeholder rule.

### Data Rollback
- Since zero legacy documents are deleted or modified by Step 4 code, legacy records remain intact in Firestore.
- Newly created `users/{uid}` and `admins/{uid}` documents can be dropped or left inert without affecting legacy collections.
