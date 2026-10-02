/**
 * Real Firebase Emulator Order Status & Admin Operations Test Runner (Step 8)
 *
 * Connects to live local Auth (9099), Firestore (8085), and Functions (5001) Emulators.
 *
 * Comprehensive Test Coverage:
 * 1. Valid transitions (Cash path: placed -> accepted -> preparing -> ready_for_pickup -> completed).
 * 2. Valid transitions (Online demo path: placed -> verifyDemoPayment -> accepted -> preparing -> ready_for_pickup -> completed).
 * 3. Invalid transition rejection (placed -> preparing, placed -> completed, backward transitions).
 * 4. Terminal state protection (completed, cancelled, rejected cannot transition).
 * 5. Student cancellation authorization (own order only, status == placed, paymentStatus == pending, before slot).
 * 6. Student cross-user cancellation rejection (student B cannot cancel student A's order).
 * 7. Admin cancellation authorization (canteen admin can reject/cancel with reason; other canteen admin denied).
 * 8. Transactional slot-capacity release on cancellation (decrements reservedCount exactly once).
 * 9. Repeated cancellation idempotency & non-negative capacity invariant (reservedCount >= 0).
 * 10. Replay idempotency & deterministic history event IDs (no duplicate history events on retries).
 * 11. Concurrent transition safety.
 * 12. Direct Firestore write denial (orders & statusHistory subcollection immutable from client).
 * 13. Admin queue canteen isolation & status filtering.
 * 14. Exact order search isolation (cross-canteen search returns NOT_FOUND).
 * 15. Customer UID masking in admin responses.
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

// Test users
const USERS = {
  studentA: { uid: 'student_alice_8', role: 'student', status: 'active' },
  studentB: { uid: 'student_bob_8', role: 'student', status: 'active' },
  admin1: { uid: 'admin_canteen_1_8', role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_STATUS_A'] },
  admin2: { uid: 'admin_canteen_2_8', role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_STATUS_B'] },
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
    { token: customToken, returnSecureToken: true }
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
        error: err.response.data.error || err.response.data,
      };
    }
    return { ok: false, error: { message: err.message } };
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

// Helpers to seed database
const CANTEEN_A = 'CANTEEN_STATUS_A';
const CANTEEN_B = 'CANTEEN_STATUS_B';
const SLOT_A = 'SLOT_STATUS_A_1';
const SLOT_B = 'SLOT_STATUS_B_1';

async function seedTestData() {
  console.log('\n--- Seeding Test Data for Step 8 ---');

  // Seed Canteen A & B
  await db.collection('canteens').doc(CANTEEN_A).set({
    canteenId: CANTEEN_A,
    name: 'Canteen Status A',
    code: 'STATUSA',
    isActive: true,
    operatingHours: { open: '00:00', close: '23:59' },
    isOpen: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('canteens').doc(CANTEEN_B).set({
    canteenId: CANTEEN_B,
    name: 'Canteen Status B',
    code: 'STATUSB',
    isActive: true,
    operatingHours: { open: '00:00', close: '23:59' },
    isOpen: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // System Config for synthetic demo payments
  await db.collection('systemConfig').doc('demoPayment').set({
    enabled: true,
    paymentMode: 'demo',
    allowlist: ['demo-grabngo-local'],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Categories
  await db.collection('canteens').doc(CANTEEN_A).collection('categories').doc('CAT_1').set({
    categoryId: 'CAT_1',
    name: 'Snacks',
    isActive: true,
    sortOrder: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('canteens').doc(CANTEEN_B).collection('categories').doc('CAT_B1').set({
    categoryId: 'CAT_B1',
    name: 'Meals',
    isActive: true,
    sortOrder: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Menu items in 'items' subcollection
  await db.collection('canteens').doc(CANTEEN_A).collection('items').doc('ITEM_1').set({
    itemId: 'ITEM_1',
    name: 'Item 1',
    priceInPaise: 5000,
    isActive: true,
    isAvailable: true,
    categoryId: 'CAT_1',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('canteens').doc(CANTEEN_B).collection('items').doc('ITEM_B1').set({
    itemId: 'ITEM_B1',
    name: 'Item B1',
    priceInPaise: 6000,
    isActive: true,
    isAvailable: true,
    categoryId: 'CAT_B1',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Pickup Slots (Future slot so cancellation window is open, within 08:00-19:00 operating hours)
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).set({
    date: '2026-12-31',
    startTime: '14:00',
    endTime: '14:30',
    timezone: 'Asia/Kolkata',
    isOpen: true,
    capacity: 10,
    reservedCount: 0,
  });

  await db.collection('canteens').doc(CANTEEN_B).collection('pickupSlots').doc(SLOT_B).set({
    date: '2026-12-31',
    startTime: '14:00',
    endTime: '14:30',
    timezone: 'Asia/Kolkata',
    isOpen: true,
    capacity: 10,
    reservedCount: 0,
  });

  // Seed Admins
  await db.collection('admins').doc(USERS.admin1.uid).set({
    role: 'canteen_admin',
    status: 'active',
    canteenIds: [CANTEEN_A],
  });

  await db.collection('admins').doc(USERS.admin2.uid).set({
    role: 'canteen_admin',
    status: 'active',
    canteenIds: [CANTEEN_B],
  });

  // Seed Student profiles
  await db.collection('users').doc(USERS.studentA.uid).set({
    role: 'student',
    status: 'active',
    name: 'Alice Student',
  });

  await db.collection('users').doc(USERS.studentB.uid).set({
    role: 'student',
    status: 'active',
    name: 'Bob Student',
  });

  console.log('Seeding complete.\n');
}

// Helper to create an order cleanly for testing transitions
async function createTestOrder(studentKey, canteenId, slotId, paymentMethod = 'cash') {
  const student = USERS[studentKey];
  const itemId = canteenId === CANTEEN_A ? 'ITEM_1' : 'ITEM_B1';

  // Put item in cart
  await db.collection('users').doc(student.uid).collection('cart').doc(itemId).set({
    canteenId,
    quantity: 1,
  });

  const idempotencyKey = crypto.randomUUID();
  const res = await callFunction('createOrder', {
    canteenId,
    items: [{ itemId, quantity: 1 }],
    pickupSlotId: slotId,
    paymentMethod,
    idempotencyKey,
  }, studentKey);

  if (!res.ok) {
    throw new Error(`Failed to create test order: ${JSON.stringify(res.error)}`);
  }

  return res.data.orderId;
}

async function runTests() {
  await seedTestData();

  console.log('====================================================');
  console.log(' STEP 8: ORDER STATUS & ADMIN OPERATIONS SUITE');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // SECTION 1: Valid Transitions (Cash Path)
  // placed -> accepted -> preparing -> ready_for_pickup -> completed
  // ----------------------------------------------------
  console.log('--- Section 1: Valid Transitions (Cash Path) ---');
  const cashOrderId = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  assert(Boolean(cashOrderId), `Cash order created: ${cashOrderId}`);

  // Check top-level pickupSlotId
  const initialDoc = await db.collection('orders').doc(cashOrderId).get();
  assert(initialDoc.data().pickupSlotId === SLOT_A, 'Order contains top-level pickupSlotId matching slot ID');

  // Verify initial status history
  const initialHistory = await db.collection('orders').doc(cashOrderId).collection('statusHistory').get();
  assert(initialHistory.docs.length === 1, 'Initial statusHistory created exactly 1 placed event');
  assert(initialHistory.docs[0].id === `${cashOrderId}_initial_placed`, 'Initial status history event ID is deterministic');

  // placed -> accepted (Admin 1)
  const stepAccept = await callFunction('transitionOrderStatus', {
    orderId: cashOrderId,
    nextStatus: 'accepted',
  }, 'admin1');
  assert(stepAccept.ok === true && stepAccept.data.status === 'accepted', 'Admin transitioned placed -> accepted');

  // accepted -> preparing (Admin 1)
  const stepPrep = await callFunction('transitionOrderStatus', {
    orderId: cashOrderId,
    nextStatus: 'preparing',
  }, 'admin1');
  assert(stepPrep.ok === true && stepPrep.data.status === 'preparing', 'Admin transitioned accepted -> preparing');

  // preparing -> ready_for_pickup (Admin 1)
  const stepReady = await callFunction('transitionOrderStatus', {
    orderId: cashOrderId,
    nextStatus: 'ready_for_pickup',
  }, 'admin1');
  assert(stepReady.ok === true && stepReady.data.status === 'ready_for_pickup', 'Admin transitioned preparing -> ready_for_pickup');

  // ready_for_pickup -> completed (Admin 1)
  const stepComplete = await callFunction('transitionOrderStatus', {
    orderId: cashOrderId,
    nextStatus: 'completed',
  }, 'admin1');
  assert(stepComplete.ok === true && stepComplete.data.status === 'completed', 'Admin transitioned ready_for_pickup -> completed');

  // Verify statusHistory subcollection for full cash lifecycle
  const fullCashHistory = await db.collection('orders').doc(cashOrderId).collection('statusHistory').orderBy('createdAt', 'asc').get();
  assert(fullCashHistory.docs.length === 5, `Full lifecycle recorded 5 statusHistory events (actual: ${fullCashHistory.docs.length})`);

  // ----------------------------------------------------
  // SECTION 2: Valid Transitions (Online Demo Path)
  // placed -> verifyDemoPayment -> accepted -> preparing -> ready_for_pickup -> completed
  // ----------------------------------------------------
  console.log('\n--- Section 2: Valid Transitions (Online Demo Path) ---');
  const onlineOrderId = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'upi_demo');

  // Trying to accept online order before payment verification must fail
  const prematureAccept = await callFunction('transitionOrderStatus', {
    orderId: onlineOrderId,
    nextStatus: 'accepted',
  }, 'admin1');
  assert(prematureAccept.ok === false, 'Accepting unverified online order rejected (status placed requires payment)');

  // verifyDemoPayment (emulator only)
  const demoPayRes = await callFunction('verifyDemoPayment', {
    orderId: onlineOrderId,
  }, 'admin1');
  assert(demoPayRes.ok === true && demoPayRes.data.status === 'payment_verified', 'verifyDemoPayment succeeded (status: payment_verified)');

  // payment_verified -> accepted
  const onlineAccept = await callFunction('transitionOrderStatus', {
    orderId: onlineOrderId,
    nextStatus: 'accepted',
  }, 'admin1');
  assert(onlineAccept.ok === true && onlineAccept.data.status === 'accepted', 'payment_verified -> accepted succeeded');

  // accepted -> preparing -> ready_for_pickup -> completed
  await callFunction('transitionOrderStatus', { orderId: onlineOrderId, nextStatus: 'preparing' }, 'admin1');
  await callFunction('transitionOrderStatus', { orderId: onlineOrderId, nextStatus: 'ready_for_pickup' }, 'admin1');
  const onlineComplete = await callFunction('transitionOrderStatus', { orderId: onlineOrderId, nextStatus: 'completed' }, 'admin1');
  assert(onlineComplete.ok === true && onlineComplete.data.status === 'completed', 'Online order reached terminal completed status');

  // ----------------------------------------------------
  // SECTION 3: Invalid Transitions & Terminal State Protection
  // ----------------------------------------------------
  console.log('\n--- Section 3: Invalid Transitions & Terminal State Protection ---');
  const testOrder3 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');

  // placed -> preparing (skipped accepted)
  const skipToPrep = await callFunction('transitionOrderStatus', {
    orderId: testOrder3,
    nextStatus: 'preparing',
  }, 'admin1');
  assert(skipToPrep.ok === false, 'placed -> preparing rejected (cannot skip accepted)');

  // placed -> completed (skipped all steps)
  const skipToDone = await callFunction('transitionOrderStatus', {
    orderId: testOrder3,
    nextStatus: 'completed',
  }, 'admin1');
  assert(skipToDone.ok === false, 'placed -> completed rejected');

  // Advance to completed
  await callFunction('transitionOrderStatus', { orderId: testOrder3, nextStatus: 'accepted' }, 'admin1');
  await callFunction('transitionOrderStatus', { orderId: testOrder3, nextStatus: 'preparing' }, 'admin1');
  await callFunction('transitionOrderStatus', { orderId: testOrder3, nextStatus: 'ready_for_pickup' }, 'admin1');
  await callFunction('transitionOrderStatus', { orderId: testOrder3, nextStatus: 'completed' }, 'admin1');

  // completed -> preparing (transition out of terminal state)
  const outOfDone = await callFunction('transitionOrderStatus', {
    orderId: testOrder3,
    nextStatus: 'preparing',
  }, 'admin1');
  assert(outOfDone.ok === false, 'Transition out of terminal status "completed" rejected');

  // completed -> cancelled (cancel completed order)
  const cancelDone = await callFunction('transitionOrderStatus', {
    orderId: testOrder3,
    nextStatus: 'cancelled',
  }, 'admin1');
  assert(cancelDone.ok === false, 'Cancelling completed order rejected');

  // ----------------------------------------------------
  // ----------------------------------------------------
  // SECTION 4: Pickup Capacity Release Hardening Tests
  // ----------------------------------------------------
  console.log('\n--- Section 4: Pickup Capacity Release Hardening Tests ---');

  // Test 1: Valid cancellation with reservedCount = 3 -> becomes 2, exactly 1 history event
  console.log('  Testing Test 1: Valid cancellation with reservedCount = 3...');
  const orderForTest1 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 3,
  });
  const t1Res = await callFunction('transitionOrderStatus', {
    orderId: orderForTest1,
    nextStatus: 'cancelled',
    reason: 'Student cancelled order',
  }, 'studentA');
  assert(t1Res.ok === true && t1Res.data.status === 'cancelled', 'Valid cancellation: order transitioned to cancelled');
  const t1Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t1Slot.reservedCount === 2, `Valid cancellation: reservedCount decremented from 3 to 2 (actual: ${t1Slot.reservedCount})`);
  const t1History = await db.collection('orders').doc(orderForTest1).collection('statusHistory').get();
  const t1CancelEvents = t1History.docs.filter(d => d.data().toStatus === 'cancelled');
  assert(t1CancelEvents.length === 1, 'Valid cancellation: exactly one cancellation history event created');

  // Test 2: Valid rejection with reservedCount = 1 -> becomes 0, no negative value written
  console.log('  Testing Test 2: Valid rejection with reservedCount = 1...');
  const orderForTest2 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 1,
  });
  const t2Res = await callFunction('transitionOrderStatus', {
    orderId: orderForTest2,
    nextStatus: 'rejected',
    reason: 'Kitchen closed early',
  }, 'admin1');
  assert(t2Res.ok === true && t2Res.data.status === 'rejected', 'Valid rejection: order transitioned to rejected');
  const t2Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t2Slot.reservedCount === 0, `Valid rejection: reservedCount decremented from 1 to 0 (actual: ${t2Slot.reservedCount})`);
  assert(t2Slot.reservedCount >= 0, 'Valid rejection: reservedCount is non-negative');

  // Test 3: Invalid slot state with reservedCount = 0 -> rejected, order unchanged, no history, slot unchanged
  console.log('  Testing Test 3: Invalid slot state with reservedCount = 0...');
  const orderForTest3 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 0,
  });
  const t3HistoryCountBefore = (await db.collection('orders').doc(orderForTest3).collection('statusHistory').get()).docs.length;
  const t3Res = await callFunction('transitionOrderStatus', {
    orderId: orderForTest3,
    nextStatus: 'cancelled',
  }, 'studentA');
  assert(t3Res.ok === false, 'Invalid state (reservedCount = 0): cancellation rejected');
  assert(
    t3Res.error?.status === 'FAILED_PRECONDITION' || t3Res.error?.message?.includes('inconsistent'),
    'Invalid state (reservedCount = 0): rejected with FAILED_PRECONDITION / capacity state is inconsistent'
  );
  const t3OrderDoc = (await db.collection('orders').doc(orderForTest3).get()).data();
  assert(t3OrderDoc.status === 'placed', `Invalid state (reservedCount = 0): order status unchanged (${t3OrderDoc.status})`);
  const t3HistoryCountAfter = (await db.collection('orders').doc(orderForTest3).collection('statusHistory').get()).docs.length;
  assert(t3HistoryCountAfter === t3HistoryCountBefore, 'Invalid state (reservedCount = 0): no history event written');
  const t3Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t3Slot.reservedCount === 0, 'Invalid state (reservedCount = 0): slot reservedCount unchanged');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({ capacity: 10, reservedCount: 1 });

  // Test 4: Invalid slot state with reservedCount = -1 -> rejected, no write occurs
  console.log('  Testing Test 4: Invalid slot state with reservedCount = -1...');
  const orderForTest4 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: -1,
  });
  const t4Res = await callFunction('transitionOrderStatus', {
    orderId: orderForTest4,
    nextStatus: 'cancelled',
  }, 'studentA');
  assert(t4Res.ok === false, 'Invalid state (reservedCount = -1): operation rejected');
  const t4OrderDoc = (await db.collection('orders').doc(orderForTest4).get()).data();
  assert(t4OrderDoc.status === 'placed', 'Invalid state (reservedCount = -1): order status remains placed');
  const t4Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t4Slot.reservedCount === -1, 'Invalid state (reservedCount = -1): slot value unchanged at -1');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({ capacity: 10, reservedCount: 1 });

  // Test 5: Invalid slot state with non-integer reservedCount -> rejected, no write occurs
  console.log('  Testing Test 5: Invalid slot state with non-integer reservedCount...');
  const orderForTest5 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 2.5,
  });
  const t5Res = await callFunction('transitionOrderStatus', {
    orderId: orderForTest5,
    nextStatus: 'cancelled',
  }, 'studentA');
  assert(t5Res.ok === false, 'Invalid state (non-integer reservedCount): operation rejected');
  const t5OrderDoc = (await db.collection('orders').doc(orderForTest5).get()).data();
  assert(t5OrderDoc.status === 'placed', 'Invalid state (non-integer reservedCount): order status remains placed');
  const t5Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t5Slot.reservedCount === 2.5, 'Invalid state (non-integer reservedCount): slot value unchanged');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({ capacity: 10, reservedCount: 1 });

  // Test 6: Invalid slot state with reservedCount > capacity -> rejected, no write occurs
  console.log('  Testing Test 6: Invalid slot state with reservedCount > capacity...');
  const orderForTest6 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 5,
    reservedCount: 7,
  });
  const t6Res = await callFunction('transitionOrderStatus', {
    orderId: orderForTest6,
    nextStatus: 'cancelled',
  }, 'studentA');
  assert(t6Res.ok === false, 'Invalid state (reservedCount > capacity): operation rejected');
  const t6OrderDoc = (await db.collection('orders').doc(orderForTest6).get()).data();
  assert(t6OrderDoc.status === 'placed', 'Invalid state (reservedCount > capacity): order status remains placed');
  const t6Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t6Slot.reservedCount === 7, 'Invalid state (reservedCount > capacity): slot value unchanged');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({ capacity: 10, reservedCount: 1 });

  // Test 7: Repeated cancellation / rejection -> releases capacity once, retry is idempotent
  console.log('  Testing Test 7: Repeated cancellation / rejection...');
  const orderForTest7 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 4,
  });
  const t7Res1 = await callFunction('transitionOrderStatus', {
    orderId: orderForTest7,
    nextStatus: 'cancelled',
  }, 'studentA');
  assert(t7Res1.ok === true && t7Res1.data.status === 'cancelled', 'First cancellation succeeds');
  const t7SlotAfterFirst = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t7SlotAfterFirst.reservedCount === 3, 'Capacity decremented once to 3');

  const t7HistoryBeforeRetry = (await db.collection('orders').doc(orderForTest7).collection('statusHistory').get()).docs.length;
  const t7Res2 = await callFunction('transitionOrderStatus', {
    orderId: orderForTest7,
    nextStatus: 'cancelled',
  }, 'studentA');
  assert(t7Res2.ok === true && t7Res2.data.isIdempotent === true, 'Repeated cancellation returns isIdempotent: true');
  const t7SlotAfterSecond = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t7SlotAfterSecond.reservedCount === 3, 'Repeated cancellation did not decrement capacity again');
  const t7HistoryAfterRetry = (await db.collection('orders').doc(orderForTest7).collection('statusHistory').get()).docs.length;
  assert(t7HistoryAfterRetry === t7HistoryBeforeRetry, 'Repeated cancellation did not create duplicate history event');

  // Test 8: Concurrent cancellation attempts -> capacity released at most once
  console.log('  Testing Test 8: Concurrent cancellation attempts...');
  const orderForTest8 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 5,
  });
  const [cRes1, cRes2] = await Promise.all([
    callFunction('transitionOrderStatus', { orderId: orderForTest8, nextStatus: 'cancelled' }, 'studentA'),
    callFunction('transitionOrderStatus', { orderId: orderForTest8, nextStatus: 'cancelled' }, 'studentA'),
  ]);
  assert(cRes1.ok === true && cRes2.ok === true, 'Both concurrent cancellation calls resolved safely');
  const t8Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t8Slot.reservedCount === 4, `Concurrent cancellations released capacity at most once (actual: ${t8Slot.reservedCount})`);
  const t8Order = (await db.collection('orders').doc(orderForTest8).get()).data();
  assert(t8Order.status === 'cancelled', 'Order status is cancelled');
  const t8History = await db.collection('orders').doc(orderForTest8).collection('statusHistory').get();
  const t8CancelEvents = t8History.docs.filter(d => d.data().toStatus === 'cancelled');
  assert(t8CancelEvents.length === 1, 'Exactly one cancellation history event created despite concurrent calls');

  // Test 9: Non-cancellation transition does NOT change reservedCount
  console.log('  Testing Test 9: Non-cancellation transition does not change reservedCount...');
  const orderForTest9 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 5,
  });
  await callFunction('transitionOrderStatus', { orderId: orderForTest9, nextStatus: 'accepted' }, 'admin1');
  await callFunction('transitionOrderStatus', { orderId: orderForTest9, nextStatus: 'preparing' }, 'admin1');
  const t9Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t9Slot.reservedCount === 5, `Non-cancellation transitions (placed->accepted->preparing) did not alter reservedCount (actual: ${t9Slot.reservedCount})`);

  // Test 10: Unauthorized cancellation/rejection preserves state
  console.log('  Testing Test 10: Unauthorized cancellation/rejection preserves state...');
  const orderForTest10 = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 5,
  });
  const unauthStudentCancel = await callFunction('transitionOrderStatus', {
    orderId: orderForTest10,
    nextStatus: 'cancelled',
  }, 'studentB'); // Student B tries to cancel Student A's order
  assert(unauthStudentCancel.ok === false, 'Unauthorized student cancellation rejected (PERMISSION_DENIED)');

  const t10Slot = (await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).get()).data();
  assert(t10Slot.reservedCount === 5, 'Slot reservedCount unchanged after unauthorized cancellation attempt');
  const t10Order = (await db.collection('orders').doc(orderForTest10).get()).data();
  assert(t10Order.status === 'placed', 'Order status unchanged after unauthorized cancellation attempt');

  // Reset slot capacity to valid standard for subsequent tests
  await db.collection('canteens').doc(CANTEEN_A).collection('pickupSlots').doc(SLOT_A).update({
    capacity: 10,
    reservedCount: 1,
  });

  // ----------------------------------------------------
  // SECTION 6: Admin Rejection Authorization & Canteen Isolation
  // ----------------------------------------------------
  console.log('\n--- Section 6: Admin Rejection & Cross-Canteen Isolation ---');
  const canteenBOrder = await createTestOrder('studentA', CANTEEN_B, SLOT_B, 'cash');

  // Admin 1 (Canteen A) tries to transition order from Canteen B
  const crossAdminTransition = await callFunction('transitionOrderStatus', {
    orderId: canteenBOrder,
    nextStatus: 'accepted',
  }, 'admin1');
  assert(crossAdminTransition.ok === false, 'Admin 1 (Canteen A) cannot transition order in Canteen B (PERMISSION_DENIED)');

  // Admin 2 (Canteen B) rejects order with reason
  const admin2Reject = await callFunction('transitionOrderStatus', {
    orderId: canteenBOrder,
    nextStatus: 'rejected',
    reason: 'Kitchen out of ingredients',
  }, 'admin2');
  assert(admin2Reject.ok === true && admin2Reject.data.status === 'rejected', 'Admin 2 rejected Canteen B order with audit reason');

  // ----------------------------------------------------
  // SECTION 7: Replay Idempotency & Deterministic History Event IDs
  // ----------------------------------------------------
  console.log('\n--- Section 7: Replay Idempotency & Deterministic History Events ---');
  const idempOrder = await createTestOrder('studentA', CANTEEN_A, SLOT_A, 'cash');
  await callFunction('transitionOrderStatus', { orderId: idempOrder, nextStatus: 'accepted' }, 'admin1');

  const historyBeforeRetry = (await db.collection('orders').doc(idempOrder).collection('statusHistory').get()).docs.length;

  // Replay identical transition
  const replayRes = await callFunction('transitionOrderStatus', {
    orderId: idempOrder,
    nextStatus: 'accepted',
  }, 'admin1');
  assert(replayRes.ok === true && replayRes.data.isIdempotent === true, 'Replay of same transition returns isIdempotent: true');

  const historyAfterRetry = (await db.collection('orders').doc(idempOrder).collection('statusHistory').get()).docs.length;
  assert(historyAfterRetry === historyBeforeRetry, `Replay did not create duplicate status history event (count: ${historyAfterRetry})`);

  // ----------------------------------------------------
  // SECTION 8: Immutable Order Fields & Subcollection Protection
  // ----------------------------------------------------
  console.log('\n--- Section 8: Direct Client Write Denial & Immutable Order Fields ---');
  // Test direct client write to order document
  let clientWriteDenied = false;
  try {
    const studentToken = await getIdToken('studentA');
    await axios.patch(
      `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${idempOrder}`,
      { fields: { status: { stringValue: 'completed' } } },
      { headers: { Authorization: `Bearer ${studentToken}` } }
    );
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 400)) {
      clientWriteDenied = true;
    }
  }
  assert(clientWriteDenied, 'Direct client write to orders collection rejected by Firestore rules');

  // Test direct client write to statusHistory subcollection
  let historyWriteDenied = false;
  try {
    const studentToken = await getIdToken('studentA');
    await axios.post(
      `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${idempOrder}/statusHistory`,
      { fields: { fake: { stringValue: 'injected' } } },
      { headers: { Authorization: `Bearer ${studentToken}` } }
    );
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 400)) {
      historyWriteDenied = true;
    }
  }
  assert(historyWriteDenied, 'Direct client write to statusHistory subcollection rejected (allow write: if false)');

  // ----------------------------------------------------
  // SECTION 9: Admin Queue Isolation, Status Filtering & Pagination
  // ----------------------------------------------------
  console.log('\n--- Section 9: Admin Queue Isolation & Status Filtering ---');
  // Admin 1 queries Canteen A queue
  const queueResA = await callFunction('getAdminOrderQueue', {
    canteenId: CANTEEN_A,
  }, 'admin1');
  assert(queueResA.ok === true && Array.isArray(queueResA.data.orders), 'Admin 1 fetched Canteen A queue');
  const allBelongToA = queueResA.data.orders.every(o => o.canteenId === CANTEEN_A);
  assert(allBelongToA, 'All orders in Admin 1 queue belong strictly to Canteen A');

  // Admin 1 queries Canteen B queue (unauthorized)
  const queueResB = await callFunction('getAdminOrderQueue', {
    canteenId: CANTEEN_B,
  }, 'admin1');
  assert(queueResB.ok === false, 'Admin 1 cannot fetch Canteen B queue (PERMISSION_DENIED)');

  // Status filtering in queue
  const queuePlacedOnly = await callFunction('getAdminOrderQueue', {
    canteenId: CANTEEN_A,
    status: 'placed',
  }, 'admin1');
  assert(queuePlacedOnly.ok === true, 'Admin queue status filtering executed');
  const allPlaced = queuePlacedOnly.data.orders.every(o => o.status === 'placed');
  assert(allPlaced, 'Filtered queue contains strictly orders with status == "placed"');

  // ----------------------------------------------------
  // SECTION 10: Exact Search Isolation & Masked Customer UID
  // ----------------------------------------------------
  console.log('\n--- Section 10: Exact Search Isolation & Privacy Masking ---');
  // Admin 1 searches for order in Canteen A
  const searchA = await callFunction('searchAdminOrder', {
    canteenId: CANTEEN_A,
    queryOrderId: cashOrderId,
  }, 'admin1');
  assert(searchA.ok === true && searchA.data.order !== null, 'Admin 1 found order in Canteen A');
  assert(
    searchA.data.order.maskedCustomer &&
    searchA.data.order.maskedCustomer.startsWith('student_...') &&
    !searchA.data.order.studentUid,
    `Raw customer UID masked in search response (${searchA.data.order.maskedCustomer})`
  );

  // Admin 1 searches for order that belongs to Canteen B
  const searchCross = await callFunction('searchAdminOrder', {
    canteenId: CANTEEN_A,
    queryOrderId: canteenBOrder,
  }, 'admin1');
  assert(
    searchCross.ok === false && (searchCross.status === 404 || searchCross.error?.status === 'NOT_FOUND'),
    'Cross-canteen exact search returns NOT_FOUND without leaking existence'
  );

  // Verify UID masking in getAdminOrderQueue as well
  const firstQueueOrder = queueResA.data.orders[0];
  assert(
    firstQueueOrder &&
    firstQueueOrder.maskedCustomer &&
    firstQueueOrder.maskedCustomer.startsWith('student_...') &&
    !firstQueueOrder.studentUid,
    `Raw customer UID masked in admin queue response (${firstQueueOrder?.maskedCustomer})`
  );

  // ----------------------------------------------------
  // FINAL SUMMARY
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log(` SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  try {
    await admin.app().delete();
  } catch (e) {}

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error running Step 8 status tests:', err);
  process.exit(1);
});
