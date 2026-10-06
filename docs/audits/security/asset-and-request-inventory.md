# GrabNGo — Asset and Attack-Surface Inventory

## 1. Overview & Trust Boundaries

The GrabNGo architecture is strictly partitioned across three logical layers:
1. **Untrusted Client Boundary:**
   - React Native Android/iOS Mobile App (`src/`)
   - Web-Based Touchscreen / Service Desk Console (`web/`)
2. **Data & Policy Enforcement Layer:**
   - Cloud Firestore Security Rules (`firestore.rules`)
   - Firebase Authentication Provider (Local Auth Emulator on `127.0.0.1:9099`)
3. **Privileged Business Logic & Mutation Engine:**
   - Cloud Functions for Firebase (`functions/src/index.ts`)
   - Firebase Admin SDK (Privileged backend context bypassing Firestore rules)

---

## 2. Server Endpoints & Callable Request Inventory

Every server mutation and sensitive inquiry is implemented exclusively via HTTPS Callable Cloud Functions (or dedicated HTTPS onRequest Webhooks).

| Endpoint | Transport | Auth required | Roles | Inputs | Server-derived values | Reads | Writes | Sensitive output | Idempotency | Rate/bounds | Test evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `createStudentProfile` | Callable | Yes | Authenticated user without profile | `name`, `collegeId` | `uid`, `phone`, `role='student'`, `status='active'`, `createdAt`, `updatedAt` | `/users/{uid}`, `/admins/{uid}` | `/users/{uid}` | None | Checked by existence of `/users/{uid}` | `name` (1-100 chars), valid college email | `run-emulator-rules-test.js` |
| `assignAdminRole` | Callable | Yes | `platform_operator` | `targetUid`, `role`, `canteenIds` | `assignedByUid`, `updatedAt` | `/admins/{callerUid}` | `/admins/{targetUid}` | None | Overwrite existing admin doc | `role` in allowlist, `canteenIds` valid | `run-emulator-functions-test.js` |
| `createCanteen` | Callable | Yes | `platform_operator` | `canteenId`, `name`, `code` | `createdAt`, `updatedAt`, `isActive=true` | `/canteens/{canteenId}`, `/admins/{callerUid}` | `/canteens/{canteenId}` | None | Keyed by `canteenId` | Bounded strings, alphanumeric ID | `run-emulator-functions-test.js` |
| `updateCanteen` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `name` | `updatedAt` | `/canteens/{canteenId}`, `/admins/{callerUid}` | `/canteens/{canteenId}` | None | In-place update | Non-empty string <= 100 chars | `run-emulator-functions-test.js` |
| `setCanteenActive` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `isActive` | `updatedAt` | `/canteens/{canteenId}`, `/admins/{callerUid}` | `/canteens/{canteenId}` | None | Boolean state toggle | Boolean type required | `run-emulator-functions-test.js` |
| `createCategory` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `name`, `sortOrder` | `categoryId`, `createdAt`, `updatedAt`, `isActive=true` | `/canteens/{canteenId}`, `/admins/{callerUid}` | `/canteens/{cId}/categories/{catId}` | None | ID generation | `sortOrder` >= 0 int, `name` <= 50 | `run-emulator-functions-test.js` |
| `updateCategory` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `categoryId`, `name`, `sortOrder` | `updatedAt` | `/canteens/{cId}/categories/{catId}`, `/admins/{callerUid}` | `/canteens/{cId}/categories/{catId}` | None | In-place update | `name` <= 50, `sortOrder` >= 0 | `run-emulator-functions-test.js` |
| `setCategoryActive` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `categoryId`, `isActive` | `updatedAt` | `/canteens/{cId}/categories/{catId}`, `/admins/{callerUid}` | `/canteens/{cId}/categories/{catId}` | None | Boolean toggle | Boolean type required | `run-emulator-functions-test.js` |
| `createMenuItem` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `categoryId`, `name`, `priceInPaise`, `costPrice`, etc. | `itemId`, `createdAt`, `updatedAt`, `isAvailable=true`, `isActive=true` | `/canteens/{canteenId}`, category doc, admin doc | Public item doc + `/private/admin` doc | Isolates `costPrice` to private subcollection | Auto-generated doc ID | `priceInPaise` <= 500,000, HTTPS image | `run-emulator-functions-test.js` |
| `updateMenuItem` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `itemId`, `name`, `priceInPaise`, `costPrice` | `updatedAt` | Item doc, private doc, admin doc | Public item doc + `/private/admin` doc | Isolates `costPrice` to private subcollection | In-place update | Bounded strings, integer paise | `run-emulator-functions-test.js` |
| `setMenuItemAvailability` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `itemId`, `isAvailable` | `updatedAt` | Item doc, admin doc | Item doc (`isAvailable`) | None | Boolean toggle | Boolean required | `run-emulator-functions-test.js` |
| `setMenuItemActive` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `itemId`, `isActive` | `updatedAt` | Item doc, admin doc | Item doc (`isActive`) | None | Boolean toggle | Boolean required | `run-emulator-functions-test.js` |
| `createPickupSlot` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `slotDate`, `startTime`, `endTime`, `capacity` | `slotId`, `reservedCount=0`, `isOpen=true`, `timezone='Asia/Kolkata'` | Slot collection, admin doc | `/canteens/{cId}/pickupSlots/{slotId}` | None | Validates non-overlapping slots | Operating hours 08:00-19:00, cap >= 1 | `run-emulator-order-test.js` |
| `createOrder` | Callable | Yes | `student` (active) | `canteenId`, `pickupSlotId`, `paymentMethod`, `idempotencyKey`, `cartItems` | `studentUid`, `orderId`, `totalAmountInPaise`, item snapshots, `placedAt`, `status='placed'` | Student cart, menu items, pickup slot, admin records | `/orders/{orderId}`, slot increment, cart deletion, outbox notification | Zero sensitive gateway keys; masked student UID | Bound to `(studentUid, idempotencyKey)` with fingerprint check | Max 99 items, slot capacity bounds | `run-emulator-order-test.js` |
| `transitionOrderStatus` | Callable | Yes | `canteen_admin` (assigned) | `orderId`, `toStatus`, `reason` | `actorUid`, `timestamp`, `fromStatus` | `/orders/{orderId}`, admin doc, slot doc | `/orders/{orderId}`, `/statusHistory/{eventId}`, slot decrement if cancel/reject, outbox notif | None | Deterministic event ID `{orderId}_{from}_{to}` | Strict state machine transition rules | `run-emulator-status-test.js` |
| `verifyDemoPayment` | Callable | Yes | `student` (owner) | `orderId` | `status='payment_verified'`, `verifiedAt` | `/orders/{orderId}` | `/orders/{orderId}`, `/statusHistory/` | None | Replay returns idempotent `isRetry: true` | Requires online paymentMethod & `placed` status | `run-emulator-status-test.js` |
| `getAdminOrderQueue` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `statusFilter`, `limit`, `startAfter` | None | `/orders/` (canteen-scoped query) | None | Masks customer UID (`student_...ce_8`) | Read-only query | Bounded pagination (max 50) | `run-emulator-status-test.js` |
| `searchAdminOrder` | Callable | Yes | `canteen_admin` (assigned) | `canteenId`, `query` | None | `/orders/{orderId}` | None | Masks customer UID; returns `found: false` across canteens | Read-only search | Query length <= 64 chars | `run-emulator-status-test.js` |
| `listOperationalOrders` | Callable | Yes | `service_desk` or `canteen_admin` | `canteenId`, `statusFilter`, `limit`, `cursor` | None | `/orders/` (canteen-scoped query) | None | Strips payment secrets & provider references | Read-only query | Limit bounded 1-50 (default 20) | `run-emulator-service-desk-test.js` |
| `searchOperationalOrders` | Callable | Yes | `service_desk` or `canteen_admin` | `canteenId`, `query` | None | `/orders/{query}` (exact canteen-scoped read) | None | Masks customer UID; generic `found: false` | Read-only search | Query length 1-64 chars | `run-emulator-service-desk-test.js` |
| `getOperationalOrderDetails` | Callable | Yes | `service_desk` or `canteen_admin` | `canteenId`, `orderId` | None | Order doc, `/operationalNotes/`, `/auditEvents/` | None | Redacts raw provider credentials | Read-only query | Valid doc ID format | `run-emulator-service-desk-test.js` |
| `transitionOperationalOrderStatus` | Callable | Yes | `service_desk` or `canteen_admin` | `orderId`, `toStatus`, `reason` | `authorUid`, `authorRole`, `timestamp` | Order doc, admin doc, slot doc | Order doc, `/statusHistory/`, slot release, `/auditEvents/` | None | Deterministic status history ID | Valid state machine transitions only | `run-emulator-service-desk-test.js` |
| `createOperationalNote` | Callable | Yes | `service_desk` or `canteen_admin` | `orderId`, `noteText` | `noteId`, `authorUid`, `authorRole`, `createdAt` | Order doc, admin doc | `/orders/{orderId}/operationalNotes/{noteId}`, audit event | None | Auto-generated note ID | Note length 1-1000 chars, no control chars | `run-emulator-service-desk-test.js` |
| `createDemoPayment` | Callable | Yes | `student` (owner) | `orderId`, `paymentMethod`, `idempotencyKey` | `paymentId`, `amountInPaise`, `status='processing'`, `expiresAt` | Order doc, user paymentRequests | `/orders/{oId}/payments/{pId}`, paymentHistory, user request record | Synthetic provider ref only | Bound to `(studentUid, idempotencyKey)` | Max 3 failed attempts, order must be `placed` | `run-emulator-payment-test.js` |
| `completeDemoPayment` | Callable | Yes | `student` (owner) | `orderId`, `paymentId` | `status='succeeded_demo'`, `completedAt` | Order doc, payment doc | Order doc, payment doc, statusHistory, paymentHistory, outbox notif | None | Replay returns `isRetry: true` | Order must be `placed`, payment `processing` | `run-emulator-payment-test.js` |
| `failDemoPayment` | Callable | Yes | `student` (owner) | `orderId`, `paymentId`, `failureReason` | `status='failed'`, `failedAt` | Order doc, payment doc | Order (`paymentStatus='failed'`), payment doc, paymentHistory, outbox notif | None | Replay is safe | State separation: order remains `placed` | `run-emulator-payment-test.js` |
| `cancelDemoPayment` | Callable | Yes | `student` (owner) | `orderId`, `paymentId` | `status='cancelled'`, `cancelledAt` | Order doc, payment doc | Order (`paymentStatus='pending'`), payment doc, paymentHistory | None | Replay is safe | Payment must be `processing` | `run-emulator-payment-test.js` |
| `expirePaymentAttempt` | Callable | Yes | `student` (owner) or Admin | `orderId`, `paymentId` | `status='expired'`, `expiredAt` | Order doc, payment doc | Order (`paymentStatus='pending'`), payment doc, paymentHistory | None | Dual TTL check (order + payment TTL) | Validates dual TTL expiration | `run-emulator-payment-test.js` |
| `getPaymentStatus` | Callable | Yes | `student` (owner) or Admin | `orderId` | None | Order doc, active payment doc | None | Admin view masks synthetic `providerReference` | Read-only | Caller must own order or be assigned admin | `run-emulator-payment-test.js` |
| `requestDemoRefund` | Callable | Yes | `canteen_admin` (assigned) | `orderId`, `reason` | `refundId`, `refundStatus='pending'`, `refundReference` | Order doc, payment doc | Order doc, payment doc, paymentHistory, outbox notif | Synthetic refund reference | Order must be terminal (`cancelled`/`rejected`) | Cannot refund active order | `run-emulator-payment-test.js` |
| `completeDemoRefund` | Callable | Yes | `canteen_admin` (assigned) | `orderId` | `refundStatus='succeeded_demo'`, `completedAt` | Order doc, payment doc | Order doc, payment doc, paymentHistory, outbox notif | None | Replay is idempotent (`isRetry: true`) | Order status remains `cancelled`, not `refunded` | `run-emulator-payment-test.js` |
| `verifySyntheticWebhook` | HTTPS onRequest | No (HMAC auth) | Synthetic Gateway | Raw JSON Body, `x-synthetic-signature` header | `receivedAt`, `status='verified'` | Webhook deduplication doc, Order doc, Payment doc | `/webhookEvents/demo:{eventId}`, Order doc, Payment doc, history, outbox notif | Zero internal error disclosures | Idempotent via `/webhookEvents/demo:{eventId}` | HMAC-SHA256 signature verification over raw body | `run-emulator-payment-test.js` |
| `listMyNotifications` | Callable | Yes | `student` or Admin | `limit`, `cursor` | `recipientUid = context.auth.uid` | `/users/{uid}/notifications/` (query) | None | DTO contains sanitized template bodies only | Read-only query | Bounded pagination 1-50 (default 20) | `run-emulator-notifications-test.js` |
| `markNotificationRead` | Callable | Yes | `student` or Admin | `notificationId` | `recipientUid = context.auth.uid`, `readAt` | Notification doc | Notification doc (`isRead=true`, `readAt`) | None | In-place update (`isIdempotent: true` on replay) | Valid notification ID format | `run-emulator-notifications-test.js` |
| `markAllNotificationsRead` | Callable | Yes | `student` or Admin | `batchLimit`, `cursor` | `recipientUid = context.auth.uid`, `readAt` | Notifications query (unread) | Batch update up to 500 notifications | None | Cursor-based continuation | Max batch size 500 | `run-emulator-notifications-test.js` |
| `getUnreadNotificationCount` | Callable | Yes | `student` or Admin | None | `recipientUid = context.auth.uid` | Aggregate count query | None | Integer count only | Read-only aggregate | Scoped strictly to caller | `run-emulator-notifications-test.js` |

---

## 3. Client Screens & UI Navigation Inventory

### 3.1 React Native Screens (`src/screens/`)
1. `SplashScreen.tsx`: Initial startup screen while checking Firebase Auth session and profile status.
2. `LoginScreen.tsx`: Student phone number entry and OTP submission screen.
3. `AccountScreen.tsx`: Profile completion screen (`createStudentProfile`) for newly authenticated students.
4. `HomeScreen.tsx`: Canteen selector and category browsing dashboard.
5. `CategoryScreen.tsx`: Menu item listing with real-time stock/availability badges.
6. `CartScreen.tsx`: Student cart management with quantity controls and pickup slot selection.
7. `PaymentScreen.tsx`: Demo checkout and simulated UPI/Card payment screen.
8. `OrderHistoryScreen.tsx`: Student order tracking with live status updates.
9. `OrderConfirmedScreen.tsx`: Order placement confirmation modal.
10. `AdminLandingScreen.tsx`: Canteen admin order management dashboard, live queue, and status transition interface.
11. `MMAdminBlockScreen.tsx` & `MMLibraryScreen.tsx`: Canteen-specific catalog and category viewers.
12. `MMAdminCategoryScreen.tsx` & `MMLibraryCategoryScreen.tsx`: Category-level item listing.
13. `NotificationsScreen.tsx`: In-app notification center with read/unread tracking and pagination.
14. `AccessDeniedScreen.tsx`: Dedicated gatekeeper screen for suspended/deactivated student or admin accounts.
15. `ProfilScreen.tsx`: Student profile view and personal details editor.

### 3.2 Web / Service Desk Screen (`web/`)
1. `index.html`: Large-screen service-desk operator interface featuring order queue, search bar, virtual keyboard toggle, order details inspector, and operational note creator.
2. `server.js`: Local Node.js static and token-exchange harness listening on `http://localhost:5050` (local emulator only).

---

## 4. Firestore Collection & Subcollection Architecture

| Collection / Subcollection Path | Client Read Policy | Client Write Policy | Server SDK Access | Purpose |
|---|---|---|---|---|
| `/users/{userId}` | Owner only (`request.auth.uid == userId`) | Restricted update (`name`, `collegeId`, `updatedAt` only; no password) | Admin SDK | Student profiles |
| `/users/{userId}/cart/{itemKey}` | Owner only | Owner only (keys: `itemId`, `canteenId`, `quantity`, `updatedAt`) | Admin SDK | Real-time persistent cart |
| `/users/{userId}/orderRequests/{idempotencyKey}` | Owner only | `false` (Server only) | Admin SDK | Order idempotency record |
| `/users/{userId}/paymentRequests/{idempotencyKey}` | `false` | `false` (Server only) | Admin SDK | Payment idempotency record |
| `/users/{userId}/notifications/{notificationId}` | `false` (Callable only) | `false` (Callable only) | Admin SDK | In-app user notifications |
| `/users/{userId}/notificationOutbox/{eventId}` | `false` | `false` (Server only) | Admin SDK | Transactional notification outbox |
| `/admins/{adminId}` | Active owner only | `false` (Server only) | Admin SDK | Staff role & canteen assignments |
| `/canteens/{canteenId}` | Active or assigned admin | `false` (Server only) | Admin SDK | Canteen registry |
| `/canteens/{cId}/categories/{catId}` | Active or assigned admin | `false` (Server only) | Admin SDK | Menu categories |
| `/canteens/{cId}/items/{itemId}` | Active+Available or assigned admin | `false` (Server only) | Admin SDK | Menu catalog |
| `/canteens/{cId}/items/{itemId}/private/{docId}` | Assigned admin only | `false` (Server only) | Admin SDK | Wholesale & supplier cost data |
| `/canteens/{cId}/pickupSlots/{slotId}` | Open or assigned admin | `false` (Server only) | Admin SDK | Pickup capacity windows |
| `/orders/{orderId}` | Student owner or assigned admin | `false` (Server only) | Admin SDK | Authoritative orders |
| `/orders/{orderId}/statusHistory/{eventId}` | Student owner or assigned admin | `false` (Server only) | Admin SDK | Immutable status transitions |
| `/orders/{orderId}/payments/{paymentId}` | `false` (Callable only) | `false` (Callable only) | Admin SDK | Demo payment attempts |
| `/orders/{orderId}/paymentHistory/{eventId}` | `false` (Callable only) | `false` (Callable only) | Admin SDK | Immutable payment history |
| `/orders/{orderId}/webhookEvents/{eventId}` | `false` | `false` (Server only) | Admin SDK | Order-scoped webhook events |
| `/orders/{orderId}/operationalNotes/{noteId}` | `false` (Callable only) | `false` (Callable only) | Admin SDK | Staff operational notes |
| `/orders/{orderId}/auditEvents/{eventId}` | `false` (Callable only) | `false` (Callable only) | Admin SDK | Immutable audit trail |
| `/webhookEvents/demo:{eventId}` | `false` | `false` (Server only) | Admin SDK | Global webhook deduplication |
| `/notificationEvents/{eventId}` | `false` | `false` (Server only) | Admin SDK | Global notification event log |
| `/{document=**}` (Catch-all) | `false` | `false` | Admin SDK | Default deny for undefined paths |
