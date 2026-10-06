# Step 10 — Security Tests

**Date:** 2026-09-23  
**Test Runner:** `scripts/run-emulator-notifications-test.js`  
**Command:** `npm run test:notifications:emulator`

---

## Test Suites

### Suite 1: Authorization (5 tests)

| ID | Test | Method |
|---|---|---|
| 1.1 | Unauthenticated `listMyNotifications` rejected (401) | callable without token |
| 1.2 | Unauthenticated `markNotificationRead` rejected (401) | callable without token |
| 1.3 | Unauthenticated `markAllNotificationsRead` rejected (401) | callable without token |
| 1.4 | Unauthenticated `getUnreadNotificationCount` rejected (401) | callable without token |
| 1.5 | Authenticated student can call `listMyNotifications` | positive path |
| 1.6 | Inactive admin gets own (empty) count — not an error | positive path |

### Suite 2: Direct Write Denial (1 test)

| ID | Test | Method |
|---|---|---|
| 2.1 | Direct Firestore REST write to `notifications/{id}` denied (403/400/401) | Firestore REST API |

### Suite 3: Input Allowlist Validation (10 tests)

| ID | Test |
|---|---|
| 3.1 | `listMyNotifications` rejects extra fields |
| 3.2 | `listMyNotifications` rejects limit=0 |
| 3.3 | `listMyNotifications` rejects limit=51 |
| 3.4 | `listMyNotifications` rejects float limit |
| 3.5 | `markNotificationRead` rejects extra field |
| 3.6 | `markNotificationRead` rejects invalid notificationId format |
| 3.7 | `markNotificationRead` rejects null notificationId |
| 3.8 | `markAllNotificationsRead` rejects extra field |
| 3.9 | `getUnreadNotificationCount` rejects extra field |
| 3.10 | `listMyNotifications` rejects negative limit |

### Suite 4: Order Placed Notifications (11 tests)

| ID | Test |
|---|---|
| 4.1–4.2 | createOrder succeeds and returns orderId |
| 4.3 | studentA receives order_placed notification |
| 4.4 | isRead === false initially |
| 4.5 | title is non-empty string |
| 4.6 | body is non-empty string |
| 4.7 | notificationId starts with 'notif_' |
| 4.8 | adminN1 (assigned canteen) receives new_order_for_admin |
| 4.9 | adminN2 (different canteen) does NOT receive notification |
| 4.10 | No sensitive fields in student notification |
| 4.11 | Order status not altered by notification creation |

### Suite 5: Payment Notifications (7 tests)

| ID | Test |
|---|---|
| 5.1–5.2 | createDemoPayment and completeDemoPayment succeed |
| 5.4 | studentA receives payment_succeeded_demo |
| 5.5 | payment_succeeded_demo is initially unread |
| 5.6 | adminN1 receives payment_verified_for_admin |
| 5.7 | No sensitive fields in payment notification |

### Suite 6: Status Transition Notifications (5 tests)

| ID | Test |
|---|---|
| 6.2 | studentA receives order_accepted |
| 6.3 | studentA receives order_preparing |
| 6.4 | studentA receives order_ready_for_pickup |
| 6.5 | studentA receives order_completed |

### Suite 7: Payment Failure Notification (5 tests)

| ID | Test |
|---|---|
| 7.1–7.3 | order + payment + fail flow succeeds |
| 7.4 | studentA receives payment_failed notification |
| 7.5 | payment_failed is initially unread |

### Suite 8: Expiry — No Notification (4 tests)

| ID | Test |
|---|---|
| 8.1–8.3 | order + payment + expire flow succeeds |
| 8.4 | expirePaymentAttempt does NOT generate payment_failed notification |

### Suite 9: Refund Notifications (5 tests)

| ID | Test |
|---|---|
| 9.1–9.2 | Full refund cycle setup succeeds |
| 9.3 | studentA receives refund_pending_demo |
| 9.4–9.5 | completeDemoRefund succeeds; studentA receives refund_completed_demo |

### Suite 10: Read State & Idempotency (11 tests)

| ID | Test |
|---|---|
| 10.1–10.2 | listMyNotifications returns array |
| 10.3 | DTOs have required fields |
| 10.4–10.5 | markNotificationRead succeeds; isIdempotent=false on first call |
| 10.6 | Repeated markNotificationRead is idempotent (isIdempotent=true) |
| 10.7–10.8 | Firestore confirms isRead=true and readAt is set |
| 10.9–10.10 | markAllNotificationsRead; getUnreadCount=0 |
| 10.11 | Repeated markAll is safe (updatedCount=0) |

### Suite 11: Cross-User Isolation (3 tests)

| ID | Test |
|---|---|
| 11.2 | studentB cannot mark studentA's notification as read |
| 11.3 | adminN2 has no Canteen A notifications |
| 11.4 | Inactive admin has no server-sent notifications |

### Suite 12: Privacy (2 tests)

| ID | Test |
|---|---|
| 12.1 | No notification document contains providerReference, hmac, secret, refundReference, rawBody |
| 12.2 | listMyNotifications DTOs contain no sensitive fields |

### Suite 13: Template Sanitization & Privacy (8 tests)

| ID | Test |
|---|---|
| 13.1–13.3 | null, undefined, empty orderId sanitizes to #UNKNOWN |
| 13.4 | Newlines stripped from short order ID |
| 13.5 | HTML tags stripped from short order ID |
| 13.6 | Bounded length to # + 6 characters uppercase |
| 13.7 | Payment success message explicitly states demo/simulated |
| 13.8 | No provider references in template body |

### Suite 14: Mandatory Edge Cases Audit (47 tests)

| Case | Description | Assertions |
|---|---|---|
| 1 | >500 notifications batch handling (500 write bound, cursor returned) | 14.1.1–14.1.4 |
| 2 | Partial mark-all completion, continuation cursor & count check | 14.2.1–14.2.7 |
| 3 | Payment callable / webhook concurrency race | 14.3.1–14.3.3 |
| 4 | Webhook replay after callable completion | 14.4.1–14.4.3 |
| 5 | Webhook completion followed by callable retry | 14.5.1–14.5.3 |
| 6 | Repeated & concurrent order-status transitions | 14.6.1–14.6.4 |
| 7 | Failed source transaction creates zero notifications/outbox | 14.7.1–14.7.3 |
| 8 | Notification failure, retry & outbox client write denial | 14.8.1–14.8.4 |
| 9 | Admin reassignment (active gets future, inactive/unassigned none) | 14.9.1–14.9.4 |
| 10 | Public endpoint audit (createNotificationInternal 404, no client spoofing) | 14.10.1–14.10.6 |
| 11 | Conflicting deterministic payload fails closed without overwrite | 14.11.1–14.11.4 |
| 12 | Retention policy (indefinite retention, no unused expiresAt) | 14.12.1–14.12.2 |

---

## Total: 144 assertions across 14 suites (All Passing)

---

## Running

```bash
npm run test:notifications:emulator
```
