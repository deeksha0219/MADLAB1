# GrabNGo — Deep Security Audit Baseline

## 1. Audit Scope, Posture, and Boundaries

- **Audit Posture:** Non-destructive, local/emulator only. Analysis and reporting only. Zero modification of application source code.
- **Repository:** `GrabNGo/MADLAB1`
- **Active Branch:** `development`
- **Repository Cleanliness:** Clean working tree with untracked local developer directory (`?? web/`). No unstaged modifications to application source files.
- **Firebase Project ID:** `demo-grabngo-local`
- **Emulator Suite Environment:**
  - Auth Emulator: `127.0.0.1:9099` (Active, PID 2800)
  - Firestore Emulator: `127.0.0.1:8085` (Active, PID 8412)
  - Functions Emulator: `127.0.0.1:5001` (Active, PID 2800)
  - Emulator Hub / UI: `127.0.0.1:4400` / `127.0.0.1:4000` (Active, PID 2800)
  - Local Service-Desk Web Client: `http://localhost:5050` (Configured via `web/server.js`)
  - Metro / Dev Server: `http://localhost:8081`

---

## 2. Git Environment Baseline

### 2.1 Current Branch
```text
development
```

### 2.2 Working Tree Status (`git status --short`)
```text
?? web/
```
*Note: `web/` contains the local web-based service-desk operator harness (`index.html` and `server.js`). All application source files under `src/`, `functions/`, and `android/` are completely unmodified.*

### 2.3 Recent Commit History (`git log -10 --oneline --decorate`)
```text
8d57da3 (HEAD -> development) fix(android): configure gradle 8.14 wrapper and seed demo script
49f353f docs(step11): refine assertion reporting, canonical state model, and manual acceptance
a20febf feat(step11): implement service desk, admin operations, and touch-screen keyboard
83e5392 Complete Step 10 in-app notification infrastructure and audit gate
1acd1f9 Complete Step 9 payment security hardening, edge-case audit, and closure gate
a0400cd Complete Step 9 initial demo payment foundation
6f07403 Complete Step 8 order status, admin operations, and pickup capacity release hardening
359aa39 Complete Step 7 secure checkout and order creation
86f799b Close Step 6 catalog backend verification
7634d52 (origin/main, origin/HEAD, main) Initial commit
```

---

## 3. Baseline Verification Commands & Results

All commands were executed directly against the repository in the local Windows/PowerShell environment.

| # | Command | Target / Scope | Exit Code | Result / Output Summary |
|---|---------|----------------|-----------|-------------------------|
| 1 | `npm run typecheck` | Root React Native TypeScript (`tsc --noEmit`) | **0** | Clean compile; 0 errors |
| 2 | `npm run lint` | Root ESLint (`eslint .`) | **0** | 0 errors, 203 style warnings (inline styles) |
| 3 | `npm test` | Root Jest Test Runner | **0** | **11 passed**, 11 total suites; **63 passed**, 63 total tests |
| 4 | `npm --prefix functions run build` | Cloud Functions TypeScript (`tsc`) | **0** | Clean compile; 0 errors |
| 5 | `node scripts/run-emulator-rules-test.js` | Firestore Security Rules against Emulator (8085) | **0** | **33 passed**, 0 failed |
| 6 | `node scripts/run-emulator-functions-test.js` | Catalog & Admin Cloud Functions (5001) | **0** | **54 passed**, 0 failed |
| 7 | `node scripts/run-emulator-order-test.js` | Cart, Pickup Slot & Order Creation Suite | **0** | **64 passed**, 0 failed |
| 8 | `node scripts/run-emulator-status-test.js` | Order State Transitions & Capacity Hardening | **0** | **65 passed**, 0 failed |
| 9 | `node scripts/run-emulator-payment-test.js` | Demo Payments, Expiry, Refunds & Webhooks | **0** | **147 passed**, 0 failed |
| 10 | `node scripts/run-emulator-notifications-test.js` | In-App Notification System & Outbox | **0** | **144 passed**, 0 failed |
| 11 | `node scripts/run-emulator-service-desk-test.js` | Service Desk Queue, Search & Operational Notes | **0** | **55 passed**, 0 failed |

**Cumulative Automated Assertion Count:**
- Unit & Scaffold Jest Tests: **63 assertions passed**
- Live Firebase Emulator Security & Contract Tests: **562 assertions passed**
- **Total Verified Assertions:** **625 passed, 0 failed**

---

## 4. Package Dependency & Secret Scan Baseline

### 4.1 Dependency Audit
- **Root Project (`npm audit --audit-level=moderate`):**
  - Exit code: 1
  - Summary: 34 vulnerabilities (2 low, 15 moderate, 15 high, 2 critical)
  - Primary packages affected: Development and bundler dependencies (`metro`, `ws`, `shell-quote`, `image-size`, `protobufjs`, `qs`, `nanoid`, `js-yaml`).
  - Runtime mobile impact: Low (dependencies are developer tools and packagers, not deployed in mobile native release binary).
- **Functions Project (`npm --prefix functions audit --audit-level=moderate`):**
  - Exit code: 1
  - Summary: 9 moderate severity vulnerabilities.
  - Root cause: Transitive dependency `uuid` (<11.1.1) consumed by `@google-cloud/firestore` via `firebase-admin`.

### 4.2 Secret & Credential Scan
- **Command:**
  ```bash
  git grep -n -I -E 'BEGIN (RSA|EC|OPENSSH|PRIVATE ) KEY|serviceAccount|client_secret|api[_-]?key|webhook[_-]?secret|password|token' -- ':!node_modules'
  ```
- **Result:**
  - Zero private keys (`BEGIN RSA`, `BEGIN EC`, etc.) in repository.
  - Zero Google service-account JSON files committed.
  - Zero live payment gateway secrets (Razorpay / Stripe) present.
  - Matches were restricted to test token fixtures (`scripts/run-emulator-*.js`), documentation, and mock ID token exchanges against the local Auth emulator (`127.0.0.1:9099`).
