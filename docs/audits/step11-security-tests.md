# GrabNGo Step 11: Security & Workflow Tests

## 1. Test Architecture & Runner

Live emulator tests are orchestrated via `scripts/run-emulator-service-desk-test.js` executed inside `firebase emulators:exec`:

```bash
npm run test:service-desk:emulator
```

Component & UI unit tests are executed with Jest:
```bash
npm test __tests__/components/TouchKeyboard.test.tsx
```

---

## 2. Test Coverage & Assertion Breakdown

| Test Category | Description | Assertions Passed |
| --- | --- | --- |
| **Role Authorization** | Verifies unauthenticated denial (401), student denial (403), inactive admin denial (403), inactive service desk denial (403), cross-canteen denial (403), forged role rejection, and service desk catalog admin rejection. | 10 passed |
| **Queue & Search** | Verifies assigned canteen listing, cross-canteen queue exclusion, pagination bounds, limit validations (-5, 0, 2.5, 51, string), exact search, whitespace trimming, overlong query rejection, control-char rejection, non-existent not-found, cross-canteen non-leakage, and absence of payment secrets. | 16 passed |
| **Status Transitions** | Verifies complete state machine progression (`placed` -> `accepted` -> `preparing` -> `ready_for_pickup` -> `completed`), terminal state protections, invalid skipping rejection, cross-canteen transition denial, replay idempotency, concurrent transition race handling, and single status history event creation. | 10 passed |
| **Notes & Audit History** | Verifies service-desk note creation, canteen admin note creation, student note denial, cross-canteen note denial, client-supplied author UID/role rejection, overlong note rejection (>1000 chars), control-char rejection, note inspection in details, and direct client write denial to `operationalNotes` and `auditEvents` via Firestore Rules. | 13 passed |
| **Payment & Refund Safety**| Verifies client cannot mutate `paymentStatus` via transition, client cannot mutate `refundStatus` via transition, and slot capacity is properly released upon order cancellation. | 6 passed |
| **Touch Keyboard Unit Tests** | Verifies container rendering, alphanumeric keys, space, backspace, clear, search, hide, max-length bounds, disabled state during async search, and character counter. | 11 passed |

**Total Step 11 Assertions**: 66 passed, 0 failed.
