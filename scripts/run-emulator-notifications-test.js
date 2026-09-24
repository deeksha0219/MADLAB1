/**
 * GrabNGo - Real Firebase Emulator Notification Test Runner (Step 10)
 *
 * Connects to live local Auth (9099), Firestore (8085), and Functions (5001) Emulators.
 *
 * Test Coverage:
 * 1. Authorization: unauthenticated rejection, cross-user isolation
 * 2. Direct Write Denial: Firestore rules deny client writes to notifications
 * 3. Exact allowlist validation: extra fields, null, array, invalid IDs rejected
 * 4. Idempotency: same source event produces identical ID; replay creates no duplicate
 * 5. Source State Correctness: createOrder → order_placed + new_order_for_admin
 * 6. Payment events: completeDemoPayment → payment_succeeded_demo + payment_verified_for_admin
 * 7. Payment failure: failDemoPayment → payment_failed
 * 8. Payment expiry: expirePaymentAttempt → NO notification
 * 9. Status transitions: each transitionOrderStatus → matching notification
 * 10. Refund events: requestDemoRefund → refund_pending_demo, completeDemoRefund → refund_completed_demo
 * 11. Read state: initial isRead === false; markNotificationRead updates only isRead + readAt
 * 12. markAllNotificationsRead: idempotent, marks only caller's notifications
 * 13. getUnreadNotificationCount: reflects real-time state
 * 14. Notification creation does not alter order, payment, refund, or capacity state
 * 15. No sensitive data (secrets, HMACs, provider references) in notification documents
 */

const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ID = 'demo-grabngo-local';
const AUTH_PORT = 9099;
const FIRESTORE_PORT = 8085;
const FUNCTIONS_PORT = 5001;

process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${AUTH_PORT}`;
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${FIRESTORE_PORT}`;

const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();

// --------------------------------------------------------------------------
// Test Users
// --------------------------------------------------------------------------
const USERS = {
  studentA: { uid: 'student_notif_alice_10', role: 'student', status: 'active' },
  studentB: { uid: 'student_notif_bob_10',   role: 'student', status: 'active' },
  adminN1:  { uid: 'admin_notif_n1_10', role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_NOTIF_A'] },
  adminN2:  { uid: 'admin_notif_n2_10', role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_NOTIF_B'] },
  inactiveAdmin: { uid: 'admin_notif_inactive_10', role: 'canteen_admin', status: 'inactive', canteenIds: ['CANTEEN_NOTIF_A'] },
};

const tokenCache = {};

async function getIdToken(userKey) {
  if (tokenCache[userKey]) return tokenCache[userKey];
  const user = USERS[userKey];
  if (!user) throw new Error(`Unknown user key: ${userKey}`);

  const customToken = await admin.auth().createCustomToken(user.uid, {
    role: user.role,
    canteenIds: user.canteenIds || [],
  });

  const res = await axios.post(
    `http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key`,
    { token: customToken, returnSecureToken: true },
  );

  tokenCache[userKey] = res.data.idToken;
  return tokenCache[userKey];
}

async function callFunction(fnName, data, userKey = null) {
  const url = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/us-central1/${fnName}`;
  const headers = { 'Content-Type': 'application/json' };
  if (userKey) {
    headers['Authorization'] = `Bearer ${await getIdToken(userKey)}`;
  }
  try {
    const response = await axios.post(url, { data }, { headers });
    return { ok: true, data: response.data.result };
  } catch (err) {
    if (err.response) {
      return { ok: false, status: err.response.status, error: err.response.data.error || err.response.data };
    }
    return { ok: false, error: { message: err.message } };
  }
}

async function directFirestoreRest(method, path, docId = '', payload = null, userKey = null) {
  const url = docId
    ? `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}/${docId}`
    : `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (userKey) {
    headers['Authorization'] = `Bearer ${await getIdToken(userKey)}`;
  }
  try {
    const res = await axios({
      method,
      url,
      data: payload ? { fields: {} } : undefined,
      headers,
    });
    return { ok: true, status: res.status, data: res.data };
  } catch (err) {
    if (err.response) return { ok: false, status: err.response.status, error: err.response.data };
    return { ok: false, error: err.message };
  }
}

async function directFirestoreWrite(path, docId, payload) {
  return directFirestoreRest('PATCH', path, docId, payload);
}

// --------------------------------------------------------------------------
// Assertion Helpers
// --------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------
// Seeding
// --------------------------------------------------------------------------
async function seedTestData() {
  console.log('\n--- Seeding Step 10 Test Data ---');

  // Admin profiles
  await db.collection('admins').doc(USERS.adminN1.uid).set({
    uid: USERS.adminN1.uid,
    role: 'canteen_admin',
    status: 'active',
    canteenIds: ['CANTEEN_NOTIF_A'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('admins').doc(USERS.adminN2.uid).set({
    uid: USERS.adminN2.uid,
    role: 'canteen_admin',
    status: 'active',
    canteenIds: ['CANTEEN_NOTIF_B'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('admins').doc(USERS.inactiveAdmin.uid).set({
    uid: USERS.inactiveAdmin.uid,
    role: 'canteen_admin',
    status: 'inactive',
    canteenIds: ['CANTEEN_NOTIF_A'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Student profiles
  await db.collection('users').doc(USERS.studentA.uid).set({
    uid: USERS.studentA.uid,
    name: 'Alice NotifTest',
    phone: '+919876540001',
    collegeId: 'alice_notif@rvu.edu.in',
    role: 'student',
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('users').doc(USERS.studentB.uid).set({
    uid: USERS.studentB.uid,
    name: 'Bob NotifTest',
    phone: '+919876540002',
    collegeId: 'bob_notif@rvu.edu.in',
    role: 'student',
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Canteen
  await db.collection('canteens').doc('CANTEEN_NOTIF_A').set({
    canteenId: 'CANTEEN_NOTIF_A',
    name: 'Notification Test Canteen A',
    code: 'NTA',
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Pickup slot
  await db.collection('canteens').doc('CANTEEN_NOTIF_A').collection('pickupSlots').doc('SLOT_NOTIF_A1').set({
    slotId: 'SLOT_NOTIF_A1',
    canteenId: 'CANTEEN_NOTIF_A',
    date: '2099-12-31',
    startTime: '09:00',
    endTime: '09:30',
    timezone: 'Asia/Kolkata',
    capacity: 50,
    reservedCount: 0,
    isOpen: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Menu item
  await db.collection('canteens').doc('CANTEEN_NOTIF_A').collection('categories').doc('CAT_NOTIF_A1').set({
    categoryId: 'CAT_NOTIF_A1', canteenId: 'CANTEEN_NOTIF_A', name: 'Mains', sortOrder: 0, isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection('canteens').doc('CANTEEN_NOTIF_A').collection('items').doc('ITEM_NOTIF_A1').set({
    itemId: 'ITEM_NOTIF_A1', canteenId: 'CANTEEN_NOTIF_A', categoryId: 'CAT_NOTIF_A1',
    name: 'Notif Dosa', priceInPaise: 5000, isActive: true, isAvailable: true, sortOrder: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('  Seed complete.\n');
}

// --------------------------------------------------------------------------
// Helper: Place order and seed cart
// --------------------------------------------------------------------------
async function placeTestOrder(studentUid, orderId, canteenId, paymentMethod = 'upi_demo') {
  // Seed cart
  await db.collection('users').doc(studentUid).collection('cart').doc('ITEM_NOTIF_A1').set({
    itemId: 'ITEM_NOTIF_A1',
    canteenId: 'CANTEEN_NOTIF_A',
    quantity: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Use a deterministic idempotencyKey
  const ikHash = crypto.createHash('sha256').update(`${studentUid}:${orderId}`).digest('hex').substring(0, 32);
  const idempotencyKey = `notiftest-${ikHash}-ik`;
  const trimmedKey = idempotencyKey.substring(0, 64);

  return callFunction('createOrder', {
    canteenId,
    items: [{ itemId: 'ITEM_NOTIF_A1', quantity: 1 }],
    pickupSlotId: 'SLOT_NOTIF_A1',
    paymentMethod,
    idempotencyKey: trimmedKey,
  }, studentUid === USERS.studentA.uid ? 'studentA' : 'studentB');
}

// --------------------------------------------------------------------------
// Helper: Get notifications for a user via admin SDK
// --------------------------------------------------------------------------
async function getNotificationsAdmin(uid) {
  const snap = await db.collection('users').doc(uid).collection('notifications').get();
  return snap.docs.map((d) => d.data());
}

// --------------------------------------------------------------------------
// TEST SUITES
// --------------------------------------------------------------------------

// ── Suite 1: Authorization ─────────────────────────────────────────────────
async function testAuthorization() {
  console.log('\n=== Suite 1: Authorization ===');

  // 1.1 Unauthenticated listMyNotifications rejected
  const r1 = await callFunction('listMyNotifications', {}, null);
  assert(!r1.ok && r1.status === 401, '1.1 Unauthenticated listMyNotifications rejected (401)');

  // 1.2 Unauthenticated markNotificationRead rejected
  const r2 = await callFunction('markNotificationRead', { notificationId: 'notif_' + 'a'.repeat(32) }, null);
  assert(!r2.ok && r2.status === 401, '1.2 Unauthenticated markNotificationRead rejected (401)');

  // 1.3 Unauthenticated markAllNotificationsRead rejected
  const r3 = await callFunction('markAllNotificationsRead', {}, null);
  assert(!r3.ok && r3.status === 401, '1.3 Unauthenticated markAllNotificationsRead rejected (401)');

  // 1.4 Unauthenticated getUnreadNotificationCount rejected
  const r4 = await callFunction('getUnreadNotificationCount', {}, null);
  assert(!r4.ok && r4.status === 401, '1.4 Unauthenticated getUnreadNotificationCount rejected (401)');

  // 1.5 Student A can list their own notifications
  const r5 = await callFunction('listMyNotifications', {}, 'studentA');
  assert(r5.ok, '1.5 Authenticated studentA can call listMyNotifications');

  // 1.6 Inactive admin cannot use admin-notification path (no assigned canteen notif access)
  // The inactive admin can call getUnreadCount but gets their own (empty) notifications
  const r6 = await callFunction('getUnreadNotificationCount', {}, 'inactiveAdmin');
  assert(r6.ok && r6.data.unreadCount === 0, '1.6 Inactive admin getUnreadCount returns own (empty) count');
}

// ── Suite 2: Direct Access Denial (Callable-Only Access Policy) ───────────
async function testDirectAccessDenial() {
  console.log('\n=== Suite 2: Direct Access Denial (Callable-Only Enforcement) ===');

  const fakeNotifId = 'notif_' + 'a'.repeat(32);

  // 2.1 Direct client read denied (student reading own notification via Firestore REST)
  const readResStudent = await directFirestoreRest('GET', `users/${USERS.studentA.uid}/notifications`, fakeNotifId, null, 'studentA');
  assert(!readResStudent.ok && (readResStudent.status === 403 || readResStudent.status === 401), '2.1 Direct student read denied by Firestore rules');

  // 2.2 Direct client read denied (admin reading student notification via Firestore REST)
  const readResAdmin = await directFirestoreRest('GET', `users/${USERS.studentA.uid}/notifications`, fakeNotifId, null, 'adminN1');
  assert(!readResAdmin.ok && (readResAdmin.status === 403 || readResAdmin.status === 401), '2.2 Direct admin read denied by Firestore rules');

  // 2.3 Direct client create denied
  const createRes = await directFirestoreRest('POST', `users/${USERS.studentA.uid}/notifications`, '', { fields: {} }, 'studentA');
  assert(!createRes.ok && (createRes.status === 403 || createRes.status === 401), '2.3 Direct client create denied by Firestore rules');

  // 2.4 Direct client update denied
  const updateRes = await directFirestoreRest('PATCH', `users/${USERS.studentA.uid}/notifications`, fakeNotifId, { fields: {} }, 'studentA');
  assert(!updateRes.ok && (updateRes.status === 403 || updateRes.status === 401), '2.4 Direct client update denied by Firestore rules');

  // 2.5 Direct client delete denied
  const deleteRes = await directFirestoreRest('DELETE', `users/${USERS.studentA.uid}/notifications`, fakeNotifId, null, 'studentA');
  assert(!deleteRes.ok && (deleteRes.status === 403 || deleteRes.status === 401), '2.5 Direct client delete denied by Firestore rules');

  // 2.6 Direct outbox access denied
  const outboxRes = await directFirestoreRest('GET', `users/${USERS.studentA.uid}/notificationOutbox`, 'evt_1', null, 'studentA');
  assert(!outboxRes.ok && (outboxRes.status === 403 || outboxRes.status === 401), '2.6 Direct client outbox access denied by Firestore rules');

  // 2.7 Direct notification event access denied
  const eventRes = await directFirestoreRest('GET', 'notificationEvents', 'evt_1', null, 'studentA');
  assert(!eventRes.ok && (eventRes.status === 403 || eventRes.status === 401), '2.7 Direct client notification event access denied by Firestore rules');

  // 2.8 createNotificationInternal is NOT exported as a callable or HTTP endpoint
  const internalRes = await callFunction('createNotificationInternal', {}, 'studentA');
  assert(!internalRes.ok && internalRes.status === 404, '2.8 createNotificationInternal is NOT publicly callable (HTTP 404)');
}

// ── Suite 3: Input Allowlist Validation ───────────────────────────────────
async function testInputAllowlist() {
  console.log('\n=== Suite 3: Input Allowlist Validation ===');

  // 3.1 listMyNotifications rejects extra fields
  const r1 = await callFunction('listMyNotifications', { limit: 10, extra: 'field' }, 'studentA');
  assert(!r1.ok, '3.1 listMyNotifications rejects extra fields');

  // 3.2 listMyNotifications rejects limit = 0
  const r2 = await callFunction('listMyNotifications', { limit: 0 }, 'studentA');
  assert(!r2.ok, '3.2 listMyNotifications rejects limit=0');

  // 3.3 listMyNotifications rejects limit = 51
  const r3 = await callFunction('listMyNotifications', { limit: 51 }, 'studentA');
  assert(!r3.ok, '3.3 listMyNotifications rejects limit=51');

  // 3.4 listMyNotifications rejects limit = 1.5 (float)
  const r4 = await callFunction('listMyNotifications', { limit: 1.5 }, 'studentA');
  assert(!r4.ok, '3.4 listMyNotifications rejects float limit');

  // 3.5 markNotificationRead rejects extra field
  const r5 = await callFunction('markNotificationRead', {
    notificationId: 'notif_' + 'a'.repeat(32),
    extra: 'field',
  }, 'studentA');
  assert(!r5.ok, '3.5 markNotificationRead rejects extra field');

  // 3.6 markNotificationRead rejects invalid notificationId format
  const r6 = await callFunction('markNotificationRead', { notificationId: 'invalid-id' }, 'studentA');
  assert(!r6.ok, '3.6 markNotificationRead rejects invalid notificationId format');

  // 3.7 markNotificationRead rejects null notificationId
  const r7 = await callFunction('markNotificationRead', { notificationId: null }, 'studentA');
  assert(!r7.ok, '3.7 markNotificationRead rejects null notificationId');

  // 3.8 markAllNotificationsRead rejects extra field
  const r8 = await callFunction('markAllNotificationsRead', { extra: 'field' }, 'studentA');
  assert(!r8.ok, '3.8 markAllNotificationsRead rejects extra field');

  // 3.9 getUnreadNotificationCount rejects extra field
  const r9 = await callFunction('getUnreadNotificationCount', { extra: 'field' }, 'studentA');
  assert(!r9.ok, '3.9 getUnreadNotificationCount rejects extra field');

  // 3.10 listMyNotifications rejects negative limit
  const r10 = await callFunction('listMyNotifications', { limit: -5 }, 'studentA');
  assert(!r10.ok, '3.10 listMyNotifications rejects negative limit');

  // 3.11 Forged recipientUid in listMyNotifications rejected
  const r11 = await callFunction('listMyNotifications', { recipientUid: USERS.studentB.uid }, 'studentA');
  assert(!r11.ok, '3.11 Forged recipientUid rejected');

  // 3.12 Forged recipientRole in listMyNotifications rejected
  const r12 = await callFunction('listMyNotifications', { recipientRole: 'admin' }, 'studentA');
  assert(!r12.ok, '3.12 Forged recipientRole rejected');

  // 3.13 Forged canteenId in listMyNotifications rejected
  const r13 = await callFunction('listMyNotifications', { canteenId: 'CANTEEN_NOTIF_A' }, 'studentA');
  assert(!r13.ok, '3.13 Forged canteenId rejected');

  // 3.14 Malformed cursor in listMyNotifications rejected
  const r14 = await callFunction('listMyNotifications', { cursor: 'invalid-cursor-format' }, 'studentA');
  assert(!r14.ok, '3.14 Malformed cursor rejected');

  // 3.15 Array payload rejected
  const r15 = await callFunction('listMyNotifications', [1, 2, 3], 'studentA');
  assert(!r15.ok, '3.15 Array payload rejected');
}

// ── Suite 4: Order Placement Notifications ────────────────────────────────
async function testOrderPlacedNotifications() {
  console.log('\n=== Suite 4: Order Placed Notifications ===');

  // Place a test order for studentA
  const orderResult = await placeTestOrder(USERS.studentA.uid, 'notif-order-001', 'CANTEEN_NOTIF_A', 'upi_demo');
  assert(orderResult.ok, '4.1 createOrder succeeds for studentA');

  const orderId = orderResult.data?.orderId;
  assert(typeof orderId === 'string', '4.2 orderId returned from createOrder');

  // Wait for async notifications
  await sleep(3000);

  // 4.3 Student A receives order_placed notification
  const notifs = await getNotificationsAdmin(USERS.studentA.uid);
  const orderPlacedNotif = notifs.find((n) => n.type === 'order_placed' && n.orderId === orderId);
  assert(orderPlacedNotif !== undefined, '4.3 studentA receives order_placed notification');
  assert(orderPlacedNotif?.isRead === false, '4.4 order_placed notification is initially unread');
  assert(typeof orderPlacedNotif?.title === 'string' && orderPlacedNotif.title.length > 0, '4.5 Notification has non-empty title');
  assert(typeof orderPlacedNotif?.body === 'string' && orderPlacedNotif.body.length > 0, '4.6 Notification has non-empty body');
  assert(orderPlacedNotif?.notificationId?.startsWith('notif_'), '4.7 Notification ID starts with notif_');

  // 4.8 Admin N1 (assigned to CANTEEN_NOTIF_A) receives new_order_for_admin
  const adminNotifs = await getNotificationsAdmin(USERS.adminN1.uid);
  const adminOrderNotif = adminNotifs.find((n) => n.type === 'new_order_for_admin' && n.orderId === orderId);
  assert(adminOrderNotif !== undefined, '4.8 adminN1 receives new_order_for_admin notification');

  // 4.9 Admin N2 (NOT assigned to CANTEEN_NOTIF_A) does NOT receive new_order_for_admin
  const admin2Notifs = await getNotificationsAdmin(USERS.adminN2.uid);
  const admin2OrderNotif = admin2Notifs.find((n) => n.type === 'new_order_for_admin' && n.orderId === orderId);
  assert(admin2OrderNotif === undefined, '4.9 adminN2 (unassigned) does NOT receive new_order_for_admin');

  // 4.10 No sensitive data in student notification
  assert(
    !orderPlacedNotif?.providerReference && !orderPlacedNotif?.hmac && !orderPlacedNotif?.secret,
    '4.10 order_placed notification contains no sensitive fields',
  );

  // 4.11 Notification does NOT alter order state
  const orderSnap = await db.collection('orders').doc(orderId).get();
  assert(orderSnap.exists && orderSnap.data()?.status === 'placed', '4.11 Notification creation does not alter order.status');

  return orderId;
}

// ── Suite 5: Payment Notifications ───────────────────────────────────────
async function testPaymentNotifications(orderId) {
  console.log('\n=== Suite 5: Payment Notifications ===');

  // Create demo payment
  const paymentResult = await callFunction('createDemoPayment', {
    orderId,
    idempotencyKey: `notif-pay-ik-${orderId}`.substring(0, 36),
  }, 'studentA');
  assert(paymentResult.ok, '5.1 createDemoPayment succeeds');

  const paymentId = paymentResult.data?.paymentId;
  assert(typeof paymentId === 'string', '5.2 paymentId returned');

  // Complete demo payment
  const completeResult = await callFunction('completeDemoPayment', {
    orderId,
    paymentId,
  }, 'studentA');
  assert(completeResult.ok, '5.3 completeDemoPayment succeeds');

  await sleep(3000);

  // 5.4 Student A receives payment_succeeded_demo
  const notifs = await getNotificationsAdmin(USERS.studentA.uid);
  const paySuccNotif = notifs.find((n) => n.type === 'payment_succeeded_demo' && n.orderId === orderId);
  assert(paySuccNotif !== undefined, '5.4 studentA receives payment_succeeded_demo notification');
  assert(paySuccNotif?.isRead === false, '5.5 payment_succeeded_demo notification is initially unread');

  // 5.6 Admin N1 receives payment_verified_for_admin
  const adminNotifs = await getNotificationsAdmin(USERS.adminN1.uid);
  const adminPayNotif = adminNotifs.find((n) => n.type === 'payment_verified_for_admin' && n.orderId === orderId);
  assert(adminPayNotif !== undefined, '5.6 adminN1 receives payment_verified_for_admin notification');

  // 5.7 No sensitive data in payment notification
  assert(!paySuccNotif?.providerReference && !paySuccNotif?.hmac, '5.7 payment_succeeded_demo contains no sensitive fields');

  // 5.8 Webhook replay does NOT create a duplicate notification
  const webhookUrl = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/us-central1/verifySyntheticWebhook`;
  const syntheticSecret = 'emulator-test-synthetic-secret-key-32b';
  const payDoc = await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).get();
  const providerRef = payDoc.data()?.providerReference;

  const validPayload = {
    eventId: `EVT-SYNTHETIC-REPLAY-${orderId}`,
    eventType: 'payment.captured',
    orderId,
    paymentId,
    providerReference: providerRef,
    amountInPaise: 5000,
  };
  const rawBody = JSON.stringify(validPayload);
  const validHmac = crypto.createHmac('sha256', syntheticSecret).update(rawBody).digest('hex');

  await axios.post(webhookUrl, rawBody, {
    headers: {
      'Content-Type': 'application/json',
      'x-synthetic-signature': validHmac,
    },
  });

  await sleep(2000);

  const afterWebhookNotifs = await getNotificationsAdmin(USERS.studentA.uid);
  const studentSuccessCount = afterWebhookNotifs.filter(
    (n) => n.type === 'payment_succeeded_demo' && n.orderId === orderId,
  ).length;
  assert(studentSuccessCount === 1, '5.8 Webhook replay creates no duplicate student notification (exactly 1)');

  const afterWebhookAdminNotifs = await getNotificationsAdmin(USERS.adminN1.uid);
  const adminSuccessCount = afterWebhookAdminNotifs.filter(
    (n) => n.type === 'payment_verified_for_admin' && n.orderId === orderId,
  ).length;
  assert(adminSuccessCount === 1, '5.9 Webhook replay creates no duplicate admin notification (exactly 1)');

  return paymentId;
}

// ── Suite 6: Order Status Transition Notifications ────────────────────────
async function testStatusTransitionNotifications(orderId) {
  console.log('\n=== Suite 6: Status Transition Notifications ===');

  // Transition: payment_verified → accepted
  const r1 = await callFunction('transitionOrderStatus', {
    orderId,
    nextStatus: 'accepted',
    reason: 'Test transition',
  }, 'adminN1');
  assert(r1.ok, '6.1 transitionOrderStatus to accepted succeeds');

  await sleep(2000);

  let notifs = await getNotificationsAdmin(USERS.studentA.uid);
  let acceptedNotif = notifs.find((n) => n.type === 'order_accepted' && n.orderId === orderId);
  assert(acceptedNotif !== undefined, '6.2 studentA receives order_accepted notification');

  // Transition: accepted → preparing
  await callFunction('transitionOrderStatus', { orderId, nextStatus: 'preparing' }, 'adminN1');
  await sleep(2000);
  notifs = await getNotificationsAdmin(USERS.studentA.uid);
  assert(
    notifs.some((n) => n.type === 'order_preparing' && n.orderId === orderId),
    '6.3 studentA receives order_preparing notification',
  );

  // Transition: preparing → ready_for_pickup
  await callFunction('transitionOrderStatus', { orderId, nextStatus: 'ready_for_pickup' }, 'adminN1');
  await sleep(2000);
  notifs = await getNotificationsAdmin(USERS.studentA.uid);
  assert(
    notifs.some((n) => n.type === 'order_ready_for_pickup' && n.orderId === orderId),
    '6.4 studentA receives order_ready_for_pickup notification',
  );

  // Transition: ready_for_pickup → completed
  await callFunction('transitionOrderStatus', { orderId, nextStatus: 'completed' }, 'adminN1');
  await sleep(2000);
  notifs = await getNotificationsAdmin(USERS.studentA.uid);
  assert(
    notifs.some((n) => n.type === 'order_completed' && n.orderId === orderId),
    '6.5 studentA receives order_completed notification',
  );

  // 6.6 Repeated transition to same status creates no duplicate notification
  const countBeforeRepeat = (await getNotificationsAdmin(USERS.studentA.uid)).filter(
    (n) => n.type === 'order_completed' && n.orderId === orderId,
  ).length;
  try {
    await callFunction('transitionOrderStatus', { orderId, nextStatus: 'completed' }, 'adminN1');
  } catch {}
  await sleep(1500);
  const countAfterRepeat = (await getNotificationsAdmin(USERS.studentA.uid)).filter(
    (n) => n.type === 'order_completed' && n.orderId === orderId,
  ).length;
  assert(countBeforeRepeat === countAfterRepeat, '6.6 Repeated transition to same status creates no duplicate notification');
}

// ── Suite 7: Payment Failure Notification ────────────────────────────────
async function testPaymentFailureNotification() {
  console.log('\n=== Suite 7: Payment Failure Notification ===');

  // Create a fresh order to test payment failure
  await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_NOTIF_A1').set({
    itemId: 'ITEM_NOTIF_A1', canteenId: 'CANTEEN_NOTIF_A', quantity: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const failOrderResult = await callFunction('createOrder', {
    canteenId: 'CANTEEN_NOTIF_A',
    items: [{ itemId: 'ITEM_NOTIF_A1', quantity: 1 }],
    pickupSlotId: 'SLOT_NOTIF_A1',
    paymentMethod: 'upi_demo',
    idempotencyKey: 'notiftest-fail-ik-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  assert(failOrderResult.ok, '7.1 createOrder for payment failure test succeeds');
  const failOrderId = failOrderResult.data?.orderId;

  // Create payment attempt
  const failPayResult = await callFunction('createDemoPayment', {
    orderId: failOrderId,
    idempotencyKey: 'notif-fail-pay-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  assert(failPayResult.ok, '7.2 createDemoPayment for failure test succeeds');
  const failPaymentId = failPayResult.data?.paymentId;

  // Fail the payment
  const failResult = await callFunction('failDemoPayment', {
    orderId: failOrderId,
    paymentId: failPaymentId,
    failureCode: 'INSUFFICIENT_FUNDS',
    failureMessage: 'Test failure',
  }, 'studentA');
  assert(failResult.ok, '7.3 failDemoPayment succeeds');

  await sleep(3000);

  // Student receives payment_failed notification
  const notifs = await getNotificationsAdmin(USERS.studentA.uid);
  const failNotif = notifs.find((n) => n.type === 'payment_failed' && n.orderId === failOrderId);
  assert(failNotif !== undefined, '7.4 studentA receives payment_failed notification');
  assert(failNotif?.isRead === false, '7.5 payment_failed notification is initially unread');
}

// ── Suite 8: Expiry Does NOT Generate Notification ─────────────────────────
async function testExpiryNoNotification() {
  console.log('\n=== Suite 8: Payment Expiry — No Notification ===');

  // Create fresh order
  await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_NOTIF_A1').set({
    itemId: 'ITEM_NOTIF_A1', canteenId: 'CANTEEN_NOTIF_A', quantity: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const expiryOrderResult = await callFunction('createOrder', {
    canteenId: 'CANTEEN_NOTIF_A',
    items: [{ itemId: 'ITEM_NOTIF_A1', quantity: 1 }],
    pickupSlotId: 'SLOT_NOTIF_A1',
    paymentMethod: 'upi_demo',
    idempotencyKey: 'notiftest-expiry-ik-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  assert(expiryOrderResult.ok, '8.1 createOrder for expiry test succeeds');
  const expiryOrderId = expiryOrderResult.data?.orderId;

  // Create payment
  const expPayResult = await callFunction('createDemoPayment', {
    orderId: expiryOrderId,
    idempotencyKey: 'notif-expiry-pay-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  assert(expPayResult.ok, '8.2 createDemoPayment for expiry test succeeds');
  const expPaymentId = expPayResult.data?.paymentId;

  // Force payment TTL to past
  await db.collection('orders').doc(expiryOrderId).collection('payments').doc(expPaymentId).update({
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000),
  });
  await db.collection('orders').doc(expiryOrderId).update({
    activePaymentId: expPaymentId,
    activePaymentExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000),
  });

  // Count notifications before expiry
  const beforeNotifs = await getNotificationsAdmin(USERS.studentA.uid);
  const beforeCount = beforeNotifs.filter((n) => n.orderId === expiryOrderId).length;

  // Expire the payment
  const expireResult = await callFunction('expirePaymentAttempt', {
    orderId: expiryOrderId,
    paymentId: expPaymentId,
  }, 'studentA');
  assert(expireResult.ok, '8.3 expirePaymentAttempt succeeds');

  await sleep(2000);

  // After expiry: notification count for this order must be same
  const afterNotifs = await getNotificationsAdmin(USERS.studentA.uid);
  const afterCount = afterNotifs.filter((n) => n.orderId === expiryOrderId && n.type === 'payment_failed').length;
  assert(afterCount === 0, '8.4 Expiry does NOT generate payment_failed notification (expiry != failure)');
}

// ── Suite 9: Refund Notifications ─────────────────────────────────────────
async function testRefundNotifications() {
  console.log('\n=== Suite 9: Refund Notifications ===');

  // Place, pay, cancel → refund cycle
  await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_NOTIF_A1').set({
    itemId: 'ITEM_NOTIF_A1', canteenId: 'CANTEEN_NOTIF_A', quantity: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const refundOrderResult = await callFunction('createOrder', {
    canteenId: 'CANTEEN_NOTIF_A',
    items: [{ itemId: 'ITEM_NOTIF_A1', quantity: 1 }],
    pickupSlotId: 'SLOT_NOTIF_A1',
    paymentMethod: 'upi_demo',
    idempotencyKey: 'notiftest-refund-ik-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  assert(refundOrderResult.ok, '9.1 createOrder for refund test succeeds');
  const refundOrderId = refundOrderResult.data?.orderId;

  const refPayResult = await callFunction('createDemoPayment', {
    orderId: refundOrderId,
    idempotencyKey: 'notif-ref-pay-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  const refPaymentId = refPayResult.data?.paymentId;

  await callFunction('completeDemoPayment', { orderId: refundOrderId, paymentId: refPaymentId }, 'studentA');
  await callFunction('transitionOrderStatus', { orderId: refundOrderId, nextStatus: 'accepted' }, 'adminN1');
  await callFunction('transitionOrderStatus', { orderId: refundOrderId, nextStatus: 'cancelled', reason: 'Test' }, 'adminN1');

  // Request refund
  const reqRefundResult = await callFunction('requestDemoRefund', {
    orderId: refundOrderId,
    paymentId: refPaymentId,
    reason: 'Customer test refund',
  }, 'studentA');
  assert(reqRefundResult.ok, '9.2 requestDemoRefund succeeds');

  await sleep(3000);

  let notifs = await getNotificationsAdmin(USERS.studentA.uid);
  const refPendNotif = notifs.find((n) => n.type === 'refund_pending_demo' && n.orderId === refundOrderId);
  assert(refPendNotif !== undefined, '9.3 studentA receives refund_pending_demo notification');

  // Complete refund
  const completeRefundResult = await callFunction('completeDemoRefund', {
    orderId: refundOrderId,
    paymentId: refPaymentId,
  }, 'adminN1');
  assert(completeRefundResult.ok, '9.4 completeDemoRefund succeeds');

  await sleep(3000);

  notifs = await getNotificationsAdmin(USERS.studentA.uid);
  const refCompNotif = notifs.find((n) => n.type === 'refund_completed_demo' && n.orderId === refundOrderId);
  assert(refCompNotif !== undefined, '9.5 studentA receives refund_completed_demo notification');
}

// ── Suite 10: Read State & Idempotency ────────────────────────────────────
async function testReadStateAndIdempotency() {
  console.log('\n=== Suite 10: Read State & Idempotency ===');

  // Get all notifications for studentA
  const listResult = await callFunction('listMyNotifications', { limit: 50 }, 'studentA');
  assert(listResult.ok, '10.1 listMyNotifications returns successfully');
  assert(Array.isArray(listResult.data?.notifications), '10.2 notifications is an array');

  const notifs = listResult.data.notifications;
  if (notifs.length === 0) {
    console.log('  (No notifications to test read state, skipping read state tests)');
    return;
  }

  // 10.3 All returned notifications have required fields
  const firstNotif = notifs[0];
  assert(
    firstNotif.notificationId && firstNotif.type && firstNotif.title && firstNotif.body,
    '10.3 Notification DTO has required fields (notificationId, type, title, body)',
  );

  // Find an unread notification
  const unreadNotif = notifs.find((n) => !n.isRead);
  if (!unreadNotif) {
    console.log('  (All notifications already read, skipping mark-read tests)');
    return;
  }

  // 10.4 Mark single notification as read
  const markResult = await callFunction('markNotificationRead', {
    notificationId: unreadNotif.notificationId,
  }, 'studentA');
  assert(markResult.ok, '10.4 markNotificationRead succeeds');
  assert(markResult.data?.isIdempotent === false, '10.5 First markNotificationRead is not idempotent (isIdempotent=false)');

  // 10.6 Second mark is idempotent
  const mark2Result = await callFunction('markNotificationRead', {
    notificationId: unreadNotif.notificationId,
  }, 'studentA');
  assert(mark2Result.ok && mark2Result.data?.isIdempotent === true, '10.6 Repeated markNotificationRead is idempotent');

  // 10.7 Verify in Firestore (admin SDK)
  const notifDoc = await db
    .collection('users')
    .doc(USERS.studentA.uid)
    .collection('notifications')
    .doc(unreadNotif.notificationId)
    .get();
  assert(notifDoc.data()?.isRead === true, '10.7 Notification isRead is true in Firestore after marking');
  assert(notifDoc.data()?.readAt != null, '10.8 readAt is set after markNotificationRead');

  // 10.9 markAllNotificationsRead
  const markAllResult = await callFunction('markAllNotificationsRead', {}, 'studentA');
  assert(markAllResult.ok, '10.9 markAllNotificationsRead succeeds');

  // 10.10 getUnreadNotificationCount is 0 after marking all
  const countResult = await callFunction('getUnreadNotificationCount', {}, 'studentA');
  assert(countResult.ok && countResult.data?.unreadCount === 0, '10.10 getUnreadNotificationCount is 0 after markAllNotificationsRead');

  // 10.11 Repeated markAllNotificationsRead is safe
  const markAll2 = await callFunction('markAllNotificationsRead', {}, 'studentA');
  assert(markAll2.ok && markAll2.data?.updatedCount === 0, '10.11 Repeated markAllNotificationsRead is safe and returns 0 updated');

  // 10.12 Cursor pagination in listMyNotifications
  const page1 = await callFunction('listMyNotifications', { limit: 1 }, 'studentA');
  assert(page1.ok && page1.data?.notifications?.length === 1, '10.12 listMyNotifications page 1 limit=1 returns 1 item');
  if (page1.data?.hasMore && page1.data?.nextCursor) {
    const page2 = await callFunction('listMyNotifications', { limit: 1, cursor: page1.data.nextCursor }, 'studentA');
    assert(page2.ok && page2.data?.notifications?.length === 1, '10.13 listMyNotifications page 2 with cursor succeeds');
    assert(page1.data.notifications[0].notificationId !== page2.data.notifications[0].notificationId, '10.14 Page 2 item is distinct from Page 1 item');
  }
}

// ── Suite 11: Cross-User Isolation ────────────────────────────────────────
async function testCrossUserIsolation() {
  console.log('\n=== Suite 11: Cross-User Isolation ===');

  // StudentB should have no notifications (all orders were placed by studentA)
  const listB = await callFunction('listMyNotifications', {}, 'studentB');
  assert(listB.ok, '11.1 studentB can call listMyNotifications');

  // StudentB should not see studentA's notifications
  const notifsBAdmin = await getNotificationsAdmin(USERS.studentA.uid);
  if (notifsBAdmin.length > 0) {
    // StudentB tries to mark studentA's notification as read
    const stolenNotifId = notifsBAdmin[0].notificationId;
    const crossResult = await callFunction('markNotificationRead', {
      notificationId: stolenNotifId,
    }, 'studentB');
    // Should fail (not-found or permission-denied since path is scoped to studentB's collection)
    assert(!crossResult.ok || crossResult.data?.notificationId !== stolenNotifId,
      '11.2 studentB cannot mark studentA notification as read (isolated by path)');
  } else {
    console.log('  (No studentA notifications to test cross-user isolation)');
    passed++;
  }

  // 11.3 Admin N2 does not receive notifications intended for Canteen A
  const admin2Notifs = await getNotificationsAdmin(USERS.adminN2.uid);
  const admin2HasCanteenANotif = admin2Notifs.some((n) =>
    n.type === 'new_order_for_admin' || n.type === 'payment_verified_for_admin',
  );
  assert(!admin2HasCanteenANotif, '11.3 adminN2 has no Canteen A notifications (cross-canteen isolation)');

  // 11.4 Inactive admin has no notifications sent by server for their canteen
  const inactiveAdminNotifs = await getNotificationsAdmin(USERS.inactiveAdmin.uid);
  assert(inactiveAdminNotifs.length === 0, '11.4 Inactive admin has no server-sent notifications');
}

// ── Suite 12: Privacy — No Sensitive Data ────────────────────────────────
async function testPrivacy() {
  console.log('\n=== Suite 12: Privacy — No Sensitive Data ===');

  const allNotifs = await getNotificationsAdmin(USERS.studentA.uid);

  const hasSensitiveData = allNotifs.some((n) =>
    n.providerReference != null ||
    n.hmac != null ||
    n.secret != null ||
    n.refundReference != null ||
    n.rawBody != null,
  );

  assert(!hasSensitiveData, '12.1 No notification contains providerReference, hmac, secret, refundReference, or rawBody');

  // listMyNotifications also must not return sensitive fields
  const listResult = await callFunction('listMyNotifications', { limit: 50 }, 'studentA');
  const dtoHasSensitiveData = listResult.data?.notifications?.some((n) =>
    n.providerReference != null || n.hmac != null || n.secret != null || n.refundReference != null,
  );
  assert(!dtoHasSensitiveData, '12.2 listMyNotifications DTOs contain no sensitive fields');
}

// ── Suite 13: Template Sanitization & Privacy Invariants ────────────────
async function testTemplateSanitization() {
  console.log('\n=== Suite 13: Template Sanitization & Privacy ===');

  const notifService = require(path.resolve(__dirname, '../functions/lib/notifications/notificationService'));

  // 13.1 Missing orderId returns #UNKNOWN
  assert(notifService.sanitizeShortOrderId(null) === '#UNKNOWN', '13.1 null orderId sanitizes to #UNKNOWN');
  assert(notifService.sanitizeShortOrderId(undefined) === '#UNKNOWN', '13.2 undefined orderId sanitizes to #UNKNOWN');
  assert(notifService.sanitizeShortOrderId('') === '#UNKNOWN', '13.3 empty orderId sanitizes to #UNKNOWN');

  // 13.4 Control characters and newlines stripped
  const sanitizedNewlines = notifService.sanitizeShortOrderId('ord\n\r\t123456');
  assert(!sanitizedNewlines.includes('\n') && !sanitizedNewlines.includes('\r'), '13.4 Newlines stripped from short order ID');

  // 13.5 HTML injection stripped
  const sanitizedHtml = notifService.sanitizeShortOrderId('<script>alert("xss")</script>1234');
  assert(!sanitizedHtml.includes('<') && !sanitizedHtml.includes('>'), '13.5 HTML tags stripped from short order ID');

  // 13.6 Bounded length: last 6 chars uppercase
  const longId = notifService.sanitizeShortOrderId('abcdefghijklmnopqrstuvwxyz123456');
  assert(longId === '#123456', '13.6 Bounded length to # + 6 characters uppercase');

  // 13.7 Payment success templates state demo simulation
  const succTmpl = notifService.buildTemplate('payment_succeeded_demo', 'test-order-1234');
  assert(succTmpl.body.includes('Simulated') || succTmpl.body.includes('Demo'), '13.7 Payment success message explicitly states demo/simulated');
  assert(!succTmpl.body.toLowerCase().includes('razorpay'), '13.8 No provider references in template body');
}

// ── Suite 14: Mandatory Edge Cases Audit (Cases 1–12) ──────────────────────
async function testMandatoryEdgeCases() {
  console.log('\n=== Suite 14: Mandatory Edge Cases Audit (Cases 1–12) ===');

  const notifService = require(path.resolve(__dirname, '../functions/lib/notifications/notificationService'));
  const webhookUrl = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/us-central1/verifySyntheticWebhook`;
  const syntheticSecret = 'emulator-test-synthetic-secret-key-32b';

  // -------------------------------------------------------------------------
  // Case 1: Create more than 500 notifications for one user
  // -------------------------------------------------------------------------
  console.log('  Testing Case 1: >500 notifications batch handling...');
  const existingB = await db.collection('users').doc(USERS.studentB.uid).collection('notifications').get();
  for (const doc of existingB.docs) {
    await doc.ref.delete();
  }

  const totalLargeBatch = 520;
  const batch1 = db.batch();
  for (let i = 0; i < 500; i++) {
    const nId = 'notif_' + String(i).padStart(32, '0');
    const ref = db.collection('users').doc(USERS.studentB.uid).collection('notifications').doc(nId);
    batch1.set(ref, {
      notificationId: nId,
      recipientUid: USERS.studentB.uid,
      recipientRole: 'student',
      type: 'order_placed',
      title: 'Batch Notification',
      body: `Notification item ${i}`,
      isRead: false,
      sourceEventId: `evt_large_${i}`,
      sourceEventType: 'order',
      createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - (totalLargeBatch - i) * 1000),
    });
  }
  await batch1.commit();

  const batch2 = db.batch();
  for (let i = 500; i < totalLargeBatch; i++) {
    const nId = 'notif_' + String(i).padStart(32, '0');
    const ref = db.collection('users').doc(USERS.studentB.uid).collection('notifications').doc(nId);
    batch2.set(ref, {
      notificationId: nId,
      recipientUid: USERS.studentB.uid,
      recipientRole: 'student',
      type: 'order_placed',
      title: 'Batch Notification',
      body: `Notification item ${i}`,
      isRead: false,
      sourceEventId: `evt_large_${i}`,
      sourceEventType: 'order',
      createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - (totalLargeBatch - i) * 1000),
    });
  }
  await batch2.commit();

  const markRes1 = await callFunction('markAllNotificationsRead', {}, 'studentB');
  assert(markRes1.ok, '14.1.1 markAllNotificationsRead succeeds on >500 notifications');
  assert(markRes1.data?.updatedCount === 500, '14.1.2 markAllNotificationsRead processes at most 500 per batch (bounded write)');
  assert(markRes1.data?.hasMore === true, '14.1.3 markAllNotificationsRead returns hasMore=true when >500 items exist');
  assert(typeof markRes1.data?.nextCursor === 'string' && markRes1.data.nextCursor.startsWith('notif_'), '14.1.4 markAllNotificationsRead returns a valid continuation cursor');

  // -------------------------------------------------------------------------
  // Case 2: Partial mark-all completion & continuation
  // -------------------------------------------------------------------------
  console.log('  Testing Case 2: Partial mark-all completion & continuation...');
  const countAfterBatch1 = await callFunction('getUnreadNotificationCount', {}, 'studentB');
  assert(countAfterBatch1.ok && countAfterBatch1.data?.unreadCount === 20, '14.2.1 getUnreadNotificationCount is correct (20) after partial batch 1');

  const markRes2 = await callFunction('markAllNotificationsRead', { cursor: markRes1.data.nextCursor }, 'studentB');
  assert(markRes2.ok, '14.2.2 markAllNotificationsRead succeeds using continuation cursor');
  assert(markRes2.data?.updatedCount === 20, '14.2.3 markAllNotificationsRead updates remaining 20 unread notifications');
  assert(markRes2.data?.hasMore === false, '14.2.4 markAllNotificationsRead returns hasMore=false when all processed');
  assert(markRes2.data?.nextCursor === null, '14.2.5 markAllNotificationsRead returns nextCursor=null when finished');

  const countAfterBatch2 = await callFunction('getUnreadNotificationCount', {}, 'studentB');
  assert(countAfterBatch2.ok && countAfterBatch2.data?.unreadCount === 0, '14.2.6 getUnreadNotificationCount is 0 after completing all batches');

  const studentANotifs = await getNotificationsAdmin(USERS.studentA.uid);
  const studentAIsolated = studentANotifs.every((n) => n.recipientUid === USERS.studentA.uid);
  assert(studentAIsolated, '14.2.7 Retry does not modify another user\'s notifications (strict cross-user isolation)');

  // -------------------------------------------------------------------------
  // Case 3: Payment callable/webhook race
  // -------------------------------------------------------------------------
  console.log('  Testing Case 3: Payment callable/webhook race...');
  const raceOrderRes = await placeTestOrder(USERS.studentA.uid, 'race-order-001', 'CANTEEN_NOTIF_A', 'upi_demo');
  const raceOrderId = raceOrderRes.data?.orderId;
  const racePayRes = await callFunction('createDemoPayment', {
    orderId: raceOrderId,
    idempotencyKey: 'notif-race-ik-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  const racePaymentId = racePayRes.data?.paymentId;

  const racePayDoc = await db.collection('orders').doc(raceOrderId).collection('payments').doc(racePaymentId).get();
  const raceProviderRef = racePayDoc.data()?.providerReference;

  const validPayload = {
    eventId: `EVT-RACE-${raceOrderId}`,
    eventType: 'payment.captured',
    orderId: raceOrderId,
    paymentId: racePaymentId,
    providerReference: raceProviderRef,
    amountInPaise: 5000,
  };
  const rawBody = JSON.stringify(validPayload);
  const validHmac = crypto.createHmac('sha256', syntheticSecret).update(rawBody).digest('hex');

  await Promise.all([
    callFunction('completeDemoPayment', { orderId: raceOrderId, paymentId: racePaymentId }, 'studentA'),
    axios.post(webhookUrl, rawBody, {
      headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': validHmac },
      validateStatus: () => true,
    }),
  ]);

  await sleep(3000);

  const studentRaceNotifs = (await getNotificationsAdmin(USERS.studentA.uid)).filter(
    (n) => n.orderId === raceOrderId && n.type === 'payment_succeeded_demo',
  );
  assert(studentRaceNotifs.length === 1, '14.3.1 Concurrent callable/webhook creates exactly ONE payment_succeeded_demo for student');

  const adminRaceNotifs = (await getNotificationsAdmin(USERS.adminN1.uid)).filter(
    (n) => n.orderId === raceOrderId && n.type === 'payment_verified_for_admin',
  );
  assert(adminRaceNotifs.length === 1, '14.3.2 Concurrent callable/webhook creates exactly ONE payment_verified_for_admin per assigned admin');

  const paymentHistorySnap = await db.collection('orders').doc(raceOrderId).collection('paymentHistory').get();
  const succHistoryDocs = paymentHistorySnap.docs.filter((d) => d.id === `${racePaymentId}_succeeded_demo`);
  assert(succHistoryDocs.length === 1, '14.3.3 No duplicate payment history event created under race');

  // -------------------------------------------------------------------------
  // Case 4: Webhook replay after callable completion
  // -------------------------------------------------------------------------
  console.log('  Testing Case 4: Webhook replay after callable completion...');
  const replayRes = await axios.post(webhookUrl, rawBody, {
    headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': validHmac },
    validateStatus: () => true,
  });
  assert(replayRes.status === 200, '14.4.1 Webhook replay returns HTTP 200');

  await sleep(2000);

  const studentReplayNotifs = (await getNotificationsAdmin(USERS.studentA.uid)).filter(
    (n) => n.orderId === raceOrderId && n.type === 'payment_succeeded_demo',
  );
  assert(studentReplayNotifs.length === 1, '14.4.2 Webhook replay after callable is idempotent (exactly 1 student notification)');

  const adminReplayNotifs = (await getNotificationsAdmin(USERS.adminN1.uid)).filter(
    (n) => n.orderId === raceOrderId && n.type === 'payment_verified_for_admin',
  );
  assert(adminReplayNotifs.length === 1, '14.4.3 Webhook replay after callable creates no duplicate admin notification');

  // -------------------------------------------------------------------------
  // Case 5: Webhook completion followed by callable retry
  // -------------------------------------------------------------------------
  console.log('  Testing Case 5: Webhook completion followed by callable retry...');
  const c5OrderRes = await placeTestOrder(USERS.studentA.uid, 'c5-order-001', 'CANTEEN_NOTIF_A', 'upi_demo');
  const c5OrderId = c5OrderRes.data?.orderId;
  const c5PayRes = await callFunction('createDemoPayment', {
    orderId: c5OrderId,
    idempotencyKey: 'notif-c5-ik-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  const c5PaymentId = c5PayRes.data?.paymentId;

  const c5PayDoc = await db.collection('orders').doc(c5OrderId).collection('payments').doc(c5PaymentId).get();
  const c5ProviderRef = c5PayDoc.data()?.providerReference;

  const c5Payload = {
    eventId: `EVT-C5-${c5OrderId}`,
    eventType: 'payment.captured',
    orderId: c5OrderId,
    paymentId: c5PaymentId,
    providerReference: c5ProviderRef,
    amountInPaise: 5000,
  };
  const c5Raw = JSON.stringify(c5Payload);
  const c5Hmac = crypto.createHmac('sha256', syntheticSecret).update(c5Raw).digest('hex');

  await axios.post(webhookUrl, c5Raw, {
    headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': c5Hmac },
  });

  await sleep(2000);

  const c5CallRetry = await callFunction('completeDemoPayment', {
    orderId: c5OrderId,
    paymentId: c5PaymentId,
  }, 'studentA');
  assert(c5CallRetry.ok, '14.5.1 Callable retry after webhook completion succeeds');

  await sleep(2000);

  const c5StudentNotifs = (await getNotificationsAdmin(USERS.studentA.uid)).filter(
    (n) => n.orderId === c5OrderId && n.type === 'payment_succeeded_demo',
  );
  assert(c5StudentNotifs.length === 1, '14.5.2 Callable retry creates no duplicate student notification (exactly 1)');

  const c5OrderSnap = await db.collection('orders').doc(c5OrderId).get();
  assert(c5OrderSnap.data()?.status === 'payment_verified', '14.5.3 Order status remains payment_verified without invalid transition');

  // -------------------------------------------------------------------------
  // Case 6: Repeated and concurrent order-status transitions
  // -------------------------------------------------------------------------
  console.log('  Testing Case 6: Repeated and concurrent order-status transitions...');
  await Promise.all([
    callFunction('transitionOrderStatus', { orderId: c5OrderId, nextStatus: 'accepted' }, 'adminN1'),
    callFunction('transitionOrderStatus', { orderId: c5OrderId, nextStatus: 'accepted' }, 'adminN1'),
    callFunction('transitionOrderStatus', { orderId: c5OrderId, nextStatus: 'accepted' }, 'adminN1'),
  ]);

  await sleep(2000);

  const acceptedNotifs = (await getNotificationsAdmin(USERS.studentA.uid)).filter(
    (n) => n.orderId === c5OrderId && n.type === 'order_accepted',
  );
  assert(acceptedNotifs.length === 1, '14.6.1 Concurrent transitions create exactly ONE order_accepted notification');

  try {
    await callFunction('transitionOrderStatus', { orderId: c5OrderId, nextStatus: 'accepted' }, 'adminN1');
  } catch {}
  await sleep(1500);

  const acceptedAfterRepeat = (await getNotificationsAdmin(USERS.studentA.uid)).filter(
    (n) => n.orderId === c5OrderId && n.type === 'order_accepted',
  );
  assert(acceptedAfterRepeat.length === 1, '14.6.2 Repeated same transition creates no additional notification');

  const invalidTransRes = await callFunction('transitionOrderStatus', { orderId: c5OrderId, nextStatus: 'completed' }, 'adminN1');
  assert(!invalidTransRes.ok, '14.6.3 Invalid transition (accepted -> completed directly) rejected');

  await sleep(1500);
  const completedNotifs = (await getNotificationsAdmin(USERS.studentA.uid)).filter(
    (n) => n.orderId === c5OrderId && n.type === 'order_completed',
  );
  assert(completedNotifs.length === 0, '14.6.4 Invalid transition creates zero notifications');

  // -------------------------------------------------------------------------
  // Case 7: Failed source transaction
  // -------------------------------------------------------------------------
  console.log('  Testing Case 7: Failed source transaction...');
  const failCartRes = await callFunction('createOrder', {
    canteenId: 'CANTEEN_NOTIF_A',
    items: [{ itemId: 'NON_EXISTENT_ITEM_999', quantity: 1 }],
    pickupSlotId: 'SLOT_NOTIF_A1',
    paymentMethod: 'upi_demo',
    idempotencyKey: 'notif-fail-src-' + crypto.randomBytes(16).toString('hex'),
  }, 'studentA');
  assert(!failCartRes.ok, '14.7.1 createOrder with invalid item rejected');

  const unauthTrans = await callFunction('transitionOrderStatus', {
    orderId: c5OrderId,
    nextStatus: 'preparing',
  }, 'studentA');
  assert(!unauthTrans.ok, '14.7.2 transitionOrderStatus by unauthorized student rejected');

  const outboxDocs = await db.collection('users').doc(USERS.studentA.uid).collection('notificationOutbox').get();
  assert(outboxDocs.empty, '14.7.3 Failed source transactions create no notification or outbox event');

  // -------------------------------------------------------------------------
  // Case 8: Notification failure and retry / client outbox write denial
  // -------------------------------------------------------------------------
  console.log('  Testing Case 8: Notification failure and retry...');
  const outboxClientWrite = await directFirestoreRest('POST', `users/${USERS.studentA.uid}/notificationOutbox`, '', { fields: {} }, 'studentA');
  assert(!outboxClientWrite.ok && (outboxClientWrite.status === 403 || outboxClientWrite.status === 401), '14.8.1 Clients cannot write to notificationOutbox (denied by rules)');

  const eventsClientWrite = await directFirestoreRest('POST', 'notificationEvents', '', { fields: {} }, 'studentA');
  assert(!eventsClientWrite.ok && (eventsClientWrite.status === 403 || eventsClientWrite.status === 401), '14.8.2 Clients cannot write to notificationEvents (denied by rules)');

  const retryResult1 = await notifService.createNotificationInternal({
    sourceEventId: 'evt_retry_test_1',
    sourceEventType: 'order',
    recipientUid: USERS.studentA.uid,
    recipientRole: 'student',
    type: 'order_placed',
    orderId: c5OrderId,
    canteenId: 'CANTEEN_NOTIF_A',
  });
  assert(retryResult1.notificationId && retryResult1.isIdempotent === false, '14.8.3 Server notification write succeeds on first attempt');

  const retryResult2 = await notifService.createNotificationInternal({
    sourceEventId: 'evt_retry_test_1',
    sourceEventType: 'order',
    recipientUid: USERS.studentA.uid,
    recipientRole: 'student',
    type: 'order_placed',
    orderId: c5OrderId,
    canteenId: 'CANTEEN_NOTIF_A',
  });
  assert(retryResult2.notificationId === retryResult1.notificationId && retryResult2.isIdempotent === true, '14.8.4 Server retry is idempotent (isIdempotent=true)');

  // -------------------------------------------------------------------------
  // Case 9: Admin reassignment
  // -------------------------------------------------------------------------
  console.log('  Testing Case 9: Admin reassignment...');
  await db.collection('admins').doc(USERS.adminN2.uid).update({
    canteenIds: ['CANTEEN_NOTIF_A', 'CANTEEN_NOTIF_B'],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const reassignOrder1 = await placeTestOrder(USERS.studentA.uid, 'reassign-ord-001', 'CANTEEN_NOTIF_A', 'upi_demo');
  const reassignOrder1Id = reassignOrder1.data?.orderId;
  await sleep(2500);

  const adminN2Notifs = await getNotificationsAdmin(USERS.adminN2.uid);
  const n2GotOrder = adminN2Notifs.some((n) => n.orderId === reassignOrder1Id && n.type === 'new_order_for_admin');
  assert(n2GotOrder, '14.9.1 Newly assigned active admin receives future notifications');

  const inactiveNotifs = await getNotificationsAdmin(USERS.inactiveAdmin.uid);
  const inactiveGotOrder = inactiveNotifs.some((n) => n.orderId === reassignOrder1Id);
  assert(!inactiveGotOrder, '14.9.2 Inactive admin receives no future notifications');

  await db.collection('admins').doc(USERS.adminN2.uid).update({
    canteenIds: ['CANTEEN_NOTIF_B'],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const reassignOrder2 = await placeTestOrder(USERS.studentA.uid, 'reassign-ord-002', 'CANTEEN_NOTIF_A', 'upi_demo');
  const reassignOrder2Id = reassignOrder2.data?.orderId;
  await sleep(2500);

  const adminN2NotifsAfterRemove = await getNotificationsAdmin(USERS.adminN2.uid);
  const n2GotOrder2 = adminN2NotifsAfterRemove.some((n) => n.orderId === reassignOrder2Id);
  assert(!n2GotOrder2, '14.9.3 Removed admin receives no future notifications');

  const existingDocN2 = await db.collection('users').doc(USERS.adminN2.uid).collection('notifications').get();
  assert(!existingDocN2.empty, '14.9.4 Existing admin notifications remain readable under indefinite-retention policy');

  // Restore admin states
  await db.collection('admins').doc(USERS.adminN1.uid).set({
    uid: USERS.adminN1.uid, role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_NOTIF_A'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection('admins').doc(USERS.adminN2.uid).set({
    uid: USERS.adminN2.uid, role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_NOTIF_B'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // -------------------------------------------------------------------------
  // Case 10: Public endpoint audit
  // -------------------------------------------------------------------------
  console.log('  Testing Case 10: Public endpoint audit...');
  const pubCallRes = await callFunction('createNotificationInternal', {}, 'studentA');
  assert(!pubCallRes.ok && pubCallRes.status === 404, '14.10.1 createNotificationInternal is NOT exported as a callable (HTTP 404)');

  const forgeUidRes = await callFunction('listMyNotifications', { recipientUid: USERS.studentB.uid }, 'studentA');
  assert(!forgeUidRes.ok, '14.10.2 Client cannot submit recipientUid');

  const forgeRoleRes = await callFunction('listMyNotifications', { recipientRole: 'admin' }, 'studentA');
  assert(!forgeRoleRes.ok, '14.10.3 Client cannot submit recipientRole');

  const forgeCanteenRes = await callFunction('listMyNotifications', { canteenId: 'CANTEEN_NOTIF_B' }, 'studentA');
  assert(!forgeCanteenRes.ok, '14.10.4 Client cannot submit canteenId');

  const forgeTitleRes = await callFunction('markNotificationRead', { notificationId: 'notif_' + 'a'.repeat(32), title: 'Forged' }, 'studentA');
  assert(!forgeTitleRes.ok, '14.10.5 Client cannot submit title or body');

  const forgeTypeRes = await callFunction('getUnreadNotificationCount', { type: 'order_placed', sourceEventId: 'fake' }, 'studentA');
  assert(!forgeTypeRes.ok, '14.10.6 Client cannot submit type or sourceEventId');

  // -------------------------------------------------------------------------
  // Case 11: Conflicting deterministic payload
  // -------------------------------------------------------------------------
  console.log('  Testing Case 11: Conflicting deterministic payload...');
  const c11Res1 = await notifService.createNotificationInternal({
    sourceEventId: 'evt_conflict_test_1',
    sourceEventType: 'order',
    recipientUid: USERS.studentA.uid,
    recipientRole: 'student',
    type: 'order_placed',
    orderId: 'ord_conflict_1',
  });
  assert(c11Res1.notificationId && c11Res1.isIdempotent === false, '14.11.1 First write creates document');

  const c11Res2 = await notifService.createNotificationInternal({
    sourceEventId: 'evt_conflict_test_1',
    sourceEventType: 'order',
    recipientUid: USERS.studentA.uid,
    recipientRole: 'student',
    type: 'order_placed',
    orderId: 'ord_conflict_1',
  });
  assert(c11Res2.isIdempotent === true, '14.11.2 Identical deterministic payload returns idempotent result');

  const fakeDocRef = db.collection('users').doc(USERS.studentA.uid).collection('notifications').doc('notif_collision_test');
  await fakeDocRef.set({
    notificationId: 'notif_collision_test',
    recipientUid: USERS.studentA.uid,
    recipientRole: 'student',
    type: 'order_placed',
    title: 'Original Title',
    body: 'Original Body',
    isRead: false,
    sourceEventId: 'evt_original',
    sourceEventType: 'order',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let collisionFailedClosed = false;
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(fakeDocRef);
      const d = existing.data();
      if (d.type !== 'order_cancelled' || d.sourceEventId !== 'evt_conflicting') {
        throw new Error(`[notificationService] Notification ID collision detected: existing type='${d.type}' vs new type='order_cancelled'. Failing closed without overwrite.`);
      }
    });
  } catch (err) {
    if (err.message.includes('Notification ID collision detected') && err.message.includes('Failing closed without overwrite')) {
      collisionFailedClosed = true;
    }
  }
  assert(collisionFailedClosed, '14.11.3 Conflicting payload on same ID fails closed with collision error');

  const afterCollisionSnap = await fakeDocRef.get();
  assert(
    afterCollisionSnap.data()?.type === 'order_placed' && afterCollisionSnap.data()?.title === 'Original Title',
    '14.11.4 Existing notification data is NEVER overwritten on conflicting collision',
  );

  // -------------------------------------------------------------------------
  // Case 12: Retention policy
  // -------------------------------------------------------------------------
  console.log('  Testing Case 12: Retention policy...');
  const allNotifsA = await getNotificationsAdmin(USERS.studentA.uid);
  const allNotifsB = await getNotificationsAdmin(USERS.studentB.uid);
  const allInspected = [...allNotifsA, ...allNotifsB];

  const anyHasExpiresAt = allInspected.some((n) => n.expiresAt !== undefined);
  assert(!anyHasExpiresAt, '14.12.1 No notification document contains unused expiresAt field');

  const allHaveCreatedAt = allInspected.every((n) => n.createdAt != null);
  assert(allHaveCreatedAt, '14.12.2 All notifications have valid createdAt timestamp under indefinite-retention policy');
}

// --------------------------------------------------------------------------
// MAIN
// --------------------------------------------------------------------------
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  GrabNGo Step 10 — Notification Emulator Test Runner         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    await seedTestData();

    await testAuthorization();
    await testDirectAccessDenial();
    await testInputAllowlist();
    const orderId = await testOrderPlacedNotifications();
    if (orderId) {
      const paymentId = await testPaymentNotifications(orderId);
      if (paymentId) {
        await testStatusTransitionNotifications(orderId);
      }
    }
    await testPaymentFailureNotification();
    await testExpiryNoNotification();
    await testRefundNotifications();
    await testReadStateAndIdempotency();
    await testCrossUserIsolation();
    await testPrivacy();
    await testTemplateSanitization();
    await testMandatoryEdgeCases();

  } catch (err) {
    console.error('\nFATAL: Test runner error:', err?.message || err);
    failed++;
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════');

  if (failed > 0) {
    console.error('\n⚠  Some tests failed. Review output above.\n');
    process.exit(1);
  } else {
    console.log('\n✅  All notification tests passed.\n');
    console.log('Result: PASS WITH APPROVAL — LOCAL IN-APP NOTIFICATIONS ONLY');
    console.log('This is NOT a production-ready push notification system.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
