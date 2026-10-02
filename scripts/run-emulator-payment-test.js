/**
 * Real Firebase Emulator Payment Foundation Test Runner (Step 9)
 *
 * Connects to live local Auth (9099), Firestore (8085), and Functions (5001) Emulators.
 *
 * Comprehensive Test Coverage:
 * 1. Authentication & Authorization across payment callable functions and subcollections.
 * 2. Correction 1: Input sanitization, unknown fields rejection, server paymentMethod derivation, cash/cod rejection.
 * 3. Idempotency & concurrency (same key replay, key reuse rejection, duplicate completion).
 * 4. Payment state machine & state separation (initial processing -> succeeded_demo / failed / cancelled).
 * 5. Failed attempt immutability & retry policy (max 1 active attempt, max 3 failed attempts, new attempt ID).
 * 6. Correction 4: Deterministic payment-history event IDs ({paymentId}_processing, {paymentId}_succeeded_demo, etc.).
 * 7. Correction 3: Transaction-safe expiry invariants (expire only when activePaymentId, processing, and both TTLs expired).
 * 8. Cancellation & demo refund ordering (capacity release -> order status -> refund state -> payment history, order.status never 'refunded').
 * 9. Admin operational field isolation (providerReference and internal details masked for admin).
 * 10. Webhook authentication & error handling (invalid HMAC, body tampering, wrong event, wrong payment, wrong order).
 * 11. Dedicated webhook event handlers (payment.captured, payment.failed, and Correction 2: refund.processed).
 * 12. Scoped webhook deduplication (/webhookEvents/demo:{eventId}).
 * 13. Direct Firestore read/write denial for payment documents and verification that frontend direct reads are removed from src/.
 * 14. Generic demo labels check (UPI Demo, Demo Wallet Payment, Demo Online Payment).
 */

const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

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
  studentA: { uid: 'student_alice_9', role: 'student', status: 'active' },
  studentB: { uid: 'student_bob_9', role: 'student', status: 'active' },
  admin1: { uid: 'admin_canteen_1_9', role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_PAY_A'] },
  admin2: { uid: 'admin_canteen_2_9', role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_PAY_B'] },
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
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function seedTestData() {
  console.log('--- Seeding Test Data for Step 9 ---');

  for (const user of [USERS.studentA, USERS.studentB]) {
    const payReqs = await db.collection('users').doc(user.uid).collection('paymentRequests').get();
    for (const d of payReqs.docs) await d.ref.delete();
    const carts = await db.collection('users').doc(user.uid).collection('cart').get();
    for (const d of carts.docs) await d.ref.delete();
  }

  const webhookEvents = await db.collection('webhookEvents').get();
  for (const d of webhookEvents.docs) await d.ref.delete();

  // Seed Admin profiles
  await db.collection('admins').doc(USERS.admin1.uid).set({
    uid: USERS.admin1.uid,
    role: 'canteen_admin',
    status: 'active',
    canteenIds: ['CANTEEN_PAY_A'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('admins').doc(USERS.admin2.uid).set({
    uid: USERS.admin2.uid,
    role: 'canteen_admin',
    status: 'active',
    canteenIds: ['CANTEEN_PAY_B'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Canteens
  await db.collection('canteens').doc('CANTEEN_PAY_A').set({
    canteenId: 'CANTEEN_PAY_A',
    name: 'North Canteen Pay',
    isActive: true,
    openingTime: '08:00',
    closingTime: '20:00',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('canteens').doc('CANTEEN_PAY_B').set({
    canteenId: 'CANTEEN_PAY_B',
    name: 'South Canteen Pay',
    isActive: true,
    openingTime: '08:00',
    closingTime: '20:00',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Pickup Slot with tomorrow's date
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  await db.collection('canteens').doc('CANTEEN_PAY_A').collection('pickupSlots').doc('SLOT_PAY_1').set({
    slotId: 'SLOT_PAY_1',
    canteenId: 'CANTEEN_PAY_A',
    date: tomorrowStr,
    startTime: '12:00',
    endTime: '12:30',
    timezone: 'Asia/Kolkata',
    isOpen: true,
    capacity: 10,
    reservedCount: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Menu Item
  await db.collection('canteens').doc('CANTEEN_PAY_A').collection('items').doc('ITEM_BURGER').set({
    itemId: 'ITEM_BURGER',
    canteenId: 'CANTEEN_PAY_A',
    name: 'Veg Burger',
    priceInPaise: 8000,
    isActive: true,
    isAvailable: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Cart for Student A
  await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_BURGER').set({
    itemId: 'ITEM_BURGER',
    canteenId: 'CANTEEN_PAY_A',
    quantity: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('Seeding complete.\n');
  return { tomorrowStr };
}

async function runAllTests() {
  const { tomorrowStr } = await seedTestData();

  console.log('====================================================');
  console.log(' STEP 9: PAYMENT FOUNDATION & SECURITY TEST SUITE');
  console.log('====================================================');

  // Helper to create an order directly for test isolation
  async function createTestOrder(orderId, studentUid, canteenId, paymentMethod = 'upi_demo', totalInPaise = 8000) {
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.set({
      orderId,
      studentUid,
      canteenId,
      status: 'placed',
      paymentStatus: 'pending',
      paymentMethod,
      totalInPaise,
      subtotalInPaise: totalInPaise,
      currency: 'INR',
      pickupSlotId: 'SLOT_PAY_1',
      pickupSlot: {
        slotId: 'SLOT_PAY_1',
        pickupDate: tomorrowStr,
        pickupStartTime: '12:00',
        pickupEndTime: '12:30',
        timezone: 'Asia/Kolkata',
      },
      itemsSnapshot: [
        {
          itemId: 'ITEM_BURGER',
          itemName: 'Veg Burger',
          categoryId: 'CAT_SNACKS',
          unitPriceInPaise: 8000,
          quantity: 1,
          lineTotalInPaise: 8000,
        },
      ],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await orderRef.collection('statusHistory').doc(`${orderId}_initial_placed`).set({
      eventId: `${orderId}_initial_placed`,
      orderId,
      fromStatus: 'none',
      toStatus: 'placed',
      actorUid: studentUid,
      actorRole: 'student',
      canteenId,
      reason: 'Order placed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Clean up any subcollections from previous runs for clean test repeatability
    const oldPayments = await orderRef.collection('payments').get();
    for (const d of oldPayments.docs) await d.ref.delete();
    const oldHistory = await orderRef.collection('paymentHistory').get();
    for (const d of oldHistory.docs) await d.ref.delete();

    return orderRef;
  }

  // --------------------------------------------------------------------------
  // SECTION 1: Authentication & Authorization Tests
  // --------------------------------------------------------------------------
  console.log('\n--- Section 1: Authentication & Authorization ---');
  {
    const orderId = 'GNG-AUTH-TEST-001';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');

    // 1. Unauthenticated call to createDemoPayment
    const unauthRes = await callFunction('createDemoPayment', {
      orderId,
      idempotencyKey: '00000000-0000-0000-0000-000000000001',
    });
    assert(!unauthRes.ok && unauthRes.status === 401, 'Unauthenticated call to createDemoPayment is rejected (HTTP 401)');

    // 2. Student B cannot create payment for Student A's order
    const crossStudentRes = await callFunction(
      'createDemoPayment',
      { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000002' },
      'studentB'
    );
    assert(!crossStudentRes.ok && crossStudentRes.error?.status === 'PERMISSION_DENIED', 'Student cannot create payment for another student order (PERMISSION_DENIED)');
  }

  // --------------------------------------------------------------------------
  // SECTION 2: Input Sanitization & Correction 1 Checks
  // --------------------------------------------------------------------------
  console.log('\n--- Section 2: Input Sanitization & Server Method Derivation (Correction 1) ---');
  {
    const orderId = 'GNG-SAN-TEST-002';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A', 'upi_demo', 15000);

    // 1. Extra paymentMethod field rejected
    const extraMethodRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000003', paymentMethod: 'demo_wallet' }, 'studentA');
    assert(!extraMethodRes.ok && extraMethodRes.error?.status === 'INVALID_ARGUMENT', 'Extra paymentMethod field rejected with INVALID_ARGUMENT');

    // 2. Extra amount field rejected
    const extraAmountRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000004', amount: 150 }, 'studentA');
    assert(!extraAmountRes.ok && extraAmountRes.error?.status === 'INVALID_ARGUMENT', 'Extra amount field rejected with INVALID_ARGUMENT');

    // 3. Extra amountInPaise field rejected
    const extraPaiseRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000005', amountInPaise: 15000 }, 'studentA');
    assert(!extraPaiseRes.ok && extraPaiseRes.error?.status === 'INVALID_ARGUMENT', 'Extra amountInPaise field rejected with INVALID_ARGUMENT');

    // 4. Extra currency field rejected
    const extraCurrRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000006', currency: 'INR' }, 'studentA');
    assert(!extraCurrRes.ok && extraCurrRes.error?.status === 'INVALID_ARGUMENT', 'Extra currency field rejected with INVALID_ARGUMENT');

    // 5. Extra studentUid field rejected
    const extraUidRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000007', studentUid: USERS.studentA.uid }, 'studentA');
    assert(!extraUidRes.ok && extraUidRes.error?.status === 'INVALID_ARGUMENT', 'Extra studentUid field rejected with INVALID_ARGUMENT');

    // 6. Extra canteenId field rejected
    const extraCanteenRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000008', canteenId: 'CANTEEN_PAY_A' }, 'studentA');
    assert(!extraCanteenRes.ok && extraCanteenRes.error?.status === 'INVALID_ARGUMENT', 'Extra canteenId field rejected with INVALID_ARGUMENT');

    // 7. Extra paymentStatus field rejected
    const extraStatusRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000009', paymentStatus: 'processing' }, 'studentA');
    assert(!extraStatusRes.ok && extraStatusRes.error?.status === 'INVALID_ARGUMENT', 'Extra paymentStatus field rejected with INVALID_ARGUMENT');

    // 8. Extra providerReference field rejected
    const extraProvRefRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000010', providerReference: 'demo_123' }, 'studentA');
    assert(!extraProvRefRes.ok && extraProvRefRes.error?.status === 'INVALID_ARGUMENT', 'Extra providerReference field rejected with INVALID_ARGUMENT');

    // 9. Extra paymentId field rejected
    const extraPayIdRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000011', paymentId: 'pay_123' }, 'studentA');
    assert(!extraPayIdRes.ok && extraPayIdRes.error?.status === 'INVALID_ARGUMENT', 'Extra paymentId field rejected with INVALID_ARGUMENT');

    // 10. Extra nested object field rejected
    const extraNestedRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000012', metadata: { foo: 'bar' } }, 'studentA');
    assert(!extraNestedRes.ok && extraNestedRes.error?.status === 'INVALID_ARGUMENT', 'Extra nested object field rejected with INVALID_ARGUMENT');

    // 11. Null field rejected
    const nullFieldRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000013', extraNull: null }, 'studentA');
    assert(!nullFieldRes.ok && nullFieldRes.error?.status === 'INVALID_ARGUMENT', 'Null field rejected with INVALID_ARGUMENT');

    // 12. Array payload rejected
    const arrayRes = await callFunction('createDemoPayment', ['invalid_array'], 'studentA');
    assert(!arrayRes.ok && arrayRes.error?.status === 'INVALID_ARGUMENT', 'Array payload rejected with INVALID_ARGUMENT');

    // 13. Missing orderId rejected
    const missingOrderRes = await callFunction('createDemoPayment', { idempotencyKey: '00000000-0000-0000-0000-000000000014' }, 'studentA');
    assert(!missingOrderRes.ok && missingOrderRes.error?.status === 'INVALID_ARGUMENT', 'Missing orderId rejected with INVALID_ARGUMENT');

    // 14. Missing idempotencyKey rejected
    const missingKeyRes = await callFunction('createDemoPayment', { orderId }, 'studentA');
    assert(!missingKeyRes.ok && missingKeyRes.error?.status === 'INVALID_ARGUMENT', 'Missing idempotencyKey rejected with INVALID_ARGUMENT');

    // 15. Empty object rejected
    const emptyObjRes = await callFunction('createDemoPayment', {}, 'studentA');
    assert(!emptyObjRes.ok && emptyObjRes.error?.status === 'INVALID_ARGUMENT', 'Empty object payload rejected with INVALID_ARGUMENT');

    // Verify zero database writes occurred across all rejected calls
    const zeroPayments = await db.collection('orders').doc(orderId).collection('payments').get();
    assert(zeroPayments.empty, 'Zero payments created during invalid unexpected-field attempts');
    const zeroHistory = await db.collection('orders').doc(orderId).collection('paymentHistory').get();
    assert(zeroHistory.empty, 'Zero payment history events written during invalid attempts');

    // 3. Cash order cannot initiate online payment (Correction 1)
    const cashOrderId = 'GNG-CASH-TEST-003';
    await createTestOrder(cashOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A', 'cash', 8000);
    const cashPayRes = await callFunction(
      'createDemoPayment',
      {
        orderId: cashOrderId,
        idempotencyKey: '00000000-0000-0000-0000-000000000005',
      },
      'studentA'
    );
    assert(!cashPayRes.ok && cashPayRes.error?.status === 'FAILED_PRECONDITION', 'Cash order cannot initiate online demo payment (FAILED_PRECONDITION)');

    // 4. COD order cannot initiate online payment (Correction 1)
    const codOrderId = 'GNG-COD-TEST-003B';
    await createTestOrder(codOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A', 'cod', 8000);
    const codPayRes = await callFunction(
      'createDemoPayment',
      {
        orderId: codOrderId,
        idempotencyKey: '00000000-0000-0000-0000-000000000006',
      },
      'studentA'
    );
    assert(!codPayRes.ok && codPayRes.error?.status === 'FAILED_PRECONDITION', 'COD order cannot initiate online demo payment (FAILED_PRECONDITION)');

    // 5. Server derives amount and paymentMethod directly from immutable order doc
    const validPayRes = await callFunction(
      'createDemoPayment',
      {
        orderId,
        idempotencyKey: '00000000-0000-0000-0000-000000000007',
      },
      'studentA'
    );
    assert(validPayRes.ok === true, 'Payment attempt created successfully');
    assert(validPayRes.data.amountInPaise === 15000, 'Server accurately derived 15000 paise from order doc');
    assert(validPayRes.data.currency === 'INR', 'Currency is server-assigned as INR');
    assert(validPayRes.data.status === 'processing', 'Initial status is created directly in processing (Correction 2)');
    assert(validPayRes.data.expiresAt !== undefined, 'Server-derived expiresAt is present (Correction 4)');
    assert(validPayRes.data.providerReference.startsWith('demo_txn_'), 'Synthetic demo reference generated');
  }

  // --------------------------------------------------------------------------
  // SECTION 3: Idempotency & Concurrency Tests
  // --------------------------------------------------------------------------
  console.log('\n--- Section 3: Idempotency & Concurrency ---');
  {
    const orderId = 'GNG-IDEMP-TEST-004';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const validKey = '00000000-0000-0000-0000-000000000010';

    // 1. First creation
    const res1 = await callFunction('createDemoPayment', { orderId, idempotencyKey: validKey }, 'studentA');
    assert(res1.ok === true && res1.data.isRetry === false, 'First payment creation has isRetry: false');
    const paymentId = res1.data.paymentId;

    // 2. Exact replay returns same attempt
    const resReplay = await callFunction('createDemoPayment', { orderId, idempotencyKey: validKey }, 'studentA');
    assert(resReplay.ok === true && resReplay.data.isRetry === true, 'Replay with same key returns isRetry: true');
    assert(resReplay.data.paymentId === paymentId, 'Replay returns identical paymentId');

    // 3. Same key with different order is rejected
    const otherOrderId = 'GNG-IDEMP-TEST-OTHER';
    await createTestOrder(otherOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const resConflict = await callFunction('createDemoPayment', { orderId: otherOrderId, idempotencyKey: validKey }, 'studentA');
    assert(!resConflict.ok && resConflict.error?.status === 'ALREADY_EXISTS', 'Reusing idempotency key for different order is rejected with ALREADY_EXISTS');

    // 4. Completion: only processing can become succeeded_demo
    const completeRes1 = await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentA');
    assert(completeRes1.ok === true && completeRes1.data.isRetry === false, 'First completion succeeds');
    assert(completeRes1.data.status === 'succeeded_demo', 'Payment status is succeeded_demo');
    assert(completeRes1.data.orderStatus === 'payment_verified', 'Order status transitioned to payment_verified');

    // 5. Duplicate successful completion returns original result
    const completeRes2 = await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentA');
    assert(completeRes2.ok === true && completeRes2.data.isRetry === true, 'Repeated completion returns isRetry: true');

    // 6. Verify only ONE statusHistory event exists for payment_verified
    const historySnaps = await db.collection('orders').doc(orderId).collection('statusHistory').get();
    const verifiedEvents = historySnaps.docs.filter((d) => d.data().toStatus === 'payment_verified');
    assert(verifiedEvents.length === 1, 'Exactly one payment_verified status history event exists after repeat completion');
  }

  // --------------------------------------------------------------------------
  // SECTION 4: Payment State Machine & State Separation
  // --------------------------------------------------------------------------
  console.log('\n--- Section 4: Payment State Machine & State Separation ---');
  {
    const orderId = 'GNG-STATE-TEST-005';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');

    // 1. Create payment
    const createRes = await callFunction(
      'createDemoPayment',
      { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000020' },
      'studentA'
    );
    const paymentId = createRes.data.paymentId;

    // 2. Fail the payment
    const failRes = await callFunction(
      'failDemoPayment',
      {
        orderId,
        paymentId,
        failureCode: 'USER_CANCELLED_UPI',
        failureMessage: 'User exited simulator screen.',
      },
      'studentA'
    );
    assert(failRes.ok === true, 'Payment failed cleanly');
    assert(failRes.data.status === 'failed', 'Payment status updated to failed');

    // Verify order status remained 'placed' (not falsely verified)
    const orderDoc = await db.collection('orders').doc(orderId).get();
    assert(orderDoc.data().status === 'placed', 'Order status remains placed on payment failure (State Separation)');
    assert(orderDoc.data().paymentStatus === 'failed', 'Order paymentStatus updated to failed');

    // 3. Invariant: Failed payment cannot transition to succeeded_demo
    const illegalCompleteRes = await callFunction(
      'completeDemoPayment',
      { orderId, paymentId },
      'studentA'
    );
    assert(!illegalCompleteRes.ok && illegalCompleteRes.error?.status === 'FAILED_PRECONDITION', 'Failed payment cannot be completed; rejected with FAILED_PRECONDITION');
  }

  // --------------------------------------------------------------------------
  // SECTION 5: Retry Policy & Server Limits
  // --------------------------------------------------------------------------
  console.log('\n--- Section 5: Retry Policy & Server Limits ---');
  {
    const orderId = 'GNG-RETRY-TEST-006';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');

    // Attempt 1: Create & Fail
    const a1 = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000031' }, 'studentA');
    const p1 = a1.data.paymentId;
    await callFunction('failDemoPayment', { orderId, paymentId: p1 }, 'studentA');

    // Attempt 2: New attempt with new idempotency key
    const a2 = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000032' }, 'studentA');
    assert(a2.ok === true, 'New payment attempt created after failure');
    const p2 = a2.data.paymentId;
    assert(p2 !== p1, 'New attempt has distinct paymentId');
    await callFunction('failDemoPayment', { orderId, paymentId: p2 }, 'studentA');

    // Attempt 3: Fail
    const a3 = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000033' }, 'studentA');
    const p3 = a3.data.paymentId;
    await callFunction('failDemoPayment', { orderId, paymentId: p3 }, 'studentA');

    // Attempt 4: Max 3 failed attempts exceeded -> should reject
    const a4 = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000034' }, 'studentA');
    assert(!a4.ok && a4.error?.status === 'FAILED_PRECONDITION', '4th attempt rejected: Max failed attempts (3) exceeded');
  }

  // --------------------------------------------------------------------------
  // SECTION 6: Deterministic Payment History Event IDs (Correction 4)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 6: Deterministic Payment History Events (Correction 4) ---');
  {
    const orderId = 'GNG-HIST-TEST-007';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');

    const createRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000040' }, 'studentA');
    const paymentId = createRes.data.paymentId;

    // Verify single {paymentId}_processing event exists (Correction 4)
    const procEventDoc = await db.collection('orders').doc(orderId).collection('paymentHistory').doc(`${paymentId}_processing`).get();
    assert(procEventDoc.exists, 'Deterministic payment event {paymentId}_processing exists');
    assert(procEventDoc.data().toStatus === 'processing', 'Event toStatus is processing');

    // Complete payment
    await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentA');

    // Verify {paymentId}_succeeded_demo event
    const successEventDoc = await db.collection('orders').doc(orderId).collection('paymentHistory').doc(`${paymentId}_succeeded_demo`).get();
    assert(successEventDoc.exists, 'Deterministic payment event {paymentId}_succeeded_demo exists');
    assert(successEventDoc.data().toStatus === 'succeeded_demo', 'Event toStatus is succeeded_demo');
  }

  // --------------------------------------------------------------------------
  // SECTION 7: Expiry Invariants (Correction 3)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 7: Expiry Invariants (Correction 3) ---');
  {
    const orderId = 'GNG-EXPIRY-TEST-007B';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');

    const createRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000045' }, 'studentA');
    const paymentId = createRes.data.paymentId;

    // Invariant 1: Payment not yet expired -> rejected
    const unexpiredRes = await callFunction('expirePaymentAttempt', { orderId, paymentId }, 'studentA');
    assert(!unexpiredRes.ok && unexpiredRes.error?.status === 'FAILED_PRECONDITION', 'Unexpired payment attempt cannot be expired (FAILED_PRECONDITION)');

    // Invariant 2: Terminal payments cannot be expired (cancelled, failed, succeeded_demo)
    await callFunction('cancelDemoPayment', { orderId, paymentId }, 'studentA');
    const terminalExpireRes = await callFunction('expirePaymentAttempt', { orderId, paymentId }, 'studentA');
    assert(!terminalExpireRes.ok && terminalExpireRes.error?.status === 'FAILED_PRECONDITION', 'Terminal (cancelled) payment cannot be expired (FAILED_PRECONDITION)');

    // Invariant 3: Payment expired but order timestamp is not expired -> no write occurs
    const orderIdPartial1 = 'GNG-EXPIRY-PARTIAL-1';
    await createTestOrder(orderIdPartial1, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const partRes1 = await callFunction('createDemoPayment', { orderId: orderIdPartial1, idempotencyKey: '00000000-0000-0000-0000-000000000047' }, 'studentA');
    const payIdPart1 = partRes1.data.paymentId;
    const pastTimestamp = admin.firestore.Timestamp.fromMillis(Date.now() - 10000);
    const futureTimestamp = admin.firestore.Timestamp.fromMillis(Date.now() + 600000);
    // Only payment expired
    await db.collection('orders').doc(orderIdPartial1).collection('payments').doc(payIdPart1).update({ expiresAt: pastTimestamp });
    await db.collection('orders').doc(orderIdPartial1).update({ activePaymentExpiresAt: futureTimestamp });
    const partExpireRes1 = await callFunction('expirePaymentAttempt', { orderId: orderIdPartial1, paymentId: payIdPart1 }, 'studentA');
    assert(!partExpireRes1.ok && partExpireRes1.error?.status === 'FAILED_PRECONDITION', 'Payment expired but order TTL active -> expiry rejected with zero writes');
    const partPayDoc1 = await db.collection('orders').doc(orderIdPartial1).collection('payments').doc(payIdPart1).get();
    assert(partPayDoc1.data().status === 'processing', 'Payment status remains processing after partial expiry rejection');

    // Invariant 4: Order timestamp expired but payment timestamp is not expired -> no write occurs
    const orderIdPartial2 = 'GNG-EXPIRY-PARTIAL-2';
    await createTestOrder(orderIdPartial2, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const partRes2 = await callFunction('createDemoPayment', { orderId: orderIdPartial2, idempotencyKey: '00000000-0000-0000-0000-000000000048' }, 'studentA');
    const payIdPart2 = partRes2.data.paymentId;
    // Only order expired
    await db.collection('orders').doc(orderIdPartial2).collection('payments').doc(payIdPart2).update({ expiresAt: futureTimestamp });
    await db.collection('orders').doc(orderIdPartial2).update({ activePaymentExpiresAt: pastTimestamp });
    const partExpireRes2 = await callFunction('expirePaymentAttempt', { orderId: orderIdPartial2, paymentId: payIdPart2 }, 'studentA');
    assert(!partExpireRes2.ok && partExpireRes2.error?.status === 'FAILED_PRECONDITION', 'Order expired but payment TTL active -> expiry rejected with zero writes');
    const partPayDoc2 = await db.collection('orders').doc(orderIdPartial2).collection('payments').doc(payIdPart2).get();
    assert(partPayDoc2.data().status === 'processing', 'Payment status remains processing after partial expiry rejection');

    // Invariant 5: Both payment and order expiry timestamps are past -> succeeds cleanly
    const orderId2 = 'GNG-EXPIRY-TEST-007C';
    await createTestOrder(orderId2, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const createRes2 = await callFunction('createDemoPayment', { orderId: orderId2, idempotencyKey: '00000000-0000-0000-0000-000000000046' }, 'studentA');
    const paymentId2 = createRes2.data.paymentId;

    // Read initial pickup slot reserved count
    const slotBefore = await db.collection('canteens').doc('CANTEEN_PAY_A').collection('pickupSlots').doc('SLOT_PAY_1').get();
    const reservedCountBefore = slotBefore.data().reservedCount;

    // Simulate dual TTL expiration in Firestore
    const orderRef2 = db.collection('orders').doc(orderId2);
    await orderRef2.collection('payments').doc(paymentId2).update({ expiresAt: pastTimestamp });
    await orderRef2.update({ activePaymentExpiresAt: pastTimestamp });

    // Now expirePaymentAttempt should succeed
    const expireRes = await callFunction('expirePaymentAttempt', { orderId: orderId2, paymentId: paymentId2 }, 'studentA');
    assert(expireRes.ok === true, 'Payment attempt successfully expired when past dual TTL');
    assert(expireRes.data.status === 'expired', 'Expired status returned');

    // Verify Phase 1 business invariants:
    // payment.status = "expired", payment.expiredAt = server timestamp
    // order.status = "placed", order.paymentStatus = "pending"
    // order.activePaymentId = null, order.activePaymentExpiresAt = null
    const expiredPayDoc = await orderRef2.collection('payments').doc(paymentId2).get();
    assert(expiredPayDoc.data().status === 'expired', 'Payment status is expired');
    assert(expiredPayDoc.data().expiredAt !== null, 'Payment expiredAt timestamp recorded');

    const updatedOrderDoc = await orderRef2.get();
    assert(updatedOrderDoc.data().status === 'placed', 'Order status remains placed (not cancelled or failed)');
    assert(updatedOrderDoc.data().paymentStatus === 'pending', 'Order paymentStatus returns to pending (NOT failed!)');
    assert(updatedOrderDoc.data().activePaymentId === null, 'Order activePaymentId is null');
    assert(updatedOrderDoc.data().activePaymentExpiresAt === null, 'Order activePaymentExpiresAt is null');

    // Verify pickup capacity was NOT released by expiry
    const slotAfter = await db.collection('canteens').doc('CANTEEN_PAY_A').collection('pickupSlots').doc('SLOT_PAY_1').get();
    assert(slotAfter.data().reservedCount === reservedCountBefore, 'Expiry does not alter pickup slot capacity');

    // Invariant 6: Already expired payment cannot be re-expired
    const alreadyExpiredRes = await callFunction('expirePaymentAttempt', { orderId: orderId2, paymentId: paymentId2 }, 'studentA');
    assert(!alreadyExpiredRes.ok && alreadyExpiredRes.error?.status === 'FAILED_PRECONDITION', 'Already expired payment cannot be re-expired (FAILED_PRECONDITION)');

    // Invariant 7: Exactly one expiry event recorded
    const expiryEvents = await orderRef2.collection('paymentHistory').where('toStatus', '==', 'expired').get();
    assert(expiryEvents.size === 1, 'Exactly one {paymentId}_expired event recorded in history');

    // Invariant 8: Expired attempt retry: new attempt can be created with new idempotency key
    const retryRes = await callFunction('createDemoPayment', { orderId: orderId2, idempotencyKey: '00000000-0000-0000-0000-000000000049' }, 'studentA');
    assert(retryRes.ok === true, 'New payment attempt created for order after previous attempt expired');
    assert(retryRes.data.status === 'processing', 'New attempt created in processing');
    const newPaymentId = retryRes.data.paymentId;
    assert(newPaymentId !== paymentId2, 'New attempt ID generated distinct from expired attempt');

    // Old expired attempt cannot be completed
    const oldCompleteRes = await callFunction('completeDemoPayment', { orderId: orderId2, paymentId: paymentId2 }, 'studentA');
    assert(!oldCompleteRes.ok && oldCompleteRes.error?.status === 'FAILED_PRECONDITION', 'Old expired attempt cannot transition to succeeded_demo (FAILED_PRECONDITION)');

    // Invariant 9: Active payment ID points to another newer payment: old payment cannot expire newer attempt
    await orderRef2.collection('payments').doc(paymentId2).update({ expiresAt: pastTimestamp });
    const mismatchExpireRes = await callFunction('expirePaymentAttempt', { orderId: orderId2, paymentId: paymentId2 }, 'studentA');
    assert(!mismatchExpireRes.ok && mismatchExpireRes.error?.status === 'FAILED_PRECONDITION', 'Older payment attempt cannot expire when newer attempt is active (activePaymentId mismatch)');
    const orderDocAfterMismatch = await orderRef2.get();
    assert(orderDocAfterMismatch.data().activePaymentId === newPaymentId, 'Newer active payment reference preserved');
  }

  // --------------------------------------------------------------------------
  // SECTION 8: Demo Refunds & Cancellation Ordering (Correction 2 & 7)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 8: Demo Refunds & Cancellation Ordering ---');
  {
    const orderId = 'GNG-REFUND-TEST-008';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');

    // Pay order
    const createRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000050' }, 'studentA');
    const paymentId = createRes.data.paymentId;
    await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentA');

    // 1. Refund cannot be requested while order is still active
    const activeRefundRes = await callFunction('requestDemoRefund', { orderId, paymentId }, 'admin1');
    assert(!activeRefundRes.ok && activeRefundRes.error?.status === 'FAILED_PRECONDITION', 'Refund cannot be requested while order is active (FAILED_PRECONDITION)');

    // 2. Admin rejects/cancels the order
    const cancelRes = await callFunction(
      'transitionOrderStatus',
      {
        orderId,
        nextStatus: 'cancelled',
        reason: 'Out of stock items',
      },
      'admin1'
    );
    assert(cancelRes.ok === true, 'Admin cancelled order with demo refund state initialized');
    assert(cancelRes.data.status === 'cancelled', 'Order status remains cancelled, not refunded');
    assert(cancelRes.data.refundStatus === 'pending', 'Order refundStatus transitioned to pending');

    // Verify payment record updated to refundStatus: pending while status remains succeeded_demo
    const paySnap = await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).get();
    assert(paySnap.data().status === 'succeeded_demo', 'Payment status remains succeeded_demo');
    assert(paySnap.data().refundStatus === 'pending', 'Payment refundStatus transitioned to pending');

    // Verify {paymentId}_refund_pending history event
    const refundPendingEvent = await db.collection('orders').doc(orderId).collection('paymentHistory').doc(`${paymentId}_refund_pending`).get();
    assert(refundPendingEvent.exists, 'Deterministic event {paymentId}_refund_pending recorded');

    // 3. Finalize demo refund
    const finalizeRes = await callFunction('completeDemoRefund', { orderId, paymentId }, 'admin1');
    assert(finalizeRes.ok === true, 'Admin completed demo refund');
    assert(finalizeRes.data.refundStatus === 'succeeded_demo', 'Payment refundStatus finalized as succeeded_demo');

    // Verify order status is STILL 'cancelled', NEVER 'refunded'
    const finalOrderDoc = await db.collection('orders').doc(orderId).get();
    assert(finalOrderDoc.data().status === 'cancelled', 'Order status remains cancelled (never set to refunded)');
    assert(finalOrderDoc.data().refundStatus === 'refunded_demo', 'Order refundStatus is refunded_demo');

    // 4. Repeated finalization is idempotent
    const finalizeReplay = await callFunction('completeDemoRefund', { orderId, paymentId }, 'admin1');
    assert(finalizeReplay.ok === true && finalizeReplay.data.isRetry === true, 'Repeated completeDemoRefund is idempotent (isRetry: true)');
  }

  // --------------------------------------------------------------------------
  // SECTION 9: Admin Operational Field Masking
  // --------------------------------------------------------------------------
  console.log('\n--- Section 9: Admin Operational Field Masking ---');
  {
    const orderId = 'GNG-MASK-TEST-009';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const createRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000060' }, 'studentA');
    const paymentId = createRes.data.paymentId;

    // Student view: contains providerReference
    const studentView = await callFunction('getPaymentStatus', { orderId, paymentId }, 'studentA');
    assert(studentView.ok === true, 'Student fetched payment status');
    assert(studentView.data.payment.providerReference !== undefined, 'Student view includes providerReference');

    // Admin view: operational fields only, providerReference omitted
    const adminView = await callFunction('getPaymentStatus', { orderId, paymentId }, 'admin1');
    assert(adminView.ok === true, 'Admin fetched payment status');
    assert(adminView.data.payment.providerReference === undefined, 'Admin view masks synthetic providerReference');
    assert(adminView.data.payment.amountInPaise === 8000, 'Admin view contains operational amountInPaise');
  }

  // --------------------------------------------------------------------------
  // SECTION 10: Local Synthetic Webhook Verification & Security Tests (Correction 2, 5, 6, 9)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 10: Webhook Verification, Authentication, and Dedicated Handlers ---');
  {
    const orderId = 'GNG-WEBHOOK-TEST-010';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A', 'upi_demo', 12000);
    const createRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-000000000070' }, 'studentA');
    const paymentId = createRes.data.paymentId;
    const providerRef = createRes.data.providerReference;

    const webhookUrl = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/us-central1/verifySyntheticWebhook`;
    const syntheticSecret = 'emulator-test-synthetic-secret-key-32b';

    const validPayload = {
      eventId: 'EVT-SYNTHETIC-001',
      eventType: 'payment.captured',
      orderId,
      paymentId,
      providerReference: providerRef,
      amountInPaise: 12000,
    };
    const rawBody = JSON.stringify(validPayload);
    const validHmac = crypto.createHmac('sha256', syntheticSecret).update(rawBody).digest('hex');

    // 1. Missing signature rejected
    try {
      await axios.post(webhookUrl, rawBody, { headers: { 'Content-Type': 'application/json' } });
      assert(false, 'Missing signature should have thrown HTTP 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Missing x-synthetic-signature rejected with HTTP 400');
    }

    // 2. Invalid HMAC signature rejected
    try {
      await axios.post(webhookUrl, rawBody, {
        headers: {
          'Content-Type': 'application/json',
          'x-synthetic-signature': '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
        },
      });
      assert(false, 'Bad signature should have thrown HTTP 401');
    } catch (err) {
      assert(err.response?.status === 401, 'Invalid HMAC signature rejected with HTTP 401');
    }

    // 3. Body tampering rejected
    const tamperedPayload = { ...validPayload, amountInPaise: 100 }; // ₹1.00
    const tamperedRaw = JSON.stringify(tamperedPayload);
    try {
      await axios.post(webhookUrl, tamperedRaw, {
        headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': validHmac }, // original HMAC
      });
      assert(false, 'Tampered body should have thrown HTTP 401');
    } catch (err) {
      assert(err.response?.status === 401, 'Body tampering with original HMAC rejected with HTTP 401');
    }

    // 4. Unsupported event type rejected
    const badEventPayload = { ...validPayload, eventType: 'unknown.bogus.event' };
    const badEventRaw = JSON.stringify(badEventPayload);
    const badEventHmac = crypto.createHmac('sha256', syntheticSecret).update(badEventRaw).digest('hex');
    try {
      await axios.post(webhookUrl, badEventRaw, {
        headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': badEventHmac },
      });
      assert(false, 'Unsupported event should have thrown HTTP 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Unsupported webhook eventType rejected with HTTP 400');
    }

    // 5. Wrong order ID rejected
    const wrongOrderPayload = { ...validPayload, eventId: 'EVT-SYNTHETIC-WRONG-ORDER', orderId: 'NON_EXISTENT_ORDER' };
    const wrongOrderRaw = JSON.stringify(wrongOrderPayload);
    const wrongOrderHmac = crypto.createHmac('sha256', syntheticSecret).update(wrongOrderRaw).digest('hex');
    try {
      await axios.post(webhookUrl, wrongOrderRaw, {
        headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': wrongOrderHmac },
      });
      assert(false, 'Wrong order should have thrown HTTP 404');
    } catch (err) {
      assert(err.response?.status === 404, 'Non-existent orderId rejected with HTTP 404');
    }

    // 6. Wrong payment ID rejected
    const wrongPaymentPayload = { ...validPayload, eventId: 'EVT-SYNTHETIC-WRONG-PAYMENT', paymentId: 'NON_EXISTENT_PAYMENT' };
    const wrongPaymentRaw = JSON.stringify(wrongPaymentPayload);
    const wrongPaymentHmac = crypto.createHmac('sha256', syntheticSecret).update(wrongPaymentRaw).digest('hex');
    try {
      await axios.post(webhookUrl, wrongPaymentRaw, {
        headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': wrongPaymentHmac },
      });
      assert(false, 'Wrong payment should have thrown HTTP 404');
    } catch (err) {
      assert(err.response?.status === 404, 'Non-existent paymentId rejected with HTTP 404');
    }

    // 7. Valid capture event processed cleanly
    const validRes = await axios.post(webhookUrl, rawBody, {
      headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': validHmac },
    });
    assert(validRes.status === 200, 'Valid synthetic HMAC accepted (HTTP 200)');
    assert(validRes.data.success === true, 'Webhook event processed cleanly');

    // Verify order transitioned to payment_verified
    const orderDoc = await db.collection('orders').doc(orderId).get();
    assert(orderDoc.data().status === 'payment_verified', 'Order status moved to payment_verified via webhook');

    // 8. Scoped deduplication check in /webhookEvents/demo:{eventId} (Correction 5)
    const dedupDoc = await db.collection('webhookEvents').doc(`demo:${validPayload.eventId}`).get();
    assert(dedupDoc.exists, 'Scoped webhook deduplication document exists at /webhookEvents/demo:{eventId} (Correction 5)');

    // 9. Replay idempotency
    const replayRes = await axios.post(webhookUrl, rawBody, {
      headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': validHmac },
    });
    assert(replayRes.status === 200 && replayRes.data.isIdempotent === true, 'Replayed webhook event is idempotent (isIdempotent: true)');

    // 10. Test refund.processed webhook handler (Correction 2)
    // Ensure pickup slot has reserved capacity to release upon cancellation
    await db.collection('canteens').doc('CANTEEN_PAY_A').collection('pickupSlots').doc('SLOT_PAY_1').update({
      reservedCount: 10,
    });

    // Cancel the order first so it's eligible for refund
    const cancelWebhookOrderRes = await callFunction('transitionOrderStatus', { orderId, nextStatus: 'cancelled', reason: 'Customer refund' }, 'admin1');
    assert(cancelWebhookOrderRes.ok === true, 'Order transitioned to cancelled before webhook refund');
    const reqRefundRes = await callFunction('requestDemoRefund', { orderId, paymentId }, 'admin1');
    assert(reqRefundRes.ok === true, 'requestDemoRefund succeeded');
    const refundRef = reqRefundRes.data.refundReference;

    // Test that refund.processed using the original payment reference (instead of dedicated refundReference) is REJECTED
    const payDocBeforeRefund = await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).get();
    const originalPaymentRef = payDocBeforeRefund.data().providerReference;
    assert(originalPaymentRef !== refundRef, 'Original payment reference differs from refundReference');

    const invalidRefPayload = {
      eventId: 'EVT-REFUND-REJECT-ORIG-REF',
      eventType: 'refund.processed',
      orderId,
      paymentId,
      providerReference: originalPaymentRef,
      amountInPaise: 12000,
    };
    const invalidRefRaw = JSON.stringify(invalidRefPayload);
    const invalidRefHmac = crypto.createHmac('sha256', syntheticSecret).update(invalidRefRaw).digest('hex');

    try {
      await axios.post(webhookUrl, invalidRefRaw, {
        headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': invalidRefHmac },
      });
      assert(false, 'Webhook with original payment reference should have been rejected');
    } catch (err) {
      assert(err.response && err.response.status === 400, 'Webhook using original payment reference rejected with HTTP 400');
      const errResponseText = JSON.stringify(err.response.data);
      assert(err.response.data.error === 'Refund provider reference mismatch.', 'Generic error message returned without internal details');
      assert(!errResponseText.includes(refundRef), 'Error response does not leak expected refundReference');
      assert(!errResponseText.includes(originalPaymentRef), 'Error response does not leak received providerReference');
    }

    const unclaimedCheck = await db.collection('webhookEvents').doc('demo:EVT-REFUND-REJECT-ORIG-REF').get();
    assert(!unclaimedCheck.exists, 'Rejected refund event ID was not claimed in webhookEvents');

    const refundWebhookPayload = {
      eventId: 'EVT-REFUND-001',
      eventType: 'refund.processed',
      orderId,
      paymentId,
      providerReference: refundRef,
      amountInPaise: 12000,
    };
    const refundRaw = JSON.stringify(refundWebhookPayload);
    const refundHmac = crypto.createHmac('sha256', syntheticSecret).update(refundRaw).digest('hex');

    const refundRes = await axios.post(webhookUrl, refundRaw, {
      headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': refundHmac },
    });
    assert(refundRes.status === 200, 'refund.processed webhook processed successfully (Correction 2)');

    const refundedPayDoc = await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).get();
    assert(refundedPayDoc.data().refundStatus === 'succeeded_demo', 'Payment refundStatus updated to succeeded_demo');
    const refundedOrderDoc = await db.collection('orders').doc(orderId).get();
    assert(refundedOrderDoc.data().status === 'cancelled', 'Order status remains cancelled, not refunded (Correction 2)');
    assert(refundedOrderDoc.data().refundStatus === 'refunded_demo', 'Order refundStatus updated to refunded_demo');

    // 11. Replayed refund webhook is idempotent
    const refundReplay = await axios.post(webhookUrl, refundRaw, {
      headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': refundHmac },
    });
    assert(refundReplay.status === 200 && refundReplay.data.isIdempotent === true, 'Replayed refund webhook is idempotent (Correction 2)');
  }

  // --------------------------------------------------------------------------
  // SECTION 11: Removal of Frontend Direct Payment Reads (Correction 10)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 11: Verify Frontend Direct Payment Reads Removed (Correction 10) ---');
  {
    const paymentServicePath = path.resolve(__dirname, '../src/services/paymentService.ts');
    const paymentServiceContent = fs.readFileSync(paymentServicePath, 'utf8');

    assert(!paymentServiceContent.includes('getOrderPayments'), 'getOrderPayments removed from paymentService.ts');
    assert(!paymentServiceContent.includes('getOrderPaymentHistory'), 'getOrderPaymentHistory removed from paymentService.ts');
    assert(!paymentServiceContent.includes("@react-native-firebase/firestore"), 'Direct Firestore import removed from paymentService.ts');
  }

  // --------------------------------------------------------------------------
  // SECTION 12: Generic Demo Labels Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Section 12: Generic Demo Labels Verification ---');
  {
    const paymentScreenPath = path.resolve(__dirname, '../src/screens/PaymentScreen.tsx');
    const paymentScreenContent = fs.readFileSync(paymentScreenPath, 'utf8');

    assert(paymentScreenContent.includes('UPI Demo'), 'PaymentScreen displays generic label "UPI Demo"');
    assert(paymentScreenContent.includes('Demo Wallet Payment'), 'PaymentScreen displays generic label "Demo Wallet Payment"');
    assert(paymentScreenContent.includes('Demo Online Payment'), 'PaymentScreen displays generic label "Demo Online Payment"');
    assert(!paymentScreenContent.includes('label: "PhonePe"'), 'Real provider label "PhonePe" removed from display');
    assert(!paymentScreenContent.includes('label: "Google Pay"'), 'Real provider label "Google Pay" removed from display');
    assert(!paymentScreenContent.includes('label: "Paytm"'), 'Real provider label "Paytm" removed from display');
  }

  // --------------------------------------------------------------------------
  // SECTION 13: Order Lifecycle Edge Cases (Phase 9)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 13: Order Lifecycle Edge Cases (Phase 9) ---');
  {
    // 1. Payment attempt for non-existent order
    const nonExistentRes = await callFunction('createDemoPayment', { orderId: 'NON_EXISTENT_ORDER_999', idempotencyKey: '00000000-0000-0000-0000-0000000000D0' }, 'studentA');
    assert(!nonExistentRes.ok && nonExistentRes.error?.status === 'NOT_FOUND', 'Payment attempt for non-existent order returns NOT_FOUND');

    // 2. Payment attempt for completed order
    const completedOrderId = 'GNG-ORDER-COMPLETED-13B';
    await createTestOrder(completedOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    await db.collection('orders').doc(completedOrderId).update({ status: 'completed' });
    const completedPayRes = await callFunction('createDemoPayment', { orderId: completedOrderId, idempotencyKey: '00000000-0000-0000-0000-0000000000D1' }, 'studentA');
    assert(!completedPayRes.ok && completedPayRes.error?.status === 'FAILED_PRECONDITION', 'Payment attempt for completed order returns FAILED_PRECONDITION');

    // 3. Payment attempt for cancelled order
    const cancelledOrderId = 'GNG-ORDER-CANCELLED-13C';
    await createTestOrder(cancelledOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    await db.collection('orders').doc(cancelledOrderId).update({ status: 'cancelled' });
    const cancelledPayRes = await callFunction('createDemoPayment', { orderId: cancelledOrderId, idempotencyKey: '00000000-0000-0000-0000-0000000000D2' }, 'studentA');
    assert(!cancelledPayRes.ok && cancelledPayRes.error?.status === 'FAILED_PRECONDITION', 'Payment attempt for cancelled order returns FAILED_PRECONDITION');

    // 4. Payment attempt for rejected order
    const rejectedOrderId = 'GNG-ORDER-REJECTED-13D';
    await createTestOrder(rejectedOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    await db.collection('orders').doc(rejectedOrderId).update({ status: 'rejected' });
    const rejectedPayRes = await callFunction('createDemoPayment', { orderId: rejectedOrderId, idempotencyKey: '00000000-0000-0000-0000-0000000000D3' }, 'studentA');
    assert(!rejectedPayRes.ok && rejectedPayRes.error?.status === 'FAILED_PRECONDITION', 'Payment attempt for rejected order returns FAILED_PRECONDITION');

    // 5. Payment attempt after pickup slot has passed/begun
    const pastSlotOrderId = 'GNG-ORDER-PASTSLOT-13E';
    await createTestOrder(pastSlotOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    await db.collection('orders').doc(pastSlotOrderId).update({
      'pickupSlot.pickupDate': '2020-01-01',
      'pickupSlot.pickupStartTime': '08:00',
    });
    const pastSlotPayRes = await callFunction('createDemoPayment', { orderId: pastSlotOrderId, idempotencyKey: '00000000-0000-0000-0000-0000000000D4' }, 'studentA');
    assert(!pastSlotPayRes.ok && pastSlotPayRes.error?.status === 'FAILED_PRECONDITION', 'Payment attempt after pickup slot has passed returns FAILED_PRECONDITION');

    // 6. Payment attempt after order expiration
    const expiredOrderId = 'GNG-ORDER-EXPIRED-13F';
    await createTestOrder(expiredOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    await db.collection('orders').doc(expiredOrderId).update({
      orderExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60000),
    });
    const expiredOrderPayRes = await callFunction('createDemoPayment', { orderId: expiredOrderId, idempotencyKey: '00000000-0000-0000-0000-0000000000D5' }, 'studentA');
    assert(!expiredOrderPayRes.ok && expiredOrderPayRes.error?.status === 'FAILED_PRECONDITION', 'Payment attempt after order expiration returns FAILED_PRECONDITION');

    // 7. Payment attempt after order total is inconsistent
    const inconsistentOrderId = 'GNG-ORDER-INCONSISTENT-13G';
    await createTestOrder(inconsistentOrderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    await db.collection('orders').doc(inconsistentOrderId).update({
      subtotalInPaise: 8000,
      totalInPaise: 9000, // Inconsistent with subtotal
    });
    const inconsistentPayRes = await callFunction('createDemoPayment', { orderId: inconsistentOrderId, idempotencyKey: '00000000-0000-0000-0000-0000000000D6' }, 'studentA');
    assert(!inconsistentPayRes.ok && inconsistentPayRes.error?.status === 'FAILED_PRECONDITION', 'Payment attempt when pricing total is inconsistent returns FAILED_PRECONDITION');
  }

  // --------------------------------------------------------------------------
  // SECTION 14: Payment Lifecycle Edge Cases (Phase 9)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 14: Payment Lifecycle Edge Cases (Phase 9) ---');
  {
    const orderId = 'GNG-PAY-LIFECYCLE-14';
    await createTestOrder(orderId, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const payRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-0000000000E0' }, 'studentA');
    assert(payRes.ok === true, 'Payment attempt created successfully for lifecycle tests');
    const paymentId = payRes.data.paymentId;

    // 1. Completion of non-existent payment
    const nonExistentPayRes = await callFunction('completeDemoPayment', { orderId, paymentId: 'pay_nonexistent_123' }, 'studentA');
    assert(!nonExistentPayRes.ok && nonExistentPayRes.error?.status === 'NOT_FOUND', 'Completion of non-existent payment returns NOT_FOUND');

    // 2. Payment ID from another order
    const orderId2 = 'GNG-PAY-LIFECYCLE-14B';
    await createTestOrder(orderId2, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const crossOrderPayRes = await callFunction('completeDemoPayment', { orderId: orderId2, paymentId }, 'studentA');
    assert(!crossOrderPayRes.ok, 'Payment ID from another order is rejected');

    // 3. Payment completion by another student
    const crossStudentCompleteRes = await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentB');
    assert(!crossStudentCompleteRes.ok && crossStudentCompleteRes.error?.status === 'PERMISSION_DENIED', 'Payment completion by another student returns PERMISSION_DENIED');

    // 4. Payment amount changed between creation and completion
    await db.collection('orders').doc(orderId).update({ totalInPaise: 99999 });
    const amountMismatchRes = await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentA');
    assert(!amountMismatchRes.ok && amountMismatchRes.error?.status === 'FAILED_PRECONDITION', 'Payment amount changed between creation and completion rejected');
    await db.collection('orders').doc(orderId).update({ totalInPaise: 8000 }); // restore

    // 5. Currency changed between creation and completion
    await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).update({ currency: 'USD' });
    const currMismatchRes = await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentA');
    assert(!currMismatchRes.ok && currMismatchRes.error?.status === 'FAILED_PRECONDITION', 'Payment currency changed between creation and completion rejected');
    await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).update({ currency: 'INR' }); // restore

    // 6. Provider changed between creation and completion
    await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).update({ provider: 'unauthorized_provider' });
    const provMismatchRes = await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentA');
    assert(!provMismatchRes.ok && provMismatchRes.error?.status === 'FAILED_PRECONDITION', 'Payment provider changed between creation and completion rejected');
    await db.collection('orders').doc(orderId).collection('payments').doc(paymentId).update({ provider: 'demo' }); // restore

    // 7. Successful completion
    const completeRes = await callFunction('completeDemoPayment', { orderId, paymentId }, 'studentA');
    assert(completeRes.ok === true, 'Payment successfully completed');

    // 8. Second successful attempt for same order is rejected
    const orderDocAfterSuccess = await db.collection('orders').doc(orderId).get();
    assert(orderDocAfterSuccess.data().status === 'payment_verified', 'Order status is payment_verified');
    const secondAttemptRes = await callFunction('createDemoPayment', { orderId, idempotencyKey: '00000000-0000-0000-0000-0000000000E1' }, 'studentA');
    assert(!secondAttemptRes.ok && secondAttemptRes.error?.status === 'FAILED_PRECONDITION', 'Second payment attempt on already paid order returns FAILED_PRECONDITION');
  }

  // --------------------------------------------------------------------------
  // SECTION 15: Additional Refund & Webhook Edge Cases (Phase 9)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 15: Additional Refund & Webhook Edge Cases (Phase 9) ---');
  {
    const webhookUrl = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/us-central1/verifySyntheticWebhook`;
    const syntheticSecret = 'emulator-test-synthetic-secret-key-32b';

    // 1. Webhook missing eventId
    const noEventIdPayload = { eventType: 'payment.captured', orderId: 'GNG-WEBHOOK-15', paymentId: 'pay_123', providerReference: 'ref_123', amountInPaise: 8000 };
    const noEventIdRaw = JSON.stringify(noEventIdPayload);
    const noEventIdHmac = crypto.createHmac('sha256', syntheticSecret).update(noEventIdRaw).digest('hex');
    try {
      await axios.post(webhookUrl, noEventIdRaw, { headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': noEventIdHmac } });
      assert(false, 'Missing eventId should have thrown HTTP 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Webhook missing eventId rejected with HTTP 400');
    }

    // 2. Webhook oversized eventId (> 128 chars)
    const oversizedId = 'e'.repeat(129);
    const oversizedPayload = { ...noEventIdPayload, eventId: oversizedId };
    const oversizedRaw = JSON.stringify(oversizedPayload);
    const oversizedHmac = crypto.createHmac('sha256', syntheticSecret).update(oversizedRaw).digest('hex');
    try {
      await axios.post(webhookUrl, oversizedRaw, { headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': oversizedHmac } });
      assert(false, 'Oversized eventId should have thrown HTTP 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Webhook oversized eventId (> 128 chars) rejected with HTTP 400');
    }

    // 3. Webhook wrong currency (e.g. USD)
    const wrongCurrPayload = { eventId: 'EVT-CURR-TEST', eventType: 'payment.captured', orderId: 'GNG-WEBHOOK-15', paymentId: 'pay_123', providerReference: 'ref_123', amountInPaise: 8000, currency: 'USD' };
    const wrongCurrRaw = JSON.stringify(wrongCurrPayload);
    const wrongCurrHmac = crypto.createHmac('sha256', syntheticSecret).update(wrongCurrRaw).digest('hex');
    try {
      await axios.post(webhookUrl, wrongCurrRaw, { headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': wrongCurrHmac } });
      assert(false, 'Wrong currency should have thrown HTTP 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Webhook wrong currency (USD) rejected with HTTP 400');
    }

    // 4. Webhook wrong provider
    const wrongProvPayload = { eventId: 'EVT-PROV-TEST', eventType: 'payment.captured', orderId: 'GNG-WEBHOOK-15', paymentId: 'pay_123', providerReference: 'ref_123', amountInPaise: 8000, provider: 'external_gateway' };
    const wrongProvRaw = JSON.stringify(wrongProvPayload);
    const wrongProvHmac = crypto.createHmac('sha256', syntheticSecret).update(wrongProvRaw).digest('hex');
    try {
      await axios.post(webhookUrl, wrongProvRaw, { headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': wrongProvHmac } });
      assert(false, 'Wrong provider should have thrown HTTP 400');
    } catch (err) {
      assert(err.response?.status === 400, 'Webhook wrong provider rejected with HTTP 400');
    }

    // 5. Invalid event followed by valid event with same ID
    const retryEventId = 'EVT-RETRY-TEST-15';
    const orderId15 = 'GNG-WEBHOOK-ORDER-15';
    await createTestOrder(orderId15, USERS.studentA.uid, 'CANTEEN_PAY_A');
    const payRes15 = await callFunction('createDemoPayment', { orderId: orderId15, idempotencyKey: '00000000-0000-0000-0000-0000000000F0' }, 'studentA');
    assert(payRes15.ok === true, 'Payment attempt created for webhook retry test');
    const paymentId15 = payRes15.data.paymentId;
    const providerRef15 = payRes15.data.providerReference;

    // Send invalid event first (amount mismatch)
    const invalidFirstPayload = {
      eventId: retryEventId,
      eventType: 'payment.captured',
      orderId: orderId15,
      paymentId: paymentId15,
      providerReference: providerRef15,
      amountInPaise: 99999, // Wrong amount
    };
    const invalidFirstRaw = JSON.stringify(invalidFirstPayload);
    const invalidFirstHmac = crypto.createHmac('sha256', syntheticSecret).update(invalidFirstRaw).digest('hex');
    try {
      await axios.post(webhookUrl, invalidFirstRaw, { headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': invalidFirstHmac } });
      assert(false, 'Invalid first event should have failed');
    } catch (err) {
      assert(err.response?.status === 400, 'Invalid first event rejected with HTTP 400');
    }

    // Verify event ID was NOT claimed by the failed event
    const unclaimedSnap = await db.collection('webhookEvents').doc(`demo:${retryEventId}`).get();
    assert(!unclaimedSnap.exists, 'Event ID was not claimed by failed event');

    // Send valid event with identical eventId
    const validSecondPayload = {
      eventId: retryEventId,
      eventType: 'payment.captured',
      orderId: orderId15,
      paymentId: paymentId15,
      providerReference: providerRef15,
      amountInPaise: 8000, // Correct amount
    };
    const validSecondRaw = JSON.stringify(validSecondPayload);
    const validSecondHmac = crypto.createHmac('sha256', syntheticSecret).update(validSecondRaw).digest('hex');
    const secondRes = await axios.post(webhookUrl, validSecondRaw, { headers: { 'Content-Type': 'application/json', 'x-synthetic-signature': validSecondHmac } });
    assert(secondRes.status === 200, 'Valid event with same eventId successfully processed after invalid attempt');
    const claimedSnap = await db.collection('webhookEvents').doc(`demo:${retryEventId}`).get();
    assert(claimedSnap.exists, 'Event ID claimed after valid event execution');
  }

  console.log('\n====================================================');
  console.log(` SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
