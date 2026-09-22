# GrabNGo Step 4 — Baseline Authentication & Authorization Audit

**Report ID:** `step4-baseline.md`  
**Date:** September 21, 2026 (Updated with Corrections)  
**Auditor:** Senior Firebase Authentication & Application Security Engineer  

---

## 1. Executive Summary

This audit establishes the empirical baseline of the authentication and authorization mechanism in the GrabNGo mobile prototype prior to Step 4 hardening. All findings were revalidated against actual source files in the repository.

---

## 2. Revalidated Findings with Source Evidence

### Finding 1: Plaintext Passwords Saved Directly to Firestore
- **Location:** `src/screens/AccountScreen.tsx` (Lines 108–114)
- **Source Code:**
  ```typescript
  // SAVE TO FIRESTORE
  await db.collection("users").add({
    collegeId,
    name,
    phone,
    password, // <-- PLAINTEXT PASSWORD
    createdAt: new Date().toISOString(),
  });
  ```
- **Vulnerability:** Passwords are stored in plaintext in the Firestore `users` collection. No Firebase Authentication user account is created. Document IDs are randomly generated via `.add()` rather than keyed by Firebase Auth UID.

### Finding 2: Unauthenticated Phone Query Prior to OTP Generation
- **Location:** `src/screens/LoginScreen.tsx` (Lines 62–75)
- **Source Code:**
  ```typescript
  auth().settings.appVerificationDisabledForTesting = true;

  const snap = await getDocs(
    query(
      collection(db, "users"),
      where("phone", "==", phone)
    )
  );

  if (snap.empty) {
    Alert.alert("Error", "Phone not registered!");
    return;
  }
  ```
- **Vulnerability:** Unauthenticated clients query the `users` collection directly to determine if a phone exists. This permits user enumeration and requires open Firestore read permissions. Additionally, `appVerificationDisabledForTesting = true` was hardcoded unconditionally.

### Finding 3: Client-Controlled Role Assignment
- **Location:** `src/screens/LoginScreen.tsx` (Line 130)
- **Source Code:**
  ```typescript
  await confirm.confirm(otp);
  setRole("student"); // <-- Client-assigned role
  ```
- **Vulnerability:** The application role was dictated purely by volatile client state. There was no server-validated role, no canteen assignment system, and no verification against custom claims or protected admin documents.

### Finding 4: Absence of Session Restoration
- **Location:** `src/navigation/AppNavigator.tsx` (Lines 25–31)
- **Source Code:**
  ```typescript
  const [isLoading, setIsLoading] = useState(true);
  const [isAccountDone, setIsAccountDone] = useState(false);
  const [role, setRole] = useState<"student" | "Service Desk" | null>(null);

  useEffect(() => {
    setTimeout(() => setIsLoading(false), 2000);
  }, []);
  ```
- **Vulnerability:** Auth state was held in volatile React component state (`role`, `isAccountDone`). The app did not listen to `auth().onAuthStateChanged`. When the application restarted, `role` reset to `null`, logging the user out and redirecting them to registration/login.

### Finding 5: Incomplete Logout and Hardcoded Profile
- **Location:** `src/screens/ProfilScreen.tsx` (Lines 8–10, 39–40)
- **Source Code:**
  ```typescript
  const handleLogout = () => {
    setRole(null); // Does not invoke auth().signOut()
  };
  ...
  <Text style={{ fontSize: 16, fontWeight: "bold" }}>Anil Kumble</Text>
  <Text style={{ color: "gray" }}>+91 9745032126</Text>
  ```
- **Vulnerability:** Logout did not terminate the underlying Firebase Auth session. Profile displayed hardcoded student credentials rather than authenticated user attributes.

---

## 3. Important Domain Validation Finding

- **RVU Email Suffix Check Limitation:** The string validation `collegeId.endsWith("@rvu.edu.in")` serves as an institutional email format gate; **it does NOT prove ownership of the specific email account**. Proving email ownership requires an email verification link (`sendEmailVerification`) or institutional SSO.

---

## 4. Migration & Data Integrity Risks

- **Plaintext Password Extraction:** Plaintext passwords in existing `users` documents cannot and must not be imported into Firebase Authentication.
- **Missing Auth Accounts:** Existing Firestore `users` records lack corresponding Firebase Auth accounts.
- **Strict Prohibition on Client-Side Migration:** No migration may be run from mobile client devices. Any future migration must be server-executed with pre-migration backups, dry run, and audit logging.
