# GrabNGo Mobile Application

GrabNGo is a mobile ordering application built with React Native, TypeScript, and Firebase.

---

## 1. Environment & Architecture Overview

The approved architecture consists of:
- **Mobile Client**: React Native + TypeScript
- **Authentication**: Firebase Authentication
- **Database**: Cloud Firestore
- **Backend Operations**: Firebase Cloud Functions (trusted serverless backend)
- **Security**: Firebase Security Rules
- **Local Dev & Testing**: Firebase Emulator Suite
- **Messaging**: Firebase Cloud Messaging (planned)
- **Payment**: Mock / Demo payment initially

### Environments:
| Environment | Backend Target | Emulator Used | Description |
|---|---|---|---|
| **Local** (default) | Firebase Emulator Suite | YES (Ports 9099, 8080, 5001) | Safe offline development, demo project `demo-grabngo-local` |
| **Staging** | `mad-lab-a9665` | NO | Approved staging cloud environment |
| **Production** | *Not configured* | NO | Explicitly rejected; fails closed |

---

## 2. Prerequisites & Tooling Versions

Ensure the following tools are installed on your workstation:
- **Node.js**: `>= 22.11.0` (Active LTS recommended, tested on Node 23.x / 22.x)
- **npm**: `>= 10.x`
- **Java Development Kit (JDK)**: JDK 17 or JDK 21+ (required for Android builds and Firebase Emulator Suite)
- **Android Studio & SDK**: Android SDK Platform 34+, Android SDK Build-Tools, Command-line Tools (`adb`)
- **Firebase CLI**: `npm install -g firebase-tools` (version 13+)

---

## 3. Repository Setup & Branching Strategy

### Branching Rules
- **`main`**: Protected branch. Production-ready code only. Never commit directly to `main`.
- **`development`**: Active integration branch. All feature branches and step implementations branch off and merge into `development`.

### Installation
```bash
# Clone the repository
git clone https://github.com/deeksha0219/MADLAB1.git
cd MADLAB1

# Switch to development branch
git checkout development

# Install exact dependencies from lockfile
npm ci
```

---

## 4. Local Firebase Emulator Suite

Local development uses the Firebase Emulator Suite so you can build and test without affecting staging or production data.

### Emulator Ports
- **Authentication**: `9099`
- **Firestore**: `8080`
- **Cloud Functions**: `5001` (Scaffolded for CLI/backend tests; mobile client does not invoke in Step 3)
- **Emulator UI**: `4000` (`http://localhost:4000`)

### Starting Emulators
```bash
# Start Auth, Firestore, and Functions emulators
firebase emulators:start --only auth,firestore,functions
```

### Stopping Emulators
Press `Ctrl + C` in the terminal running the emulators.

### Safety Rules for Emulators
1. Emulator data is strictly disposable test data.
2. **Never import production data** into the local emulator.
3. No real credentials or live payment details should ever be used.

---

## 5. Environment Configuration & Verification

React Native does not automatically load `.env` files into JS runtime without extra native modules. Environment configuration is centrally managed via:
`src/config/environment.ts`

### Safe Environment Templates
The repository provides safe configuration templates:
- `.env.example`: General template and variable definitions
- `.env.local.example`: Pre-configured for local emulator development (`demo-grabngo-local`)
- `.env.staging.example`: Pre-configured for staging cloud project (`mad-lab-a9665`)

> [!CAUTION]
> **Secret Handling Rule**:
> NEVER commit `.env`, `.env.*`, service account JSON keys, or `.pem` private keys to version control. The `.gitignore` file enforces this rule.

### Verifying the Active Environment
When the application starts, it executes `configureFirebase()` from `src/config/firebase.ts`, logging an active environment banner:
```
====================================================
[GrabNGo Environment] Active: LOCAL
[GrabNGo Environment] Firebase Project ID: demo-grabngo-local
[GrabNGo Environment] Uses Emulator: true
[GrabNGo Environment] Mobile Client Calls Functions Emulator: false
[GrabNGo Environment] Emulator Host: 10.0.2.2 (Auth:9099, Firestore:8080)
====================================================
```
If an unauthorized or unknown environment is passed, or if `'production'` is attempted, the app immediately throws a fatal exception and halts execution.

---

## 6. Available Quality & Validation Scripts

| Command | Purpose |
|---|---|
| `npm run typecheck` | Runs `tsc --noEmit` to verify strict TypeScript types without emitting artifacts. |
| `npm run lint` | Runs `eslint .` to check for style and lint violations. |
| `npm test` | Runs Jest unit and environment test suites. |
| `npm run test:watch` | Runs Jest in interactive watch mode. |
| `npm run test:emulator` | Runs emulator-specific test suites (`__tests__/emulator`). |

---

## 7. Running the Mobile Application

### Step 1: Start Metro Bundler
```bash
npm start
```

### Step 2: Run on Android
```bash
npm run android
```

### Step 3: Run on iOS (macOS only)
```bash
cd ios && bundle exec pod install && cd ..
npm run ios
```

---

## 8. Staging Deployment Policy & Approvals

> [!WARNING]
> **STAGING DEPLOYMENT PROHIBITED IN STEP 3**:
> 1. `firestore.rules` in this step is a local deny-by-default emulator placeholder. Deploying it to staging will break the application.
> 2. Cloud Functions in this step is a scaffold placeholder without business operations.
> 3. Deployment of Security Rules or Cloud Functions to staging requires:
>    - Full implementation of authentication-aware rules in Step 4+.
>    - Comprehensive allow and deny unit tests passing against the emulator.
>    - Explicit user review and written approval.
> 4. To protect staging, `.firebaserc` sets `default` to `demo-grabngo-local`. Default CLI commands cannot target staging unless `-P staging` is explicitly provided.

---

## 9. Intentionally Not Implemented in Step 3

The following components are deliberately out of scope for Step 3:
- Student authentication and registration flows (Step 4)
- Admin and staff role management
- Production Cloud Firestore security rules
- Shopping cart migration and order placement logic
- Cloud Functions payment and notification triggers
- Cloud Messaging (FCM) integration
