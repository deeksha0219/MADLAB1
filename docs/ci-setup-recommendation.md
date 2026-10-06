# GrabNGo - CI/CD Setup Recommendation

## Purpose

This document outlines the Continuous Integration (CI) pipeline design for GrabNGo, detailing how automated validation is executed on pull requests and pushes to the `development` branch.

## Dependency Management Strategy

There is a critical distinction between the local development workspace and the CI execution environment:

1. **Local Audited Workspace**:
   - In accordance with audit safety rules, `node_modules` is not installed without explicit developer approval.
2. **CI Pipeline Environment**:
   - CI runs on an ephemeral container runner (e.g. GitHub Actions `ubuntu-latest`).
   - CI **must** strictly install exact dependency versions using `npm ci` referencing `package-lock.json`.
   - Never use `npm install` in CI, as it may update dependencies or alter lockfiles.

## Required Pipeline Workflow

The CI workflow triggers on:
- All Pull Requests targeting `main` or `development`.
- Pushes directly to the `development` branch.

### Pipeline Stages

1. **Checkout Code**:
   ```bash
   actions/checkout@v4
   ```

2. **Setup Node.js Runtime**:
   ```bash
   actions/setup-node@v4
   with:
     node-version: '22.x' # Node engine requirement: >= 22.11.0
     cache: 'npm'
   ```

3. **Secret Scanning Check (Recursive & Shell-Agnostic)**:
   Scans directory tree for sensitive files (`.env` files except `.example`, service account credentials, private keys) using an unambiguous Node.js scanner without shell operator precedence pitfalls:
   ```bash
   node -e "/* recursive scan for .env*, serviceAccount, adminsdk, .pem, .key */"
   ```

4. **Install Exact Dependencies**:
   ```bash
   npm ci
   ```

5. **Static Type Checking (Zero Emit)**:
   ```bash
   npm run typecheck
   ```
   *Runs `tsc --noEmit` to guarantee strict TypeScript compliance.*

6. **Lint & Code Style**:
   ```bash
   npm run lint
   ```
   *Runs `eslint .` without modifying source files.*

7. **Unit & Environment Tests**:
   ```bash
   npm test -- --runInBand
   ```
   *Runs Jest in non-concurrent mode to validate environment isolation, configurations, and core logic.*

8. **Firebase Configuration Validation**:
   - Verifies `.firebaserc`:
     - `default` points to `demo-grabngo-local` (prevents accidental deployment to staging).
     - `staging` points to `mad-lab-a9665`.
     - `production` is not configured.
   - Validates that `firestore.rules` is configured as deny-all for emulator testing.

## Required Secret Configuration in Repository Settings

The following secret names (and placeholders) should be configured in repository secret storage (e.g., GitHub Actions Secrets):

| Secret Name | Purpose | Example Value / Format | Note |
|---|---|---|---|
| `FIREBASE_PROJECT_ID_STAGING` | Staging Firebase project ID | `mad-lab-a9665` | Non-confidential identifier |
| `FIREBASE_TOKEN_STAGING` | Firebase CLI CI authentication token | `secret_token_value` | Required only for automated emulator/staging operations |
| `STAGING_GOOGLE_SERVICES_JSON_BASE64` | Base64-encoded Android google-services.json for staging | `base64_encoded_string` | Injected dynamically at build time if needed |

> [!CAUTION]
> - Never store secret values in git or unencrypted configuration files.
> - Production deployment from CI is strictly prohibited until production infrastructure, security audits, and formal approvals are obtained.
