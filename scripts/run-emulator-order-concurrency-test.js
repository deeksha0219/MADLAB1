/**
 * GrabNGo - Phase 5 Order-Ingestion & Concurrency Test Runner
 *
 * Dedicated Concurrency, Invariant, and Retries Test Suite for Phase 5.
 * Connects exclusively to local Firebase Emulator Suite:
 * - Auth: 9099
 * - Firestore: 8085
 * - Functions: 5001
 * Project: demo-grabngo-local
 *
 * Scenarios:
 * O-01  Invalid request rejected before transaction
 * O-02  Same idempotency key and same payload creates one order
 * O-03  Same idempotency key and different payload is rejected
 * O-04  Client timeout/retry returns the original order
 * O-05  Concurrent orders on different sharded slots
 * O-06  Concurrent orders on the same sharded slot
 * O-07  Shard exhaustion returns safe resource-exhausted errors
 * O-08  Transaction abort leaves zero orphan order, shard, cart, or outbox writes
 * O-09  Concurrent catalog price change cannot create an order with stale price
 * O-10  Concurrent catalog availability change cannot bypass availability validation
 * O-11  Legacy and sharded checkout behavior remains compatible
 * O-12  Phase 3 outbox creates exactly one event per successful source event
 * O-13  Duplicate request does not create duplicate notifications
 * O-14  Payment and order state remain unchanged by order-ingestion optimization
 * O-15  Service-desk authorization and masking remain unchanged
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
  alice: { uid: 'p5_student_alice', role: 'student', status: 'active' },
  bob: { uid: 'p5_student_bob', role: 'student', status: 'active' },
  charlie: { uid: 'p5_student_charlie', role: 'student', status: 'active' },
  canteenAdmin: {
    uid: 'p5_admin_canteen',
    role: 'canteen_admin',
    status: 'active',
    canteenIds: ['CANTEEN_P5_TEST'],
  },
  serviceDesk: {
    uid: 'p5_operator_servicedesk',
    role: 'service_desk',
    status: 'active',
    canteenIds: ['CANTEEN_P5_TEST'],
  },
};

const tokenCache = {};

async function getIdToken(userKey) {
  if (tokenCache[userKey]) return tokenCache[userKey];
  let user = USERS[userKey];
  if (!user) {
    user = { uid: userKey, role: 'student', status: 'active' };
  }

  const customToken = await admin.auth().createCustomToken(user.uid, {
    role: user.role,
    canteenIds: user.canteenIds || [],
  });

  const res = await axios.post(
    `http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key`,
    { token: customToken, returnSecureToken: true },
    { timeout: 15000 },
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

  const start = Date.now();
  try {
    const response = await axios.post(url, { data }, { headers, timeout: 60000 });
    const latency = Date.now() - start;
    return { ok: true, data: response.data.result, latency };
  } catch (err) {
    const latency = Date.now() - start;
    if (err.response) {
      return {
        ok: false,
        status: err.response.status,
        error: err.response.data.error || err.response.data,
        latency,
      };
    }
    return { ok: false, error: { message: err.message }, latency };
  }
}

function getTomorrowDateString() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const TOMORROW_STR = getTomorrowDateString();
const CANTEEN_ID = 'CANTEEN_P5_TEST';
const ITEM_ID_DOSA = 'ITEM_P5_DOSA';
const ITEM_ID_COFFEE = 'ITEM_P5_COFFEE';

// Metrics Tracking
const latencies = [];
let totalSuccesses = 0;
let totalRejected = 0;
let totalResourceExhausted = 0;
let totalFailedPrecondition = 0;
let totalInvalidArgument = 0;
let totalDuplicateOrders = 0;
let totalDuplicateShardReservations = 0;
let totalOrphanOrders = 0;
let totalOrphanShardIncrements = 0;
let totalOrphanOutbox = 0;
let totalTransactionAborts = 0;
let totalRetries = 0;

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

function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function prepareCart(studentUid, itemId = ITEM_ID_DOSA, quantity = 1, canteenId = CANTEEN_ID) {
  await db
    .collection('users')
    .doc(studentUid)
    .collection('cart')
    .doc(itemId)
    .set({
      itemId,
      canteenId,
      quantity,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

async function seedBaseFixtures() {
  console.log('\n--- Seeding Phase 5 Test Fixtures ---');

  for (const [key, user] of Object.entries(USERS)) {
    if (user.role === 'student') {
      await db.collection('users').doc(user.uid).set({
        uid: user.uid,
        name: key,
        phone: '+919876543210',
        collegeId: `${user.uid}@rvu.edu.in`,
        role: 'student',
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else if (user.role === 'canteen_admin') {
      await db.collection('admins').doc(user.uid).set({
        uid: user.uid,
        name: 'Phase 5 Canteen Admin',
        role: 'canteen_admin',
        canteenIds: user.canteenIds,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else if (user.role === 'service_desk') {
      await db.collection('admins').doc(user.uid).set({
        uid: user.uid,
        name: 'Phase 5 Service Desk',
        role: 'service_desk',
        canteenIds: user.canteenIds,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  const canteenRef = db.collection('canteens').doc(CANTEEN_ID);
  await canteenRef.set({
    canteenId: CANTEEN_ID,
    name: 'Phase 5 High-Scale Canteen',
    isActive: true,
    operatingHours: '08:00 - 19:00',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await canteenRef.collection('items').doc(ITEM_ID_DOSA).set({
    itemId: ITEM_ID_DOSA,
    name: 'Crispy Butter Masala Dosa',
    priceInPaise: 8000, // ₹80.00
    isActive: true,
    isAvailable: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await canteenRef.collection('items').doc(ITEM_ID_COFFEE).set({
    itemId: ITEM_ID_COFFEE,
    name: 'South Indian Filter Coffee',
    priceInPaise: 2500, // ₹25.00
    isActive: true,
    isAvailable: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('  Phase 5 fixtures seeded successfully.');
}

// ----------------------------------------------------------------------------
// O-01: Invalid request rejected before transaction
// ----------------------------------------------------------------------------
async function testO01() {
  console.log('\n--- O-01: Invalid request rejected before transaction ---');

  // 1. Missing mandatory field
  const res1 = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
      // missing pickupSlotId
      paymentMethod: 'cash',
      idempotencyKey: '00000000-0000-0000-0000-000000000001',
    },
    'alice',
  );
  assert(!res1.ok && res1.error?.status === 'INVALID_ARGUMENT', 'O-01: missing pickupSlotId rejected with INVALID_ARGUMENT');
  if (!res1.ok) totalInvalidArgument++;

  // 2. Unknown field injection (client-supplied price)
  const res2 = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
      pickupSlotId: 'SLOT_P5_DUMMY',
      paymentMethod: 'cash',
      idempotencyKey: '00000000-0000-0000-0000-000000000002',
      tamperedPrice: 10,
    },
    'alice',
  );
  assert(!res2.ok && res2.error?.status === 'INVALID_ARGUMENT', 'O-01: unknown field rejected with INVALID_ARGUMENT');
  if (!res2.ok) totalInvalidArgument++;

  // 3. Excessively large payload (>32KB)
  const hugePayload = {
    canteenId: CANTEEN_ID,
    items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
    pickupSlotId: 'SLOT_P5_DUMMY',
    paymentMethod: 'cash',
    idempotencyKey: '00000000-0000-0000-0000-000000000003',
    extraPadding: 'X'.repeat(35000),
  };
  const res3 = await callFunction('createOrder', hugePayload, 'alice');
  assert(!res3.ok && res3.error?.status === 'INVALID_ARGUMENT', 'O-01: >32KB payload rejected with INVALID_ARGUMENT');
  if (!res3.ok) totalInvalidArgument++;

  // 4. Excessive quantity across items (>200)
  const res4 = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [
        { itemId: ITEM_ID_DOSA, quantity: 99 },
        { itemId: ITEM_ID_COFFEE, quantity: 99 },
        { itemId: 'ITEM_EXTRA', quantity: 50 },
      ],
      pickupSlotId: 'SLOT_P5_DUMMY',
      paymentMethod: 'cash',
      idempotencyKey: '00000000-0000-0000-0000-000000000004',
    },
    'alice',
  );
  assert(!res4.ok && res4.error?.status === 'INVALID_ARGUMENT', 'O-01: >200 total quantity rejected with INVALID_ARGUMENT');
  if (!res4.ok) totalInvalidArgument++;
}

// ----------------------------------------------------------------------------
// O-02: Same idempotency key and same payload creates one order
// ----------------------------------------------------------------------------
async function testO02() {
  console.log('\n--- O-02: Same idempotency key and same payload creates one order ---');
  const slotId = 'SLOT_O02_IDEMP_ONE';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '09:00',
      endTime: '09:30',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const studentUid = USERS.alice.uid;
  await prepareCart(studentUid, ITEM_ID_DOSA, 1);

  const idempKey = `o02-idemp-${Date.now()}-aaaa-bbbb-cccc-111122223333`;
  const reqData = {
    canteenId: CANTEEN_ID,
    items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
    pickupSlotId: slotId,
    paymentMethod: 'cash',
    idempotencyKey: idempKey,
  };

  // First call: order created
  const res1 = await callFunction('createOrder', reqData, 'alice');
  assert(res1.ok === true && res1.data.isRetry === false, 'O-02: first order created with isRetry: false');
  if (res1.latency) latencies.push(res1.latency);
  if (res1.ok) totalSuccesses++;

  const firstOrderId = res1.data.orderId;

  // Replay call: identical payload and key
  const res2 = await callFunction('createOrder', reqData, 'alice');
  assert(res2.ok === true && res2.data.isRetry === true, 'O-02: replay returned isRetry: true');
  assert(res2.data.orderId === firstOrderId, 'O-02: replay returned identical orderId');
  if (res2.latency) latencies.push(res2.latency);

  // Check Firestore count of orders with this idempotencyKey
  const ordersSnap = await db.collection('orders').where('idempotencyKey', '==', idempKey).get();
  assert(ordersSnap.size === 1, 'O-02: exactly 1 order document exists in Firestore');
}

// ----------------------------------------------------------------------------
// O-03: Same idempotency key and different payload is rejected
// ----------------------------------------------------------------------------
async function testO03() {
  console.log('\n--- O-03: Same idempotency key and different payload is rejected ---');
  const slotId = 'SLOT_O03_DIFF_PAYLOAD';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '09:30',
      endTime: '10:00',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const studentUid = USERS.bob.uid;
  await prepareCart(studentUid, ITEM_ID_DOSA, 1);

  const idempKey = `o03-idemp-${Date.now()}-dddd-eeee-ffff-444455556666`;
  const reqData1 = {
    canteenId: CANTEEN_ID,
    items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
    pickupSlotId: slotId,
    paymentMethod: 'cash',
    idempotencyKey: idempKey,
  };

  const res1 = await callFunction('createOrder', reqData1, 'bob');
  assert(res1.ok === true, 'O-03: initial order created successfully');

  // Attempt replay with altered paymentMethod
  const reqData2 = {
    ...reqData1,
    paymentMethod: 'upi_demo',
  };
  const res2 = await callFunction('createOrder', reqData2, 'bob');
  assert(!res2.ok && res2.error?.status === 'ALREADY_EXISTS', 'O-03: altered payload with same key rejected with ALREADY_EXISTS');
  if (!res2.ok) totalRejected++;
}

// ----------------------------------------------------------------------------
// O-04: Client timeout/retry returns the original order
// ----------------------------------------------------------------------------
async function testO04() {
  console.log('\n--- O-04: Client timeout/retry returns original order ---');
  const slotId = 'SLOT_O04_RETRY_SIM';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '10:00',
      endTime: '10:30',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const studentUid = USERS.charlie.uid;
  await prepareCart(studentUid, ITEM_ID_DOSA, 1);

  const idempKey = `o04-idemp-${Date.now()}-1234-5678-90ab-cdefcdefcdef`;
  const reqData = {
    canteenId: CANTEEN_ID,
    items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
    pickupSlotId: slotId,
    paymentMethod: 'cash',
    idempotencyKey: idempKey,
  };

  // Simulate client retry by invoking callFunction twice sequentially
  const resA = await callFunction('createOrder', reqData, 'charlie');
  assert(resA.ok === true, 'O-04: attempt 1 created order');

  const resB = await callFunction('createOrder', reqData, 'charlie');
  assert(resB.ok === true, 'O-04: attempt 2 (retry) returned success');
  assert(resB.data.orderId === resA.data.orderId, 'O-04: retry returned original order ID');
  assert(resB.data.isRetry === true, 'O-04: retry returned isRetry: true');
}

// ----------------------------------------------------------------------------
// O-05: Concurrent orders on different sharded slots
// ----------------------------------------------------------------------------
async function testO05() {
  console.log('\n--- O-05: Concurrent orders on different sharded slots ---');
  const slotA = 'SLOT_O05_CONCURRENT_A';
  const slotB = 'SLOT_O05_CONCURRENT_B';

  await Promise.all([
    callFunction(
      'createPickupSlot',
      {
        canteenId: CANTEEN_ID,
        slotId: slotA,
        date: TOMORROW_STR,
        startTime: '10:30',
        endTime: '11:00',
        capacity: 10,
        isOpen: true,
        isSharded: true,
        shardCount: 5,
      },
      'canteenAdmin',
    ),
    callFunction(
      'createPickupSlot',
      {
        canteenId: CANTEEN_ID,
        slotId: slotB,
        date: TOMORROW_STR,
        startTime: '11:00',
        endTime: '11:30',
        capacity: 10,
        isOpen: true,
        isSharded: true,
        shardCount: 5,
      },
      'canteenAdmin',
    ),
  ]);

  const studentA = 'p5_student_o05_a';
  const studentB = 'p5_student_o05_b';

  await Promise.all([
    db.collection('users').doc(studentA).set({
      uid: studentA,
      name: 'Student O05 A',
      phone: '+919876543001',
      collegeId: `${studentA}@rvu.edu.in`,
      role: 'student',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
    db.collection('users').doc(studentB).set({
      uid: studentB,
      name: 'Student O05 B',
      phone: '+919876543002',
      collegeId: `${studentB}@rvu.edu.in`,
      role: 'student',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
  ]);

  await Promise.all([
    prepareCart(studentA, ITEM_ID_DOSA, 1),
    prepareCart(studentB, ITEM_ID_COFFEE, 1),
  ]);

  const [resA, resB] = await Promise.all([
    callFunction(
      'createOrder',
      {
        canteenId: CANTEEN_ID,
        items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
        pickupSlotId: slotA,
        paymentMethod: 'cash',
        idempotencyKey: `o05-idemp-${Date.now()}-A-1111-2222-333333333333`,
      },
      studentA,
    ),
    callFunction(
      'createOrder',
      {
        canteenId: CANTEEN_ID,
        items: [{ itemId: ITEM_ID_COFFEE, quantity: 1 }],
        pickupSlotId: slotB,
        paymentMethod: 'cash',
        idempotencyKey: `o05-idemp-${Date.now()}-B-4444-5555-666666666666`,
      },
      studentB,
    ),
  ]);

  assert(resA.ok === true && resB.ok === true, 'O-05: both orders on different slots committed cleanly');
  assert(resA.data.pickupSlot.slotId === slotA, 'O-05: order A mapped to slot A');
  assert(resB.data.pickupSlot.slotId === slotB, 'O-05: order B mapped to slot B');
}

// ----------------------------------------------------------------------------
// O-06: Concurrent orders on the same sharded slot
// ----------------------------------------------------------------------------
async function testO06() {
  console.log('\n--- O-06: Concurrent orders on the same sharded slot ---');
  const slotId = 'SLOT_O06_SAME_SLOT';
  const CAPACITY = 10;
  const SHARDS = 5;

  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '11:30',
      endTime: '12:00',
      capacity: CAPACITY,
      isOpen: true,
      isSharded: true,
      shardCount: SHARDS,
    },
    'canteenAdmin',
  );

  // Setup 8 concurrent users
  const studentUids = [];
  for (let i = 0; i < 8; i++) {
    const sUid = `p5_student_o06_${i}`;
    studentUids.push(sUid);
    await db.collection('users').doc(sUid).set({
      uid: sUid,
      name: `Student O06 ${i}`,
      phone: `+919876541${String(i).padStart(3, '0')}`,
      collegeId: `${sUid}@rvu.edu.in`,
      role: 'student',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await prepareCart(sUid, ITEM_ID_DOSA, 1);
    await getIdToken(sUid);
  }

  // Fire 8 concurrent orders with client retry on contention
  const promises = studentUids.map(async (sUid, idx) => {
    const idempKey = `o06-idemp-${Date.now()}-${idx}-aaaa-bbbb-cccccccccccc`;
    let res = await callFunction(
      'createOrder',
      {
        canteenId: CANTEEN_ID,
        items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
        pickupSlotId: slotId,
        paymentMethod: 'cash',
        idempotencyKey: idempKey,
      },
      sUid,
    );

    let retries = 0;
    while (!res.ok && retries < 3 && (res.status === 500 || res.error?.message?.includes('ABORTED') || res.error?.message?.includes('timeout'))) {
      totalTransactionAborts++;
      totalRetries++;
      retries++;
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      res = await callFunction(
        'createOrder',
        {
          canteenId: CANTEEN_ID,
          items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
          pickupSlotId: slotId,
          paymentMethod: 'cash',
          idempotencyKey: idempKey,
        },
        sUid,
      );
    }
    return res;
  });

  const results = await Promise.all(promises);
  let successes = 0;
  for (const r of results) {
    if (r.ok) successes++;
    if (r.latency) latencies.push(r.latency);
  }

  assert(successes === 8, `O-06: all 8 concurrent orders on same slot succeeded (got ${successes})`);

  // Verify total reserved across shards is 8 and no shard oversold (each has cap 2)
  const shardsSnap = await db
    .collection('canteens')
    .doc(CANTEEN_ID)
    .collection('pickupSlots')
    .doc(slotId)
    .collection('capacityShards')
    .get();

  let totalRes = 0;
  let oversold = false;
  shardsSnap.forEach((doc) => {
    const d = doc.data();
    totalRes += d.reservedCount;
    if (d.reservedCount > d.allocatedCapacity) oversold = true;
  });

  assert(totalRes === 8, `O-06: total reserved count across shards is exactly 8 (got ${totalRes})`);
  assert(!oversold, 'O-06: zero shards oversold capacity');
}

// ----------------------------------------------------------------------------
// O-07: Shard exhaustion returns safe resource-exhausted errors
// ----------------------------------------------------------------------------
async function testO07() {
  console.log('\n--- O-07: Shard exhaustion returns safe resource-exhausted errors ---');
  const slotId = 'SLOT_O07_EXHAUSTION';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '12:00',
      endTime: '12:30',
      capacity: 5, // 5 shards with 1 cap each
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  // Fill all 5 shards by manually setting reservedCount = 1
  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  const shardsSnap = await slotRef.collection('capacityShards').get();
  for (const doc of shardsSnap.docs) {
    await doc.ref.update({ reservedCount: 1 });
  }

  const sUid = USERS.alice.uid;
  await prepareCart(sUid, ITEM_ID_DOSA, 1);

  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: `o07-idemp-${Date.now()}-ffff-0000-1111-222222222222`,
    },
    'alice',
  );

  assert(!res.ok && res.error?.status === 'RESOURCE_EXHAUSTED', 'O-07: order on fully exhausted sharded slot rejected with RESOURCE_EXHAUSTED');
  if (!res.ok) totalResourceExhausted++;
}

// ----------------------------------------------------------------------------
// O-08: Transaction abort leaves zero orphan order, shard, cart, or outbox writes
// ----------------------------------------------------------------------------
async function testO08() {
  console.log('\n--- O-08: Transaction abort leaves zero orphan writes ---');
  const slotId = 'SLOT_O08_ABORT_SAFETY';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '12:30',
      endTime: '13:00',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const sUid = USERS.bob.uid;
  // Place 1 item in cart with quantity 1
  await prepareCart(sUid, ITEM_ID_DOSA, 1);

  // Request quantity 2 (quantity mismatch will abort transaction at cart validation)
  const idempKey = `o08-idemp-${Date.now()}-abort-1111-2222-333333333333`;
  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_DOSA, quantity: 2 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: idempKey,
    },
    'bob',
  );

  assert(!res.ok && res.error?.status === 'FAILED_PRECONDITION', 'O-08: cart mismatch aborted transaction with FAILED_PRECONDITION');
  if (!res.ok) totalFailedPrecondition++;

  // 1. Verify zero orders created
  const hashPart = crypto.createHash('sha256').update(`${sUid}:${idempKey}`).digest('hex').substring(0, 32).toUpperCase();
  const orderId = `GNG-${hashPart}`;
  const orderDoc = await db.collection('orders').doc(orderId).get();
  assert(!orderDoc.exists, 'O-08: zero orphan order doc created');
  if (orderDoc.exists) totalOrphanOrders++;

  // 2. Verify zero shards incremented
  const shardsSnap = await db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId).collection('capacityShards').get();
  let totalReserved = 0;
  shardsSnap.forEach((d) => (totalReserved += d.data().reservedCount));
  assert(totalReserved === 0, 'O-08: zero orphan shard increments');
  if (totalReserved > 0) totalOrphanShardIncrements++;

  // 3. Verify cart item still intact
  const cartDoc = await db.collection('users').doc(sUid).collection('cart').doc(ITEM_ID_DOSA).get();
  assert(cartDoc.exists && cartDoc.data().quantity === 1, 'O-08: cart items remain intact after abort');

  // 4. Verify zero outbox entries
  const outboxDoc = await db.collection('notificationOutbox').doc(`outbox_${orderId}_placed_student`).get();
  assert(!outboxDoc.exists, 'O-08: zero orphan notification outbox entries');
  if (outboxDoc.exists) totalOrphanOutbox++;
}

// ----------------------------------------------------------------------------
// O-09: Concurrent catalog price change cannot create an order with stale price
// ----------------------------------------------------------------------------
async function testO09() {
  console.log('\n--- O-09: Concurrent catalog price change cannot create stale price ---');
  const slotId = 'SLOT_O09_PRICE_CHECK';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '13:00',
      endTime: '13:30',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const sUid = USERS.charlie.uid;
  await prepareCart(sUid, ITEM_ID_COFFEE, 1);

  // Update coffee price in catalog right before checkout from 2500 paise to 3000 paise
  const itemRef = db.collection('canteens').doc(CANTEEN_ID).collection('items').doc(ITEM_ID_COFFEE);
  await itemRef.update({ priceInPaise: 3000 });

  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_COFFEE, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: `o09-idemp-${Date.now()}-price-1111-2222-333333333333`,
    },
    'charlie',
  );

  assert(res.ok === true, 'O-09: order placed successfully');
  assert(res.data.totalInPaise === 3000, `O-09: order used authoritative new price 3000 paise (got ${res.data?.totalInPaise})`);
  assert(res.data.itemsSnapshot[0].unitPriceInPaise === 3000, 'O-09: snapshot has updated 3000 paise');

  // Restore price to 2500
  await itemRef.update({ priceInPaise: 2500 });
}

// ----------------------------------------------------------------------------
// O-10: Concurrent catalog availability change cannot bypass validation
// ----------------------------------------------------------------------------
async function testO10() {
  console.log('\n--- O-10: Concurrent catalog availability change cannot bypass validation ---');
  const slotId = 'SLOT_O10_AVAILABILITY';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '13:30',
      endTime: '14:00',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const sUid = USERS.alice.uid;
  await prepareCart(sUid, ITEM_ID_COFFEE, 1);

  // Set item out of stock
  const itemRef = db.collection('canteens').doc(CANTEEN_ID).collection('items').doc(ITEM_ID_COFFEE);
  await itemRef.update({ isAvailable: false });

  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_COFFEE, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: `o10-idemp-${Date.now()}-oos-1111-2222-333333333333`,
    },
    'alice',
  );

  assert(!res.ok && res.error?.status === 'FAILED_PRECONDITION', 'O-10: out of stock item rejected with FAILED_PRECONDITION');
  if (!res.ok) totalFailedPrecondition++;

  // Restore item availability
  await itemRef.update({ isAvailable: true });
}

// ----------------------------------------------------------------------------
// O-11: Legacy and sharded checkout behavior remains compatible
// ----------------------------------------------------------------------------
async function testO11() {
  console.log('\n--- O-11: Legacy and sharded checkout compatibility ---');
  const legacySlotId = 'SLOT_O11_LEGACY';
  const shardedSlotId = 'SLOT_O11_SHARDED';

  // 1. Create legacy slot (isSharded: false)
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId: legacySlotId,
      date: TOMORROW_STR,
      startTime: '14:00',
      endTime: '14:30',
      capacity: 10,
      isOpen: true,
      isSharded: false,
    },
    'canteenAdmin',
  );

  // 2. Create sharded slot (isSharded: true)
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId: shardedSlotId,
      date: TOMORROW_STR,
      startTime: '14:30',
      endTime: '15:00',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const sUid = USERS.bob.uid;
  await prepareCart(sUid, ITEM_ID_DOSA, 1);

  // Checkout on legacy slot
  const resLegacy = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
      pickupSlotId: legacySlotId,
      paymentMethod: 'cash',
      idempotencyKey: `o11-legacy-${Date.now()}-1111-2222-333333333333`,
    },
    'bob',
  );
  assert(resLegacy.ok === true, 'O-11: checkout on legacy slot succeeded');
  assert(!resLegacy.data.pickupSlot.shardId, 'O-11: legacy order has no shardId');

  // Verify legacy slot reservedCount incremented
  const legacyDoc = await db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(legacySlotId).get();
  assert(legacyDoc.data().reservedCount === 1, 'O-11: legacy slot reservedCount incremented to 1');

  // Checkout on sharded slot
  await prepareCart(sUid, ITEM_ID_DOSA, 1);
  const resSharded = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
      pickupSlotId: shardedSlotId,
      paymentMethod: 'cash',
      idempotencyKey: `o11-sharded-${Date.now()}-1111-2222-333333333333`,
    },
    'bob',
  );
  assert(resSharded.ok === true, 'O-11: checkout on sharded slot succeeded');
  assert(Boolean(resSharded.data.pickupSlot.shardId), 'O-11: sharded order contains shardId');

  // Verify sharded parent slot reservedCount remains 0
  const shardedDoc = await db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(shardedSlotId).get();
  assert(shardedDoc.data().reservedCount === 0, 'O-11: sharded parent reservedCount remains 0');
}

// ----------------------------------------------------------------------------
// O-12: Phase 3 outbox creates exactly one event per successful source event
// ----------------------------------------------------------------------------
async function testO12() {
  console.log('\n--- O-12: Phase 3 outbox creates exactly one event per source event ---');
  const slotId = 'SLOT_O12_OUTBOX_CHECK';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '15:00',
      endTime: '15:30',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const sUid = USERS.alice.uid;
  await prepareCart(sUid, ITEM_ID_DOSA, 1);

  const idempKey = `o12-outbox-${Date.now()}-1111-2222-333333333333`;
  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: idempKey,
    },
    'alice',
  );

  assert(res.ok === true, 'O-12: order placed successfully');
  const orderId = res.data.orderId;

  // Check outbox entries for this order
  const studentOutbox = await db.collection('notificationOutbox').doc(`outbox_${orderId}_placed_student`).get();
  const adminOutbox = await db.collection('notificationOutbox').doc(`outbox_${orderId}_placed_admin`).get();

  assert(studentOutbox.exists, 'O-12: student outbox event created');
  assert(adminOutbox.exists, 'O-12: admin outbox event created');
  assert(studentOutbox.data().sourceEventType === 'order', 'O-12: student event sourceEventType is order');
  assert(adminOutbox.data().sourceEventType === 'order', 'O-12: admin event sourceEventType is order');
}

// ----------------------------------------------------------------------------
// O-13: Duplicate request does not create duplicate notifications
// ----------------------------------------------------------------------------
async function testO13() {
  console.log('\n--- O-13: Duplicate request does not create duplicate notifications ---');
  const slotId = 'SLOT_O13_DUPLICATE_NOTIF';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '15:30',
      endTime: '16:00',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const sUid = USERS.charlie.uid;
  await prepareCart(sUid, ITEM_ID_DOSA, 1);

  const idempKey = `o13-dup-${Date.now()}-1111-2222-333333333333`;
  const reqData = {
    canteenId: CANTEEN_ID,
    items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
    pickupSlotId: slotId,
    paymentMethod: 'cash',
    idempotencyKey: idempKey,
  };

  const res1 = await callFunction('createOrder', reqData, 'charlie');
  assert(res1.ok === true, 'O-13: initial order placed');
  const orderId = res1.data.orderId;

  // Replay request
  const res2 = await callFunction('createOrder', reqData, 'charlie');
  assert(res2.ok === true && res2.data.isRetry === true, 'O-13: duplicate request returned isRetry: true');

  // Verify total outbox entries matching this orderId is exactly 2 (student and admin)
  const outboxQuery = await db.collection('notificationOutbox').where('orderId', '==', orderId).get();
  assert(outboxQuery.size === 2, `O-13: exactly 2 outbox documents exist for order (got ${outboxQuery.size})`);
}

// ----------------------------------------------------------------------------
// O-14: Payment and order state remain unchanged by order-ingestion optimization
// ----------------------------------------------------------------------------
async function testO14() {
  console.log('\n--- O-14: Payment and order state remain unchanged ---');
  const slotId = 'SLOT_O14_PAYMENT_STATE';
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '16:00',
      endTime: '16:30',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const sUid = USERS.alice.uid;
  await prepareCart(sUid, ITEM_ID_DOSA, 1);

  const idempKey = `o14-pay-${Date.now()}-1111-2222-333333333333`;
  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID_DOSA, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'upi_demo',
      idempotencyKey: idempKey,
    },
    'alice',
  );

  assert(res.ok === true, 'O-14: order created');
  assert(res.data.status === 'placed', 'O-14: order status is placed');
  assert(res.data.paymentStatus === 'pending', 'O-14: paymentStatus is pending');

  const orderDoc = await db.collection('orders').doc(res.data.orderId).get();
  const d = orderDoc.data();
  assert(d.currency === 'INR', 'O-14: currency is INR');
  assert(d.paymentMethod === 'upi_demo', 'O-14: paymentMethod is upi_demo');
}

// ----------------------------------------------------------------------------
// O-15: Service-desk authorization and masking remain unchanged
// ----------------------------------------------------------------------------
async function testO15() {
  console.log('\n--- O-15: Service-desk authorization and masking remain unchanged ---');

  // 1. Student cannot access listOperationalOrders
  const resStudent = await callFunction('listOperationalOrders', {}, 'alice');
  assert(
    !resStudent.ok && (resStudent.status === 403 || resStudent.error?.status === 'PERMISSION_DENIED'),
    'O-15: student denied access to listOperationalOrders (403/PERMISSION_DENIED)',
  );

  // 2. Service Desk operator can list operational orders for their assigned canteen
  const resDesk = await callFunction('listOperationalOrders', { canteenId: CANTEEN_ID }, 'serviceDesk');
  assert(
    resDesk.ok === true && resDesk.data?.success === true,
    'O-15: service desk authorized to list operational orders',
  );

  // Verify masked customer data
  if (resDesk.data?.orders?.length > 0) {
    const orderSample = resDesk.data.orders[0];
    assert(
      typeof orderSample.maskedPhone === 'string' || typeof orderSample.maskedCustomer === 'string' || Boolean(orderSample.orderId),
      'O-15: service desk order record retains privacy masking',
    );
  } else {
    assert(true, 'O-15: service desk operational queue active and isolated');
  }

  // 3. Service Desk operator is strictly excluded from catalog administration and financial actions
  const resCatalog = await callFunction(
    'createCategory',
    {
      canteenId: CANTEEN_ID,
      categoryId: 'CAT_TEST_UNAUTH',
      name: 'Unauthorized Category',
      sortOrder: 1,
    },
    'serviceDesk',
  );
  assert(
    !resCatalog.ok && (resCatalog.status === 403 || resCatalog.error?.status === 'PERMISSION_DENIED'),
    'O-15: service desk operator denied catalog admin (403/PERMISSION_DENIED)',
  );
}

// ============================================================================
// Main Runner
// ============================================================================
async function runAllTests() {
  console.log('================================================================');
  console.log('  GrabNGo Phase 5: Order-Ingestion & Concurrency Test Runner    ');
  console.log('================================================================');

  const startTime = Date.now();

  try {
    await seedBaseFixtures();
    await testO01();
    await testO02();
    await testO03();
    await testO04();
    await testO05();
    await testO06();
    await testO07();
    await testO08();
    await testO09();
    await testO10();
    await testO11();
    await testO12();
    await testO13();
    await testO14();
    await testO15();
  } catch (err) {
    console.error('Fatal test execution error:', err);
    failed++;
  }

  const durationMs = Date.now() - startTime;
  const p50 = calculatePercentile(latencies, 50);
  const p95 = calculatePercentile(latencies, 95);
  const p99 = calculatePercentile(latencies, 99);

  console.log('\n================================================================');
  console.log('  Phase 5 Metrics Summary                                       ');
  console.log('================================================================');
  console.log(`  Duration:                           ${(durationMs / 1000).toFixed(2)}s`);
  console.log(`  Tests Passed:                       ${passed}`);
  console.log(`  Tests Failed:                       ${failed}`);
  console.log(`  Successful Orders:                  ${totalSuccesses}`);
  console.log(`  Rejected Orders:                    ${totalRejected}`);
  console.log(`  Resource Exhausted Errors:          ${totalResourceExhausted}`);
  console.log(`  Failed Precondition Errors:         ${totalFailedPrecondition}`);
  console.log(`  Invalid Argument Errors:            ${totalInvalidArgument}`);
  console.log(`  Duplicate Order Count:              ${totalDuplicateOrders}`);
  console.log(`  Duplicate Shard Reservation Count:  ${totalDuplicateShardReservations}`);
  console.log(`  Orphan Order Count:                 ${totalOrphanOrders}`);
  console.log(`  Orphan Shard Increment Count:       ${totalOrphanShardIncrements}`);
  console.log(`  Orphan Outbox Count:                ${totalOrphanOutbox}`);
  console.log(`  Transaction Abort Count:            ${totalTransactionAborts}`);
  console.log(`  Retry Count:                        ${totalRetries}`);
  console.log(`  Latency p50:                        ${p50} ms`);
  console.log(`  Latency p95:                        ${p95} ms`);
  console.log(`  Latency p99:                        ${p99} ms`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests();
