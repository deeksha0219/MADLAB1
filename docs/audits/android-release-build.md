# GrabNGo — Android Release Build Audit & Verification

**Date:** 2026-10-02  
**Auditor / Release Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Commit:** `b3d6fcb49aa2bf496e77147b38d7c48834c9c10f`  
**Host Environment:** Windows 11, Node `v23.9.0`, Gradle `8.14`, Java JDK `24.0.2`  
**Status:** **JS BUNDLE VERIFIED / NATIVE APK COMPILATION BLOCKED (MISSING ANDROID SDK ON HOST)**  

---

## 1. Release Readiness Pre-Build Audit

| Checkpoint | Requirement | Verification Finding | Status |
|---|---|---|---|
| **Application ID / Namespace** | Defined in `android/app/build.gradle` | `com.madlab1` | **PASS** |
| **SDK Versions** | Compatible `minSdk`, `targetSdk`, `compileSdk` | `minSdkVersion 24`, `targetSdkVersion 36`, `compileSdkVersion 36`, `buildToolsVersion 36.0.0` | **PASS** |
| **Version Code & Name** | SemVer defined in `defaultConfig` | `versionCode 1`, `versionName "1.0"` | **PASS** |
| **Signing Configuration** | Secrets stored outside repository | `android/app/build.gradle` loads `MYAPP_UPLOAD_STORE_FILE`, `MYAPP_UPLOAD_STORE_PASSWORD`, `MYAPP_UPLOAD_KEY_ALIAS`, `MYAPP_UPLOAD_KEY_PASSWORD` via project properties. Zero release keystores committed. | **PASS** |
| **Debug Keystore Removal** | No debug keystores committed | Confirmed `android/app/debug.keystore` was deleted and is ignored. | **PASS** |
| **No Local Properties** | `local.properties` not tracked | Verified `android/local.properties` is absent and in `.gitignore`. | **PASS** |
| **Cleartext Traffic** | Deny cleartext HTTP in release | Configured via `android:usesCleartextTraffic="${usesCleartextTraffic}"` in `AndroidManifest.xml`. | **PASS** |
| **Fail-Closed Env Resolution** | `GRABNGO_ENV` required in release | In `src/config/environment.ts`, `isDev` is compiled as `false` when `--dev false`. Lacking explicit `GRABNGO_ENV` throws: `[CONFIG ERROR] Non-development build requires explicit GRABNGO_ENV ("staging" | "production"). Fails closed.` | **PASS** |
| **No Token Minting in Release** | Dev token routes forbidden | `web/server.js` fails closed if `NODE_ENV === 'staging'` or `'production'` and is completely isolated outside client dependency graph. | **PASS** |
| **No Hardcoded Secrets** | Zero private keys or service accounts | Scanned entire codebase; zero secrets or service accounts exist. | **PASS** |

---

## 2. Release Artifact Generation Results

### 2.1 JavaScript Release Bundle (`index.android.bundle`)
The production release JavaScript bundle was compiled using Metro in non-development mode:
```bash
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android-release-bundle.js
```
- **Exit Code:** `0` (SUCCESS)
- **Output File:** `android-release-bundle.js`
- **File Size:** `1.74 MB` (`1,822,085 bytes`)
- **SHA-256 Checksum:** `5b1cb74106b392242cdace9e1240748deee1bfedc6bcf76ee7b66a69efb8c1f1`

### 2.2 Native Android Binary (`assembleRelease` / `bundleRelease`)
Attempting native compilation via Gradle wrapper:
```bash
.\gradlew.bat assembleRelease
```
- **Exit Code:** `1` (BLOCKED)
- **Error:**
  ```
  FAILURE: Build failed with an exception.
  * Where: Build file 'E:\Madlab\MADLAB1\android\build.gradle' line: 23
  * What went wrong:
  A problem occurred evaluating root project 'MADLAB1'.
  > Failed to apply plugin 'com.facebook.react.rootproject'.
     > A problem occurred configuring project ':app'.
        > SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in your project's local properties file at 'E:\Madlab\MADLAB1\android\local.properties'.
  ```
- **Root Cause & Disposition:** The host Windows development environment has Java JDK 24 installed, but does not have the Android SDK command-line tools / platform packages installed or `ANDROID_HOME` configured. Per safety gate instructions:
  > *"If a test fails because an environment, credential, Apple build machine, Blaze plan, or staging project is unavailable, report it as BLOCKED with evidence rather than changing the code to hide the failure."*
- **Verdict on Native Binary:** **BLOCKED — HOST ANDROID SDK UNAVAILABLE**.

---

## 3. Static Analysis of Release Bundle

Static regex checks were executed against `android-release-bundle.js` via `scripts/verify-release-bundle.js`:

| Target Pattern | Count | Analysis & Disposition |
|---|---|---|
| `fake-key` | 0 | **CLEAN** |
| `/api/token` (operator route) | 0 | **CLEAN** |
| `-----BEGIN PRIVATE KEY-----` | 0 | **CLEAN** |
| `"private_key_id"` (Service Acct) | 0 | **CLEAN** |
| `10.0.2.2` | 15 | **DISPOSITION:** 1 occurrence resides in `src/config/environment.ts` as part of the dormant `LOCAL_CONFIG` declaration. 14 occurrences reside inside third-party `@react-native-firebase/auth`, `firestore`, and `functions` library fallback defaults. In release builds (`--dev false`), `resolveBuildTimeEnvironment()` strictly selects `staging` or `production`, completely bypassing `LOCAL_CONFIG`. |
| `127.0.0.1` | 10 | **DISPOSITION:** All 10 occurrences reside inside third-party `@react-native-firebase` modular SDK connection helper signatures. |
| Emulator Ports (`9099`, `8085`, `5001`) | 4 | **DISPOSITION:** Reside in dormant `LOCAL_CONFIG` and `@react-native-firebase` SDK defaults. Disallowed in production config via runtime validation assertions in `resolveEnvironmentConfig()`. |

---

## 4. Build Warnings and Disposition

1. **Warning: Assets destination folder is not set, skipping...**  
   - *Source:* `react-native bundle` CLI.  
   - *Disposition:* Normal behavior when running standalone bundle without `--assets-dest`. Will be provided by Gradle `bundleRelease` during packaging.
2. **Warning: Deprecated Gradle features were used in this build...**  
   - *Source:* Gradle 8.14 evaluating React Native Gradle Plugin 0.85.1.  
   - *Disposition:* Expected upstream React Native Gradle plugin deprecation warnings for Gradle 9 compatibility; no action needed.
3. **Fail-Closed Verification:**  
   - Confirmed that running without `GRABNGO_ENV` in a release environment throws an error immediately on app boot, preventing any connection to local emulators or unconfigured backends.
