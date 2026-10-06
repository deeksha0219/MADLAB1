/**
 * GrabNGo Step 11: Real Firebase Emulator Service Desk & Operations Test Suite
 *
 * Verifies:
 * 1. Role Authorization (student denied, inactive denied, cross-canteen denied, service_desk allowed).
 * 2. Queue & Search (canteen isolation, bounded pagination, limit validation, sanitized fields).
 * 3. Safe Status Transitions (state machine, idempotency, concurrent safety, terminal protections).
 * 4. Operational Notes & Audit History (append-only, server-authored, control-char rejection, rules denial).
 * 5. Payment & Refund Safety (display-only, zero direct payment mutation, slot capacity release).
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

const USERS = {
  student: { uid: 'student_tester_11', role: 'student', status: 'active' },
  adminA: { uid: 'admin_canteen_a_11', role: 'canteen_admin', status: 'active', canteenIds: ['BIG_MINGOS'] },
  adminB: { uid: 'admin_canteen_b_11', role: 'canteen_admin', status: 'active', canteenIds: ['LIBRARY_CANTEEN'] },
  deskA: { uid: 'desk_canteen_a_11', role: 'service_desk', status: 'active', canteenIds: ['BIG_MINGOS'] },
  deskB: { uid: 'desk_canteen_b_11', role: 'service_desk', status: 'active', canteenIds: ['LIBRARY_CANTEEN'] },
  inactiveAdmin: { uid: 'admin_inactive_11', role: 'canteen_admin', status: 'inactive', canteenIds: ['BIG_MINGOS'] },
  inactiveDesk: { uid: 'desk_inactive_11', role: 'service_desk', status: 'inactive', canteenIds: ['BIG_MINGOS'] },
  operator: { uid: 'operator_admin_11', role: 'platform_operator', status: 'active', canteenIds: [] },
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
    const idToken = await getIdToken(userKey);
    headers['Authorization'] = `Bearer ${idToken}`;
  }

  try {
    const response = await axios.post(url, { data }, { headers });
    return { ok: true, data: response.data.result };
  } catch (err) {
    if (err.response) {
      return {
        ok: false,
        status: err.response.status,
        error: err.response.data?.error || err.response.data,
      };
    }
    return { ok: false, status: 500, error: { message: err.message } };
  }
}

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

async function setupFixtures() {
  console.log('[Setup] Seeding test admins and fixtures in Firestore...');
  const now = admin.firestore.FieldValue.serverTimestamp();

  // 1. Seed admin collection
  for (const [, user] of Object.entries(USERS)) {
    if (user.role !== 'student') {
      await db.collection('admins').doc(user.uid).set({
        uid: user.uid,
        role: user.role,
        status: user.status,
        canteenIds: user.canteenIds || [],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 2. Seed student profile
  await db.collection('users').doc(USERS.student.uid).set({
    uid: USERS.student.uid,
    name: 'Alice Student',
    role: 'student',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  // 3. Seed pickup slots for capacity testing
  await db.collection('canteens').doc('BIG_MINGOS').collection('pickupSlots').doc('slot_step11_a').set({
    slotId: 'slot_step11_a',
    canteenId: 'BIG_MINGOS',
    pickupDate: '2026-10-15',
    pickupStartTime: '12:00',
    pickupEndTime: '12:30',
    timezone: 'Asia/Kolkata',
    capacity: 20,
    reservedCount: 5,
    isOpen: true,
  });

  await db.collection('canteens').doc('LIBRARY_CANTEEN').collection('pickupSlots').doc('slot_step11_b').set({
    slotId: 'slot_step11_b',
    canteenId: 'LIBRARY_CANTEEN',
    pickupDate: '2026-10-15',
    pickupStartTime: '12:00',
    pickupEndTime: '12:30',
    timezone: 'Asia/Kolkata',
    capacity: 20,
    reservedCount: 3,
    isOpen: true,
  });

  await db.collection('systemConfig').doc('demoPayment').set({
    enabled: true,
    paymentMode: 'demo',
    allowlist: ['demo-grabngo-local'],
    updatedAt: now,
  });

  console.log('[Setup] Seed completed.');
}

async function createTestOrder(orderId, canteenId, status = 'placed', paymentMethod = 'cash', paymentStatus = 'pending') {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const orderData = {
    orderId,
    studentUid: USERS.student.uid,
    canteenId,
    status,
    paymentStatus,
    paymentMethod,
    totalInPaise: 15000,
    subtotalInPaise: 15000,
    currency: 'INR',
    pickupSlotId: canteenId === 'BIG_MINGOS' ? 'slot_step11_a' : 'slot_step11_b',
    pickupSlot: {
      slotId: canteenId === 'BIG_MINGOS' ? 'slot_step11_a' : 'slot_step11_b',
      pickupDate: '2026-10-15',
      pickupStartTime: '12:00',
      pickupEndTime: '12:30',
    },
    itemsSnapshot: [
      {
        itemId: 'item_1',
        itemName: 'Veg Sandwich',
        unitPriceInPaise: 7500,
        quantity: 2,
        lineTotalInPaise: 15000,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await db.collection('orders').doc(orderId).set(orderData);
  return orderData;
}

async function createTestPayment(orderId, paymentId, status = 'created') {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).set({
    paymentId,
    orderId,
    canteenId: 'BIG_MINGOS',
    status,
    amountInPaise: 15000,
    currency: 'INR',
    paymentMethod: 'online',
    attemptNumber: 1,
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('GrabNGo Step 11: Real Service Desk & Operations Emulator Test Suite');
  console.log('================================================================\n');

  await setupFixtures();

  // -------------------------------------------------------------------------
  // SECTION 1: ROLE AUTHORIZATION
  // -------------------------------------------------------------------------
  console.log('\n--- Section 1: Role Authorization & Canteen Isolation ---');

  // 1.1 Unauthenticated queue access denied
  const unauthQueue = await callFunction('listOperationalOrders', {});
  assert(!unauthQueue.ok && unauthQueue.status === 401, 'Unauthenticated listOperationalOrders is denied (401)');

  // 1.2 Student cannot access queue
  const studentQueue = await callFunction('listOperationalOrders', {}, 'student');
  assert(!studentQueue.ok && studentQueue.status === 403, 'Student call to listOperationalOrders is denied (403)');

  // 1.3 Student cannot search operational orders
  const studentSearch = await callFunction('searchOperationalOrders', { query: 'test' }, 'student');
  assert(!studentSearch.ok && studentSearch.status === 403, 'Student call to searchOperationalOrders is denied (403)');

  // 1.4 Student cannot transition status via operational callable
  const studentTransition = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: 'any_order', targetStatus: 'accepted' },
    'student',
  );
  assert(!studentTransition.ok && (studentTransition.status === 403 || studentTransition.status === 404), 'Student call to transitionOperationalOrderStatus is denied');

  // 1.5 Student cannot create operational notes
  const studentNote = await callFunction(
    'createOperationalNote',
    { orderId: 'any_order', body: 'Student note' },
    'student',
  );
  assert(!studentNote.ok && studentNote.status === 403, 'Student call to createOperationalNote is denied (403)');

  // 1.6 Inactive admin denied
  const inactiveAdminQueue = await callFunction('listOperationalOrders', {}, 'inactiveAdmin');
  assert(!inactiveAdminQueue.ok && inactiveAdminQueue.status === 403, 'Inactive admin queue access is denied (403)');

  // 1.7 Inactive service desk denied
  const inactiveDeskQueue = await callFunction('listOperationalOrders', {}, 'inactiveDesk');
  assert(!inactiveDeskQueue.ok && inactiveDeskQueue.status === 403, 'Inactive service desk queue access is denied (403)');

  // 1.8 Cross-canteen list denied
  const crossList = await callFunction('listOperationalOrders', { canteenId: 'LIBRARY_CANTEEN' }, 'deskA');
  assert(!crossList.ok && crossList.status === 403, 'Service desk A listing Canteen B queue is denied (403)');

  const crossAdminList = await callFunction('listOperationalOrders', { canteenId: 'LIBRARY_CANTEEN' }, 'adminA');
  assert(!crossAdminList.ok && crossAdminList.status === 403, 'Admin A listing Canteen B queue is denied (403)');

  // 1.9 Forged authoritative fields in payload rejected
  const forgedRoleCall = await callFunction('listOperationalOrders', { role: 'canteen_admin' }, 'student');
  assert(!forgedRoleCall.ok, 'Client-injected role field is rejected');

  // 1.10 Service desk user denied catalog administration
  const deskCatalogCall = await callFunction('createCategory', {
    canteenId: 'BIG_MINGOS',
    categoryId: 'CAT_UNAUTH',
    name: 'Unauthorized Category',
    sortOrder: 1,
  }, 'deskA');
  assert(!deskCatalogCall.ok && deskCatalogCall.status === 403, 'Service desk user is denied catalog administration (403)');

  // -------------------------------------------------------------------------
  // SECTION 2: QUEUE & SEARCH OPERATIONS
  // -------------------------------------------------------------------------
  console.log('\n--- Section 2: Queue & Search Operations ---');

  // Seed test orders for Canteen A and Canteen B
  const orderA1 = 'ord_11_a1_' + crypto.randomUUID().slice(0, 8);
  const orderA2 = 'ord_11_a2_' + crypto.randomUUID().slice(0, 8);
  const orderB1 = 'ord_11_b1_' + crypto.randomUUID().slice(0, 8);

  await createTestOrder(orderA1, 'BIG_MINGOS', 'payment_verified', 'cash', 'payment_verified');
  await createTestOrder(orderA2, 'BIG_MINGOS', 'payment_verified', 'cash', 'payment_verified');
  await createTestOrder(orderB1, 'LIBRARY_CANTEEN', 'payment_verified', 'cash', 'payment_verified');

  // 2.1 Service desk A lists assigned canteen queue
  const queueResA = await callFunction('listOperationalOrders', {}, 'deskA');
  assert(queueResA.ok && queueResA.data.success, 'Service desk A successfully lists assigned canteen queue');
  const returnedIdsA = (queueResA.data.orders || []).map((o) => o.orderId);
  assert(returnedIdsA.includes(orderA1) && returnedIdsA.includes(orderA2), 'Queue contains Canteen A orders');
  assert(!returnedIdsA.includes(orderB1), 'Queue excludes other canteen (Canteen B) orders');

  // 2.2 Limit and pagination bounds
  const limitValid = await callFunction('listOperationalOrders', { limit: 1 }, 'deskA');
  assert(limitValid.ok && limitValid.data.orders.length === 1, 'Pagination limit of 1 returns exactly 1 record');

  const negLimit = await callFunction('listOperationalOrders', { limit: -5 }, 'deskA');
  assert(!negLimit.ok && negLimit.status === 400, 'Negative limit is rejected (400)');

  const zeroLimit = await callFunction('listOperationalOrders', { limit: 0 }, 'deskA');
  assert(!zeroLimit.ok && zeroLimit.status === 400, 'Zero limit is rejected (400)');

  const fracLimit = await callFunction('listOperationalOrders', { limit: 2.5 }, 'deskA');
  assert(!fracLimit.ok && fracLimit.status === 400, 'Fractional limit is rejected (400)');

  const overLimit = await callFunction('listOperationalOrders', { limit: 51 }, 'deskA');
  assert(!overLimit.ok && overLimit.status === 400, 'Limit exceeding maximum (51 > 50) is rejected (400)');

  const strLimit = await callFunction('listOperationalOrders', { limit: '20' }, 'deskA');
  assert(!strLimit.ok && strLimit.status === 400, 'String limit is rejected (400)');

  // 2.3 Search operations
  // Exact search by order ID
  const searchExact = await callFunction('searchOperationalOrders', { query: orderA1 }, 'deskA');
  assert(searchExact.ok && searchExact.data.found && searchExact.data.order.orderId === orderA1, 'Exact order search succeeds');
  assert(searchExact.data.order.maskedCustomer === undefined, 'Customer identity (maskedCustomer) is completely omitted from search DTO');

  // Whitespace trimming in search
  const searchWhitespace = await callFunction('searchOperationalOrders', { query: `  ${orderA1}  ` }, 'deskA');
  assert(searchWhitespace.ok && searchWhitespace.data.found && searchWhitespace.data.order.orderId === orderA1, 'Search query is safely trimmed server-side');

  // Overlong search query rejected
  const overlongQuery = 'x'.repeat(65);
  const searchOverlong = await callFunction('searchOperationalOrders', { query: overlongQuery }, 'deskA');
  assert(!searchOverlong.ok && searchOverlong.status === 400, 'Overlong search query (> 64 chars) is rejected (400)');

  // Control character injection in search rejected
  const controlSearch = await callFunction('searchOperationalOrders', { query: `${orderA1}\x00injection` }, 'deskA');
  assert(!controlSearch.ok && controlSearch.status === 400, 'Control character injection in search query is rejected (400)');

  // Nonexistent order returns generic not-found
  const searchNonexistent = await callFunction('searchOperationalOrders', { query: 'non_existent_ord' }, 'deskA');
  assert(searchNonexistent.ok && searchNonexistent.data.found === false, 'Nonexistent order search returns generic found: false');

  // Cross-canteen order search returns generic not-found (does not leak existence)
  const searchCross = await callFunction('searchOperationalOrders', { query: orderB1 }, 'deskA');
  assert(searchCross.ok && searchCross.data.found === false && searchCross.data.order === null, 'Cross-canteen search returns generic found: false without leaking existence');

  // Sensitive payment fields absent from responses
  const orderSample = searchExact.data.order;
  assert(!('paymentProvider' in orderSample) && !('signature' in orderSample) && !('webhookPayload' in orderSample), 'Sensitive payment secrets and provider fields are absent from response');

  // -------------------------------------------------------------------------
  // SECTION 3: STATUS TRANSITIONS
  // -------------------------------------------------------------------------
  console.log('\n--- Section 3: Safe Order Status Transitions ---');

  // 3.0 Negative test: Service desk cannot transition unapproved placed cash order
  const orderUnapproved = 'ord_unapp_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderUnapproved, 'BIG_MINGOS', 'placed', 'cash', 'pending');
  const transUnapproved = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderUnapproved, targetStatus: 'accepted' },
    'deskA',
  );
  assert(!transUnapproved.ok && transUnapproved.status === 403, 'Service desk cannot transition unapproved placed cash order (403)');

  // 3.1 Valid transition sequence: payment_verified -> accepted -> preparing -> ready_for_pickup -> completed
  const orderTrans = 'ord_trans_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderTrans, 'BIG_MINGOS', 'payment_verified', 'cash', 'payment_verified');

  const transAccepted = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderTrans, targetStatus: 'accepted' },
    'deskA',
  );
  assert(transAccepted.ok && transAccepted.data.status === 'accepted', 'Service desk transitions payment_verified -> accepted');

  const transPreparing = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderTrans, targetStatus: 'preparing' },
    'deskA',
  );
  assert(transPreparing.ok && transPreparing.data.status === 'preparing', 'Service desk transitions accepted -> preparing');

  const transReady = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderTrans, targetStatus: 'ready_for_pickup' },
    'deskA',
  );
  assert(transReady.ok && transReady.data.status === 'ready_for_pickup', 'Service desk transitions preparing -> ready_for_pickup');

  const transCompleted = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderTrans, targetStatus: 'completed' },
    'deskA',
  );
  assert(transCompleted.ok && transCompleted.data.status === 'completed', 'Service desk transitions ready_for_pickup -> completed');

  // 3.2 Terminal state protection: completed order cannot be changed
  const transAfterCompleted = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderTrans, targetStatus: 'cancelled' },
    'deskA',
  );
  assert(!transAfterCompleted.ok, 'Completed order cannot transition to cancelled (terminal protection)');

  // 3.3 Invalid state skipping: payment_verified -> ready_for_pickup directly
  const orderSkip = 'ord_skip_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderSkip, 'BIG_MINGOS', 'payment_verified', 'cash', 'payment_verified');

  const transSkip = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderSkip, targetStatus: 'ready_for_pickup' },
    'deskA',
  );
  assert(!transSkip.ok, 'Skipping status directly (payment_verified -> ready_for_pickup) is rejected');

  // 3.4 Cross-canteen transition denied
  const transCross = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderB1, targetStatus: 'accepted' },
    'deskA',
  );
  assert(!transCross.ok && transCross.status === 403, 'Service desk A cannot transition Canteen B order (403)');

  // 3.5 Replay idempotency
  const transReplay = await callFunction(
    'transitionOperationalOrderStatus',
    { orderId: orderTrans, targetStatus: 'completed' },
    'deskA',
  );
  assert(transReplay.ok && transReplay.data.isIdempotent === true, 'Repeated same transition returns isIdempotent: true');

  // 3.6 Concurrent transition race
  const orderRace = 'ord_race_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderRace, 'BIG_MINGOS', 'payment_verified', 'cash', 'payment_verified');

  const [race1, race2] = await Promise.all([
    callFunction('transitionOperationalOrderStatus', { orderId: orderRace, targetStatus: 'accepted' }, 'deskA'),
    callFunction('transitionOperationalOrderStatus', { orderId: orderRace, targetStatus: 'accepted' }, 'deskA'),
  ]);
  const raceSuccesses = [race1, race2].filter((r) => r.ok && r.data.status === 'accepted');
  assert(raceSuccesses.length === 2, 'Both concurrent calls completed safely without crash');
  const idempotentCount = [race1, race2].filter((r) => r.ok && r.data.isIdempotent === true).length;
  assert(idempotentCount >= 1, 'At least one concurrent transition was recognized as idempotent replay');

  // Verify exactly one statusHistory document created for payment_verified_to_accepted
  const historySnap = await db.collection('orders').doc(orderRace).collection('statusHistory').get();
  assert(historySnap.size === 1, 'Exactly one statusHistory document created despite race');

  // -------------------------------------------------------------------------
  // SECTION 4: OPERATIONAL NOTES & AUDIT HISTORY
  // -------------------------------------------------------------------------
  console.log('\n--- Section 4: Operational Notes & Audit History ---');

  const orderNotesTest = 'ord_note_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderNotesTest, 'BIG_MINGOS', 'accepted', 'cash', 'payment_verified');

  // 4.1 Valid service-desk note creation
  const noteResDesk = await callFunction(
    'createOperationalNote',
    { orderId: orderNotesTest, body: 'Customer requested extra sauce at counter.' },
    'deskA',
  );
  assert(noteResDesk.ok && noteResDesk.data.success && noteResDesk.data.noteId, 'Service desk adds operational note successfully');

  // 4.2 Valid admin note creation
  const noteResAdmin = await callFunction(
    'createOperationalNote',
    { orderId: orderNotesTest, body: 'Admin approved packaging substitute.' },
    'adminA',
  );
  assert(noteResAdmin.ok && noteResAdmin.data.success && noteResAdmin.data.noteId, 'Canteen admin adds operational note successfully');

  // 4.3 Student note creation denied
  const noteStudent = await callFunction(
    'createOperationalNote',
    { orderId: orderNotesTest, body: 'Student note attempt' },
    'student',
  );
  assert(!noteStudent.ok && noteStudent.status === 403, 'Student cannot add operational note (403)');

  // 4.4 Cross-canteen note creation denied
  const noteCross = await callFunction(
    'createOperationalNote',
    { orderId: orderB1, body: 'Cross-canteen note attempt' },
    'deskA',
  );
  assert(!noteCross.ok && noteCross.status === 403, 'Cross-canteen operational note creation is denied (403)');

  // 4.5 Client-supplied author UID/role rejected
  const noteForged = await callFunction(
    'createOperationalNote',
    {
      orderId: orderNotesTest,
      body: 'Forged note',
      authorUid: 'someone_else',
      authorRole: 'platform_operator',
    },
    'deskA',
  );
  assert(!noteForged.ok, 'Client-supplied authorUid and authorRole rejected as unknown fields');

  // 4.6 Overlong note rejected (> 1000 chars)
  const overlongBody = 'a'.repeat(1001);
  const noteOverlong = await callFunction(
    'createOperationalNote',
    { orderId: orderNotesTest, body: overlongBody },
    'deskA',
  );
  assert(!noteOverlong.ok && noteOverlong.status === 400, 'Overlong note (> 1000 characters) is rejected (400)');

  // 4.7 Control character rejection
  const controlNote = await callFunction(
    'createOperationalNote',
    { orderId: orderNotesTest, body: 'Invalid\x00note' },
    'deskA',
  );
  assert(!controlNote.ok && controlNote.status === 400, 'Control character injection in note is rejected (400)');

  // 4.8 Inspect notes and audit history via getOperationalOrderDetails
  const detailsRes = await callFunction('getOperationalOrderDetails', { orderId: orderNotesTest }, 'deskA');
  assert(detailsRes.ok && detailsRes.data.success, 'getOperationalOrderDetails retrieves order details');
  const details = detailsRes.data.order;
  assert(Array.isArray(details.operationalNotes) && details.operationalNotes.length === 2, 'Operational notes are included in order details');
  assert(details.operationalNotes[0].authorRole === 'canteen_admin' || details.operationalNotes[0].authorRole === 'service_desk', 'Operational note preserves server-derived authorRole');
  assert(Array.isArray(details.auditHistory) && details.auditHistory.length >= 2, 'Immutable audit history contains audit events');

  // 4.9 Direct client write denial in Firestore rules for operationalNotes and auditEvents
  let rulesDeniedNotes = false;
  let rulesDeniedAudit = false;

  try {
    const studentToken = await getIdToken('student');
    await axios.post(
      `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${orderNotesTest}/operationalNotes`,
      { fields: { body: { stringValue: 'injected note' } } },
      { headers: { Authorization: `Bearer ${studentToken}` } }
    );
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 400 || err.response.status === 404)) {
      rulesDeniedNotes = true;
    }
  }

  try {
    const studentToken = await getIdToken('student');
    await axios.post(
      `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${orderNotesTest}/auditEvents`,
      { fields: { eventType: { stringValue: 'injected_audit' } } },
      { headers: { Authorization: `Bearer ${studentToken}` } }
    );
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 400 || err.response.status === 404)) {
      rulesDeniedAudit = true;
    }
  }

  assert(rulesDeniedNotes, 'Direct client write to operationalNotes subcollection is DENIED');
  assert(rulesDeniedAudit, 'Direct client write to auditEvents subcollection is DENIED');

  // -------------------------------------------------------------------------
  // SECTION 5: PAYMENT / REFUND / ORDER SAFETY
  // -------------------------------------------------------------------------
  console.log('\n--- Section 5: Payment & Refund Safety ---');

  // 5.1 Service desk cannot set paymentStatus through status transition
  const paymentTamper = await callFunction(
    'transitionOperationalOrderStatus',
    {
      orderId: orderA1,
      targetStatus: 'accepted',
      paymentStatus: 'succeeded_demo',
    },
    'deskA',
  );
  assert(!paymentTamper.ok, 'Client attempting to mutate paymentStatus via transition is rejected');

  // 5.2 Service desk cannot set refundStatus through status transition
  const refundTamper = await callFunction(
    'transitionOperationalOrderStatus',
    {
      orderId: orderA1,
      targetStatus: 'cancelled',
      refundStatus: 'succeeded_demo',
    },
    'deskA',
  );
  assert(!refundTamper.ok, 'Client attempting to mutate refundStatus via transition is rejected');

  // 5.3 Slot capacity released on cancellation/rejection
  const orderCancel = 'ord_cancel_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderCancel, 'BIG_MINGOS', 'payment_verified', 'cash', 'payment_verified');

  const slotBefore = await db.collection('canteens').doc('BIG_MINGOS').collection('pickupSlots').doc('slot_step11_a').get();
  const countBefore = slotBefore.data().reservedCount;

  await callFunction('transitionOperationalOrderStatus', {
    orderId: orderCancel,
    targetStatus: 'cancelled',
    reason: 'Customer cancelled at counter',
  }, 'deskA');

  const slotAfter = await db.collection('canteens').doc('BIG_MINGOS').collection('pickupSlots').doc('slot_step11_a').get();
  const countAfter = slotAfter.data().reservedCount;
  assert(countAfter === countBefore - 1, `Pickup slot capacity released on cancellation (${countBefore} -> ${countAfter})`);

  // -------------------------------------------------------------------------
  // SECTION 6: STEP 12 STRICT SERVICE-DESK ISOLATION & ORDER-ONLY REMEDIATION
  // -------------------------------------------------------------------------
  console.log('\n--- Section 6: Step 12 Service Desk Isolation & Financial Boundary ---');

  // 6.1 R-01: Service desk role is denied from all financial functions
  const orderFinTest = 'ord_fin_' + crypto.randomUUID().slice(0, 8);
  const payFinTest = 'pay_fin_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderFinTest, 'BIG_MINGOS', 'cancelled', 'online', 'pending');
  await createTestPayment(orderFinTest, payFinTest, 'created');

  const failAttempt = await callFunction('failDemoPayment', {
    orderId: orderFinTest,
    paymentId: payFinTest,
    failureCode: 'PAYMENT_FAILED',
    failureMessage: 'Test failure message',
  }, 'deskA');
  assert(!failAttempt.ok && failAttempt.status === 403, 'R-01: Service desk calling failDemoPayment is denied (403)');

  const expireAttempt = await callFunction('expirePaymentAttempt', {
    orderId: orderFinTest,
    paymentId: payFinTest,
  }, 'deskA');
  assert(!expireAttempt.ok && expireAttempt.status === 403, 'R-01: Service desk calling expirePaymentAttempt is denied (403)');

  const getPayStatusAttempt = await callFunction('getPaymentStatus', {
    orderId: orderFinTest,
    paymentId: payFinTest,
  }, 'deskA');
  assert(!getPayStatusAttempt.ok && getPayStatusAttempt.status === 403, 'R-01: Service desk calling getPaymentStatus is denied (403)');

  const reqRefundAttempt = await callFunction('requestDemoRefund', {
    orderId: orderFinTest,
    paymentId: payFinTest,
    reason: 'Customer cancelled',
  }, 'deskA');
  assert(!reqRefundAttempt.ok && reqRefundAttempt.status === 403, 'R-01: Service desk calling requestDemoRefund is denied (403)');

  const compRefundAttempt = await callFunction('completeDemoRefund', {
    orderId: orderFinTest,
    paymentId: payFinTest,
  }, 'deskA');
  assert(!compRefundAttempt.ok && compRefundAttempt.status === 403, 'R-01: Service desk calling completeDemoRefund is denied (403)');

  const verifyDemoAttempt = await callFunction('verifyDemoPayment', {
    orderId: orderFinTest,
  }, 'deskA');
  assert(!verifyDemoAttempt.ok && verifyDemoAttempt.status === 403, 'R-01: Service desk calling verifyDemoPayment is denied (403)');

  // 6.2 R-01: Cross-canteen admin denied from financial functions
  const crossFinAttempt = await callFunction('expirePaymentAttempt', {
    orderId: orderFinTest,
    paymentId: payFinTest,
  }, 'adminB');
  assert(!crossFinAttempt.ok && crossFinAttempt.status === 403, 'R-01: Cross-canteen admin calling financial function is denied (403)');

  // 6.3 R-02: assignAdminRole requires platform-operator authority
  const deskAssignRole = await callFunction('assignAdminRole', {
    targetUid: 'random_user_1',
    canteenIds: ['BIG_MINGOS'],
  }, 'deskA');
  assert(!deskAssignRole.ok && deskAssignRole.status === 403, 'R-02: Service desk calling assignAdminRole is denied (403)');

  const adminAssignRole = await callFunction('assignAdminRole', {
    targetUid: 'random_user_2',
    canteenIds: ['BIG_MINGOS'],
  }, 'adminA');
  assert(!adminAssignRole.ok && adminAssignRole.status === 403, 'R-02: Canteen admin calling assignAdminRole is denied (403)');

  const operatorAssignRole = await callFunction('assignAdminRole', {
    targetUid: 'test_assigned_staff_12',
    canteenIds: ['BIG_MINGOS'],
  }, 'operator');
  assert(operatorAssignRole.ok, 'R-02: Platform operator calling assignAdminRole is allowed');

  const auditEventsSnap = await db.collection('adminAuditEvents').where('targetUid', '==', 'test_assigned_staff_12').get();
  assert(!auditEventsSnap.empty, 'R-02: assignAdminRole creates an immutable adminAuditEvents record');

  // 6.4 R-04: Operational Order DTO contains strictly operational fields (zero financial fields or item prices)
  const orderEligibleA = 'ord_elig_a_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderEligibleA, 'BIG_MINGOS', 'payment_verified', 'online', 'succeeded_demo');

  const listRes = await callFunction('listOperationalOrders', { canteenId: 'BIG_MINGOS', limit: 10 }, 'deskA');
  assert(listRes.ok, 'Service desk can invoke listOperationalOrders');
  const foundOrder = listRes.data?.orders?.find(o => o.orderId === orderEligibleA);
  assert(Boolean(foundOrder), 'Eligible order is returned in listOperationalOrders');

  // Helper to scan for forbidden keys recursively in any object
  const FORBIDDEN_KEYS = [
    'paymentStatus', 'paymentMethod', 'amountInPaise', 'totalInPaise',
    'subtotalInPaise', 'refundStatus', 'refundAmount', 'refundedAmountInPaise',
    'activePaymentId', 'paymentId', 'providerReference', 'refundReference',
    'webhookEventId', 'idempotencyKey', 'studentUid', 'maskedCustomer',
    'hmac', 'secret', 'token'
  ];

  function scanForbiddenKeys(obj, currentPath = '') {
    const violations = [];
    if (!obj || typeof obj !== 'object') return violations;
    for (const [k, v] of Object.entries(obj)) {
      const fullPath = currentPath ? `${currentPath}.${k}` : k;
      if (FORBIDDEN_KEYS.includes(k)) {
        violations.push(fullPath);
      }
      if (typeof v === 'object' && v !== null) {
        violations.push(...scanForbiddenKeys(v, fullPath));
      }
    }
    return violations;
  }

  if (foundOrder) {
    const listViolations = scanForbiddenKeys(foundOrder);
    assert(listViolations.length === 0, `Step 1.1: listOperationalOrders DTO contains no forbidden keys (violations: ${listViolations.join(', ')})`);

    const hasItemPrices = foundOrder.items && foundOrder.items.some(item => 'unitPriceInPaise' in item || 'lineTotalInPaise' in item || 'price' in item);
    assert(!hasItemPrices, 'Step 1.1: listOperationalOrders DTO items contain only itemId, itemName, quantity (no prices)');
  }

  const step12DetailsRes = await callFunction('getOperationalOrderDetails', { orderId: orderEligibleA }, 'deskA');
  assert(step12DetailsRes.ok, 'Service desk can invoke getOperationalOrderDetails');
  if (step12DetailsRes.data?.order) {
    const detailsViolations = scanForbiddenKeys(step12DetailsRes.data.order);
    assert(detailsViolations.length === 0, `Step 1.1: getOperationalOrderDetails DTO contains no forbidden keys (violations: ${detailsViolations.join(', ')})`);
    const hasItemPrices = step12DetailsRes.data.order.items && step12DetailsRes.data.order.items.some(item => 'unitPriceInPaise' in item || 'lineTotalInPaise' in item || 'price' in item);
    assert(!hasItemPrices, 'Step 1.1: getOperationalOrderDetails items contain no prices');
  }

  // Scan transitionOperationalOrderStatus response for forbidden keys
  const step12TransRes = await callFunction('transitionOperationalOrderStatus', {
    orderId: orderEligibleA,
    targetStatus: 'accepted',
  }, 'deskA');
  assert(step12TransRes.ok, 'Service desk can invoke transitionOperationalOrderStatus');
  const transViolations = scanForbiddenKeys(step12TransRes.data);
  assert(transViolations.length === 0, `Step 1.1: transitionOperationalOrderStatus DTO contains no forbidden keys (violations: ${transViolations.join(', ')})`);

  // Scan searchOperationalOrders response for forbidden keys
  const step12SearchRes = await callFunction('searchOperationalOrders', { query: orderEligibleA }, 'deskA');
  assert(step12SearchRes.ok && step12SearchRes.data.found, 'Service desk can search operational orders');
  const searchViolations = scanForbiddenKeys(step12SearchRes.data);
  assert(searchViolations.length === 0, `Step 1.1: searchOperationalOrders DTO contains no forbidden keys (violations: ${searchViolations.join(', ')})`);

  // Scan getIncomingOrderCount response for forbidden keys
  const step12CountRes = await callFunction('getIncomingOrderCount', { canteenId: 'BIG_MINGOS' }, 'deskA');
  assert(step12CountRes.ok, 'Service desk can invoke getIncomingOrderCount');
  const countViolations = scanForbiddenKeys(step12CountRes.data);
  assert(countViolations.length === 0, `Step 1.1: getIncomingOrderCount DTO contains no forbidden keys (violations: ${countViolations.join(', ')})`);

  // 6.5 R-04: Raw direct client reads to /orders/{orderId} are DENIED for staff
  let deskRawOrderDenied = false;
  try {
    const deskToken = await getIdToken('deskA');
    await axios.get(
      `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${orderEligibleA}`,
      { headers: { Authorization: `Bearer ${deskToken}` } }
    );
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 404)) {
      deskRawOrderDenied = true;
    }
  }
  assert(deskRawOrderDenied, 'R-04: Direct client read of /orders/{orderId} by service desk is DENIED by Firestore rules');

  // Direct status history read denied for staff
  let deskStatusHistoryDenied = false;
  try {
    const deskToken = await getIdToken('deskA');
    await axios.get(
      `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${orderEligibleA}/statusHistory`,
      { headers: { Authorization: `Bearer ${deskToken}` } }
    );
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 404)) {
      deskStatusHistoryDenied = true;
    }
  }
  assert(deskStatusHistoryDenied, 'R-04: Direct client read of /orders/{orderId}/statusHistory by service desk is DENIED by Firestore rules');

  // 6.6 Phase 1 Negative Tests & Cash Order Approval Controls
  console.log('\n--- Step 1.2: Cash-Order Approval & Negative Security Verification ---');
  const orderCashNeg = 'ord_cash_neg_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderCashNeg, 'BIG_MINGOS', 'placed', 'cash', 'pending');

  // Negative 1: Service desk cannot approve cash payment
  const deskApproveCall = await callFunction('approveCashPayment', { orderId: orderCashNeg }, 'deskA');
  assert(!deskApproveCall.ok && deskApproveCall.status === 403, 'A service-desk client cannot approve a cash payment (403)');

  // Negative 2: Student cannot approve cash payment
  const studentApproveCall = await callFunction('approveCashPayment', { orderId: orderCashNeg }, 'student');
  assert(!studentApproveCall.ok && studentApproveCall.status === 403, 'A student client cannot approve a cash payment (403)');

  // Negative 3: Cross-canteen admin cannot approve other canteen cash order
  const crossAdminApprove = await callFunction('approveCashPayment', { orderId: orderCashNeg }, 'adminB');
  assert(!crossAdminApprove.ok && crossAdminApprove.status === 403, 'An unauthorized admin cannot approve another canteen’s cash order (403)');

  // Negative 4: Client cannot submit paymentStatus to bypass approval via status transition
  const bypassCall = await callFunction('transitionOperationalOrderStatus', {
    orderId: orderCashNeg,
    targetStatus: 'payment_verified',
    paymentStatus: 'payment_verified',
  }, 'deskA');
  assert(!bypassCall.ok && (bypassCall.status === 400 || bypassCall.status === 403), 'Client cannot submit paymentStatus to bypass approval');

  // Negative 5: Client cannot submit paymentMethod or approval fields to transitionOperationalOrderStatus
  const injectMethodCall = await callFunction('transitionOperationalOrderStatus', {
    orderId: orderCashNeg,
    targetStatus: 'accepted',
    paymentMethod: 'cash',
    cashApprovedBy: 'fraudulent_user',
  }, 'deskA');
  assert(!injectMethodCall.ok && injectMethodCall.status === 400, 'Client cannot submit paymentMethod or approval fields to transition callable');

  // Negative 6: Direct Firestore write cannot change order paymentStatus or approval fields
  let directRulesOrderDenied = false;
  try {
    const studentToken = await getIdToken('student');
    await axios.patch(
      `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${orderCashNeg}?updateMask.fieldPaths=paymentStatus`,
      { fields: { paymentStatus: { stringValue: 'payment_verified' } } },
      { headers: { Authorization: `Bearer ${studentToken}` } }
    );
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 404)) {
      directRulesOrderDenied = true;
    }
  }
  assert(directRulesOrderDenied, 'A direct Firestore write cannot change order/payment approval fields');

  // Positive: Authorized canteen admin approves cash payment
  const adminApproveSuccess = await callFunction('approveCashPayment', { orderId: orderCashNeg }, 'adminA');
  assert(adminApproveSuccess.ok && adminApproveSuccess.data.status === 'payment_verified', 'Authorized canteen admin approves cash payment successfully');

  // Verify order is now visible in service desk queue
  const queueAfterApproval = await callFunction('listOperationalOrders', { canteenId: 'BIG_MINGOS' }, 'deskA');
  const isNowVisible = queueAfterApproval.ok && queueAfterApproval.data.orders.some(o => o.orderId === orderCashNeg);
  assert(isNowVisible, 'Approved cash order becomes visible in service-desk operational queue');

  // 6.7 Step 1.2: Complete 15-Permutation Truth-Table Verification
  console.log('\n--- Step 1.2: Order Eligibility Truth-Table Verification ---');
  const TT_CANTEEN = 'CANTEEN_TRUTH_TABLE';
  await db.collection('canteens').doc(TT_CANTEEN).set({
    canteenId: TT_CANTEEN,
    name: 'Truth Table Canteen',
    isActive: true,
  });
  USERS.deskA.canteenIds = ['BIG_MINGOS', TT_CANTEEN];
  await db.collection('admins').doc(USERS.deskA.uid).set({
    canteenIds: ['BIG_MINGOS', TT_CANTEEN],
  }, { merge: true });
  delete tokenCache['deskA'];

  const truthTableCases = [
    { method: 'cash', payStatus: 'pending', ordStatus: 'placed', expected: false, desc: 'Cash order pending approval' },
    { method: 'cash', payStatus: 'pending', ordStatus: 'payment_verified', expected: false, desc: 'Cash order pending with payment_verified status (invalid)' },
    { method: 'cash', payStatus: 'failed', ordStatus: 'placed', expected: false, desc: 'Cash order with failed payment' },
    { method: 'cash', payStatus: 'expired', ordStatus: 'placed', expected: false, desc: 'Cash order with expired payment' },
    { method: 'cash', payStatus: 'payment_verified', ordStatus: 'payment_verified', expected: true, desc: 'Cash order payment_verified' },
    { method: 'cash', payStatus: 'payment_verified', ordStatus: 'accepted', expected: true, desc: 'Cash order accepted' },
    { method: 'cash', payStatus: 'payment_verified', ordStatus: 'preparing', expected: true, desc: 'Cash order preparing' },
    { method: 'cash', payStatus: 'payment_verified', ordStatus: 'ready_for_pickup', expected: true, desc: 'Cash order ready for pickup' },
    { method: 'cash', payStatus: 'payment_verified', ordStatus: 'completed', expected: true, desc: 'Cash order completed' },
    { method: 'cash', payStatus: 'payment_verified', ordStatus: 'cancelled', expected: false, desc: 'Cash order cancelled after verification (fulfillment policy)' },
    { method: 'cash', payStatus: 'payment_verified', ordStatus: 'rejected', expected: false, desc: 'Cash order rejected after verification (fulfillment policy)' },
    { method: 'upi_demo', payStatus: 'pending', ordStatus: 'placed', expected: false, desc: 'UPI demo order awaiting payment approval' },
    { method: 'upi_demo', payStatus: 'failed', ordStatus: 'placed', expected: false, desc: 'UPI demo order with failed payment' },
    { method: 'upi_demo', payStatus: 'expired', ordStatus: 'placed', expected: false, desc: 'UPI demo order with expired payment' },
    { method: 'upi_demo', payStatus: 'succeeded_demo', ordStatus: 'payment_verified', expected: true, desc: 'UPI demo order with verified payment' },
  ];

  for (const tc of truthTableCases) {
    const tcOrderId = 'ord_tt_' + crypto.randomUUID().slice(0, 8);
    await createTestOrder(tcOrderId, TT_CANTEEN, tc.ordStatus, tc.method, tc.payStatus);
    const listCheck = await callFunction('listOperationalOrders', { canteenId: TT_CANTEEN, limit: 50 }, 'deskA');
    const isVisibleInList = listCheck.ok && Boolean(listCheck.data?.orders?.find(o => o.orderId === tcOrderId));
    assert(isVisibleInList === tc.expected, `Truth-table: ${tc.desc} -> visible=${tc.expected} (got: ${isVisibleInList})`);

    const detailsCheck = await callFunction('getOperationalOrderDetails', { orderId: tcOrderId }, 'deskA');
    const isVisibleInDetails = detailsCheck.ok && Boolean(detailsCheck.data?.order);
    assert(isVisibleInDetails === tc.expected, `Truth-table (details): ${tc.desc} -> visible=${tc.expected} (got: ${isVisibleInDetails})`);
  }

  // 6.7 Step 1.3: Role Authorization Matrix across Staff & Non-Staff
  console.log('\n--- Step 1.3: Role Authorization Matrix Verification ---');
  const inactiveDeskList = await callFunction('listOperationalOrders', { canteenId: 'BIG_MINGOS' }, 'inactiveDesk');
  assert(!inactiveDeskList.ok && inactiveDeskList.status === 403, 'Inactive service desk cannot list operational orders (403)');

  const crossDeskList = await callFunction('listOperationalOrders', { canteenId: 'BIG_MINGOS' }, 'deskB');
  assert(!crossDeskList.ok && crossDeskList.status === 403, 'Cross-canteen service desk cannot list other canteen operational orders (403)');

  const studentDeskList = await callFunction('listOperationalOrders', { canteenId: 'BIG_MINGOS' }, 'student');
  assert(!studentDeskList.ok && studentDeskList.status === 403, 'Student cannot list operational orders (403)');

  const unauthDeskList = await callFunction('listOperationalOrders', { canteenId: 'BIG_MINGOS' }, null);
  assert(!unauthDeskList.ok && unauthDeskList.status === 401, 'Unauthenticated caller cannot list operational orders (401)');

  // 6.8 Eligibility Predicate & Live Incoming Counter
  const incomingCounterRes = await callFunction('getIncomingOrderCount', { canteenId: 'BIG_MINGOS' }, 'deskA');
  assert(incomingCounterRes.ok, 'getIncomingOrderCount callable succeeds');
  const initialIncoming = incomingCounterRes.data.incomingCount;

  // Add an eligible verified online order
  const orderLiveIncoming = 'ord_live_in_' + crypto.randomUUID().slice(0, 8);
  await createTestOrder(orderLiveIncoming, 'BIG_MINGOS', 'payment_verified', 'online', 'succeeded_demo');

  const counterAfterAdd = await callFunction('getIncomingOrderCount', { canteenId: 'BIG_MINGOS' }, 'deskA');
  assert(counterAfterAdd.data.incomingCount === initialIncoming + 1, 'Incoming order count increases when eligible order arrives');

  // Transition eligible order to accepted
  await callFunction('transitionOperationalOrderStatus', {
    orderId: orderLiveIncoming,
    targetStatus: 'accepted',
  }, 'deskA');

  const counterAfterAccept = await callFunction('getIncomingOrderCount', { canteenId: 'BIG_MINGOS' }, 'deskA');
  assert(counterAfterAccept.data.incomingCount === initialIncoming, 'Incoming order count decreases when order transitions to accepted');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n======================================================');
  console.log(`[Step 12 Service Desk Emulator Tests Summary] Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
