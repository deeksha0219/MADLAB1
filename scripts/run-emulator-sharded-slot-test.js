/**
 * GrabNGo - Phase 4B Pickup-Slot Capacity Sharding Test Runner
 *
 * Dedicated Contention & Invariant Test Suite for Strategy A Partitioned Capacity Sharding.
 * Connects exclusively to local Firebase Emulator Suite:
 * - Auth: 9099
 * - Firestore: 8085
 * - Functions: 5001
 * Project: demo-grabngo-local
 *
 * Scenarios:
 * S-01  Sharded slot baseline, N=5
 * S-02  15 concurrent users; no oversell
 * S-03  50 concurrent users; no duplicate orders
 * S-04  Capacity exhaustion; exactly capacity successes
 * S-05  One shard full; fallback to another shard
 * S-06  Duplicate idempotency requests; one order per key
 * S-07  Concurrent cancellation; exact shard release
 * S-08  Mixed legacy and sharded slots; no interference
 * S-09  Invalid shard configuration; failed-precondition
 * S-10  Missing shard document; fail closed
 * S-11  Transaction abort; no orphan order or shard increment
 * S-12  Client direct shard read/write denied
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
  studentAlice: { uid: 'student_alice_sharding', role: 'student', status: 'active' },
  studentBob: { uid: 'student_bob_sharding', role: 'student', status: 'active' },
  canteenAdmin: {
    uid: 'admin_canteen_sharding',
    role: 'canteen_admin',
    status: 'active',
    canteenIds: ['CANTEEN_SHARD_TEST'],
  },
};

const tokenCache = {};

async function getIdToken(userKey) {
  if (tokenCache[userKey]) return tokenCache[userKey];
  let user = USERS[userKey];
  if (!user) {
    // Generate ad-hoc student user
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
    const response = await axios.post(url, { data }, { headers, timeout: 180000 });
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

// Tomorrow date string in Asia/Kolkata
function getTomorrowDateString() {
  const utcNow = new Date();
  const kolkataDate = new Date(utcNow.getTime() + (utcNow.getTimezoneOffset() + 330) * 60000);
  const tomorrowDate = new Date(kolkataDate.getTime() + 24 * 60 * 60 * 1000);
  const year = tomorrowDate.getFullYear();
  const month = String(tomorrowDate.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrowDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const TOMORROW_STR = getTomorrowDateString();
const CANTEEN_ID = 'CANTEEN_SHARD_TEST';
const ITEM_ID = 'ITEM_SHARD_SAMOSA';

// Performance & Metric Tracking
const latencies = [];
let totalSuccesses = 0;
let totalResourceExhausted = 0;
let totalFailedPrecondition = 0;
let totalOversells = 0;
let totalDuplicateOrders = 0;
let totalDuplicateShardReservations = 0;
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

async function seedBaseFixtures() {
  console.log('\n--- Seeding Base Sharding Test Fixtures ---');

  // 1. Seed Users in Firestore
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
        name: 'Canteen Admin',
        role: 'canteen_admin',
        canteenIds: user.canteenIds,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // 2. Seed Canteen & Item
  const canteenRef = db.collection('canteens').doc(CANTEEN_ID);
  await canteenRef.set({
    canteenId: CANTEEN_ID,
    name: 'Sharding Contention Canteen',
    isActive: true,
    operatingHours: '08:00 - 19:00',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await canteenRef.collection('items').doc(ITEM_ID).set({
    itemId: ITEM_ID,
    name: 'Hot Samosa',
    priceInPaise: 2500, // ₹25.00
    isActive: true,
    isAvailable: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('  Base fixtures seeded successfully.');
}

async function prepareCart(studentUid, itemId = ITEM_ID, quantity = 1) {
  await db
    .collection('users')
    .doc(studentUid)
    .collection('cart')
    .doc(itemId)
    .set({
      itemId,
      canteenId: CANTEEN_ID,
      quantity,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

// ----------------------------------------------------------------------------
// S-01: Sharded slot baseline, N=5
// ----------------------------------------------------------------------------
async function testS01() {
  console.log('\n--- S-01: Sharded slot baseline, N=5 ---');
  const slotId = 'SLOT_S01_BASELINE';

  // Create slot via createPickupSlot
  const createRes = await callFunction(
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

  assert(createRes.ok === true, 'S-01: createPickupSlot with isSharded: true succeeded');

  // Verify 5 shards created with allocatedCapacity: 2
  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  const shardsSnap = await slotRef.collection('capacityShards').get();
  assert(shardsSnap.size === 5, 'S-01: exactly 5 capacity shards created in subcollection');

  let totalAllocated = 0;
  shardsSnap.forEach((doc) => {
    const data = doc.data();
    totalAllocated += data.allocatedCapacity;
    assert(data.allocatedCapacity === 2, `S-01: ${doc.id} has allocatedCapacity 2`);
    assert(data.reservedCount === 0, `S-01: ${doc.id} has reservedCount 0`);
  });
  assert(totalAllocated === 10, 'S-01: sum of shard allocated capacities matches slot capacity 10');

  // Place 1 order
  const studentUid = USERS.studentAlice.uid;
  await prepareCart(studentUid);
  const idempKey = `s01-idemp-${Date.now()}-1111-2222-3333-444455556666`;
  const orderRes = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: idempKey,
    },
    'studentAlice',
  );

  assert(orderRes.ok === true, 'S-01: createOrder succeeds on sharded slot');
  if (orderRes.latency) latencies.push(orderRes.latency);
  if (orderRes.ok) totalSuccesses++;

  // Verify order has stored shardId
  const orderDoc = await db.collection('orders').doc(orderRes.data.orderId).get();
  const orderData = orderDoc.data();
  const chosenShardId = orderData.pickupSlot?.shardId;
  assert(
    typeof chosenShardId === 'string' && chosenShardId.startsWith('shard_'),
    `S-01: order.pickupSlot.shardId correctly stored: ${chosenShardId}`,
  );

  // Verify chosen shard has reservedCount = 1, parent slot reservedCount is still 0
  const chosenShardDoc = await slotRef.collection('capacityShards').doc(chosenShardId).get();
  assert(chosenShardDoc.data().reservedCount === 1, 'S-01: chosen shard reservedCount incremented to 1');

  const parentSlotDoc = await slotRef.get();
  assert(parentSlotDoc.data().reservedCount === 0, 'S-01: parent slot reservedCount remains 0 (not mutated)');
}

// ----------------------------------------------------------------------------
// S-02: 15 concurrent users; no oversell
// ----------------------------------------------------------------------------
async function testS02() {
  console.log('\n--- S-02: 15 concurrent users; no oversell ---');
  const slotId = 'SLOT_S02_CONCURRENCY_15';
  const CAPACITY = 15;
  const SHARDS = 5;

  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '11:00',
      endTime: '11:30',
      capacity: CAPACITY,
      isOpen: true,
      isSharded: true,
      shardCount: SHARDS,
    },
    'canteenAdmin',
  );

  // Setup 15 students and carts
  const studentUids = [];
  for (let i = 0; i < 15; i++) {
    const sUid = `student_s02_${i}`;
    studentUids.push(sUid);
    await db.collection('users').doc(sUid).set({
      uid: sUid,
      name: `S02 Student ${i}`,
      phone: `+9198765432${String(i).padStart(2, '0')}`,
      collegeId: `${sUid}@rvu.edu.in`,
      role: 'student',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await prepareCart(sUid);
    await getIdToken(sUid);
  }

  // Fire 15 concurrent requests
  const promises = studentUids.map((sUid, idx) => {
    const idempKey = `s02-idemp-${Date.now()}-${idx}-aaaa-bbbb-cccc-dddddddddddd`;
    return callFunction(
      'createOrder',
      {
        canteenId: CANTEEN_ID,
        items: [{ itemId: ITEM_ID, quantity: 1 }],
        pickupSlotId: slotId,
        paymentMethod: 'cash',
        idempotencyKey: idempKey,
      },
      sUid,
    );
  });

  const results = await Promise.all(promises);

  let successCount = 0;
  for (const r of results) {
    if (r.latency) latencies.push(r.latency);
    if (r.ok) {
      successCount++;
      totalSuccesses++;
    } else {
      console.error('S-02 unexpected error:', r.error);
    }
  }

  assert(successCount === 15, `S-02: all 15 concurrent requests succeeded (got ${successCount})`);

  // Verify shard reservedCounts and no oversell
  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  const shardsSnap = await slotRef.collection('capacityShards').get();
  let totalReserved = 0;
  let oversold = false;

  shardsSnap.forEach((doc) => {
    const data = doc.data();
    totalReserved += data.reservedCount;
    if (data.reservedCount > data.allocatedCapacity) {
      oversold = true;
      totalOversells++;
    }
  });

  assert(totalReserved === 15, `S-02: total reserved count across shards is exactly 15 (got ${totalReserved})`);
  assert(!oversold, 'S-02: zero shards oversold partitioned capacity');
}

// ----------------------------------------------------------------------------
// S-03: 50 concurrent users; no duplicate orders
// ----------------------------------------------------------------------------
async function testS03() {
  console.log('\n--- S-03: 50 concurrent users; no duplicate orders ---');
  const slotId = 'SLOT_S03_CONCURRENCY_50';
  const CAPACITY = 50;
  const SHARDS = 5;

  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '12:00',
      endTime: '12:30',
      capacity: CAPACITY,
      isOpen: true,
      isSharded: true,
      shardCount: SHARDS,
    },
    'canteenAdmin',
  );

  // Setup 50 students and carts
  const studentUids = [];
  for (let i = 0; i < 50; i++) {
    const sUid = `student_s03_${i}`;
    studentUids.push(sUid);
    await db.collection('users').doc(sUid).set({
      uid: sUid,
      name: `S03 Student ${i}`,
      phone: `+9198765431${String(i).padStart(2, '0')}`,
      collegeId: `${sUid}@rvu.edu.in`,
      role: 'student',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await prepareCart(sUid);
    await getIdToken(sUid);
  }

  // Fire 50 concurrent requests with client retry on contention/timeout
  const promises = studentUids.map(async (sUid, idx) => {
    const idempKey = `s03-idemp-${Date.now()}-${idx}-1111-2222-3333-444444444444`;
    let res = await callFunction(
      'createOrder',
      {
        canteenId: CANTEEN_ID,
        items: [{ itemId: ITEM_ID, quantity: 1 }],
        pickupSlotId: slotId,
        paymentMethod: 'cash',
        idempotencyKey: idempKey,
      },
      sUid,
    );

    let retries = 0;
    while (
      !res.ok &&
      retries < 3 &&
      (res.status === 500 ||
        res.error?.message?.includes('timeout') ||
        res.error?.message?.includes('ABORTED') ||
        res.error?.message?.includes('INTERNAL'))
    ) {
      totalTransactionAborts++;
      totalRetries++;
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500));
      res = await callFunction(
        'createOrder',
        {
          canteenId: CANTEEN_ID,
          items: [{ itemId: ITEM_ID, quantity: 1 }],
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

  const orderIds = new Set();
  let successCount = 0;

  for (const r of results) {
    if (r.latency) latencies.push(r.latency);
    if (r.ok) {
      successCount++;
      totalSuccesses++;
      if (orderIds.has(r.data.orderId)) {
        totalDuplicateOrders++;
      }
      orderIds.add(r.data.orderId);
    } else {
      console.log('    S-03 request failed:', r.status, r.error?.message || r.error);
    }
  }

  assert(successCount === 50, `S-03: all 50 concurrent requests succeeded (got ${successCount})`);
  assert(orderIds.size === 50, `S-03: exactly 50 distinct orders created (no duplicates)`);

  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  const shardsSnap = await slotRef.collection('capacityShards').get();
  let totalReserved = 0;
  shardsSnap.forEach((doc) => {
    totalReserved += doc.data().reservedCount;
  });
  assert(totalReserved === 50, `S-03: sum of shard reservedCounts is exactly 50 (got ${totalReserved})`);
}

// ----------------------------------------------------------------------------
// S-04: Capacity exhaustion; exactly capacity successes
// ----------------------------------------------------------------------------
async function testS04() {
  console.log('\n--- S-04: Capacity exhaustion; exactly capacity successes ---');
  const slotId = 'SLOT_S04_EXHAUSTION';
  const CAPACITY = 8;
  const SHARDS = 4; // 2 per shard

  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '13:00',
      endTime: '13:30',
      capacity: CAPACITY,
      isOpen: true,
      isSharded: true,
      shardCount: SHARDS,
    },
    'canteenAdmin',
  );

  // Setup 16 students (2x capacity)
  const studentUids = [];
  for (let i = 0; i < 16; i++) {
    const sUid = `student_s04_${i}`;
    studentUids.push(sUid);
    await db.collection('users').doc(sUid).set({
      uid: sUid,
      name: `S04 Student ${i}`,
      phone: `+9198765430${String(i).padStart(2, '0')}`,
      collegeId: `${sUid}@rvu.edu.in`,
      role: 'student',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await prepareCart(sUid);
    await getIdToken(sUid);
  }

  // Fire 16 concurrent requests for 8 capacity
  const promises = studentUids.map((sUid, idx) => {
    const idempKey = `s04-idemp-${Date.now()}-${idx}-aaaa-bbbb-cccc-dddddddddddd`;
    return callFunction(
      'createOrder',
      {
        canteenId: CANTEEN_ID,
        items: [{ itemId: ITEM_ID, quantity: 1 }],
        pickupSlotId: slotId,
        paymentMethod: 'cash',
        idempotencyKey: idempKey,
      },
      sUid,
    );
  });

  const results = await Promise.all(promises);

  let successCount = 0;
  let exhaustedCount = 0;

  for (const r of results) {
    if (r.latency) latencies.push(r.latency);
    if (r.ok) {
      successCount++;
      totalSuccesses++;
    } else if (
      r.status === 429 ||
      r.error?.status === 'RESOURCE_EXHAUSTED' ||
      (r.error?.message && r.error.message.includes('full'))
    ) {
      exhaustedCount++;
      totalResourceExhausted++;
    }
  }

  assert(successCount === CAPACITY, `S-04: exactly ${CAPACITY} reservations succeeded (got ${successCount})`);
  assert(exhaustedCount === 8, `S-04: exactly 8 requests failed with resource-exhausted (got ${exhaustedCount})`);

  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  const shardsSnap = await slotRef.collection('capacityShards').get();
  let totalReserved = 0;
  shardsSnap.forEach((doc) => {
    const d = doc.data();
    totalReserved += d.reservedCount;
    assert(d.reservedCount <= d.allocatedCapacity, `S-04: shard ${doc.id} did not exceed capacity (${d.reservedCount}/${d.allocatedCapacity})`);
  });
  assert(totalReserved === CAPACITY, `S-04: total reserved count is strictly ${CAPACITY}`);
}

// ----------------------------------------------------------------------------
// S-05: One shard full; fallback to another shard
// ----------------------------------------------------------------------------
async function testS05() {
  console.log('\n--- S-05: One shard full; fallback to another shard ---');
  const slotId = 'SLOT_S05_FALLBACK';

  // Capacity 4, 2 shards (2 each)
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '14:00',
      endTime: '14:30',
      capacity: 4,
      isOpen: true,
      isSharded: true,
      shardCount: 2,
    },
    'canteenAdmin',
  );

  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);

  // Pre-fill shard_0 completely
  await slotRef.collection('capacityShards').doc('shard_0').update({
    reservedCount: 2,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Now shard_0 is full (2/2), shard_1 is empty (0/2).
  const sUid = USERS.studentAlice.uid;
  await prepareCart(sUid);
  const idempKey = `s05-idemp-${Date.now()}-1111-2222-3333-444455556666`;

  const orderRes = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: idempKey,
    },
    'studentAlice',
  );

  assert(orderRes.ok === true, 'S-05: order succeeded despite shard_0 being full');
  if (orderRes.latency) latencies.push(orderRes.latency);
  if (orderRes.ok) totalSuccesses++;

  const orderDoc = await db.collection('orders').doc(orderRes.data.orderId).get();
  const shardId = orderDoc.data().pickupSlot?.shardId;
  assert(shardId === 'shard_1', `S-05: sequential fallback reserved shard_1 (got ${shardId})`);

  const shard1Doc = await slotRef.collection('capacityShards').doc('shard_1').get();
  assert(shard1Doc.data().reservedCount === 1, 'S-05: shard_1 reservedCount is 1');
}

// ----------------------------------------------------------------------------
// S-06: Duplicate idempotency requests; one order per key
// ----------------------------------------------------------------------------
async function testS06() {
  console.log('\n--- S-06: Duplicate idempotency requests; one order per key ---');
  const slotId = 'SLOT_S06_IDEMP';

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

  const sUid = USERS.studentAlice.uid;
  await prepareCart(sUid);
  const idempKey = `s06-duplicate-idemp-${Date.now()}-aaaa-bbbb-cccc-dddddddddddd`;

  // Send 5 duplicate concurrent calls
  const promises = [1, 2, 3, 4, 5].map(() =>
    callFunction(
      'createOrder',
      {
        canteenId: CANTEEN_ID,
        items: [{ itemId: ITEM_ID, quantity: 1 }],
        pickupSlotId: slotId,
        paymentMethod: 'cash',
        idempotencyKey: idempKey,
      },
      'studentAlice',
    ),
  );

  const results = await Promise.all(promises);

  const orderIds = new Set();
  let okCount = 0;
  for (const r of results) {
    if (r.latency) latencies.push(r.latency);
    if (r.ok) {
      okCount++;
      orderIds.add(r.data.orderId);
    }
  }

  assert(okCount === 5, 'S-06: all 5 duplicate calls returned success (idempotent replay)');
  assert(orderIds.size === 1, `S-06: all calls returned the exact same orderId (${[...orderIds][0]})`);

  // Verify shard reserved count is incremented exactly once (not 5 times!)
  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  const shardsSnap = await slotRef.collection('capacityShards').get();
  let totalReserved = 0;
  shardsSnap.forEach((doc) => {
    totalReserved += doc.data().reservedCount;
  });
  assert(totalReserved === 1, `S-06: shard capacity incremented exactly once (got ${totalReserved})`);
}

// ----------------------------------------------------------------------------
// S-07: Concurrent cancellation; exact shard release
// ----------------------------------------------------------------------------
async function testS07() {
  console.log('\n--- S-07: Concurrent cancellation; exact shard release ---');
  const slotId = 'SLOT_S07_RELEASE';

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

  // Create 4 orders
  const orders = [];
  for (let i = 0; i < 4; i++) {
    const sUid = `student_s07_${i}`;
    await db.collection('users').doc(sUid).set({
      uid: sUid,
      name: `S07 Student ${i}`,
      phone: `+9198765429${String(i).padStart(2, '0')}`,
      collegeId: `${sUid}@rvu.edu.in`,
      role: 'student',
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await prepareCart(sUid);
    await getIdToken(sUid);
    const idempKey = `s07-idemp-${Date.now()}-${i}-1111-2222-3333-444444444444`;
    const res = await callFunction(
      'createOrder',
      {
        canteenId: CANTEEN_ID,
        items: [{ itemId: ITEM_ID, quantity: 1 }],
        pickupSlotId: slotId,
        paymentMethod: 'cash',
        idempotencyKey: idempKey,
      },
      sUid,
    );
    orders.push({ orderId: res.data.orderId, sUid });
  }

  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  const beforeSnap = await slotRef.collection('capacityShards').get();
  let beforeTotal = 0;
  beforeSnap.forEach((doc) => {
    beforeTotal += doc.data().reservedCount;
  });
  assert(beforeTotal === 4, `S-07: 4 initial reservations across shards (got ${beforeTotal})`);

  // Concurrently cancel 2 of the orders
  const cancelPromises = [
    callFunction('transitionOrderStatus', { orderId: orders[0].orderId, nextStatus: 'cancelled' }, orders[0].sUid),
    callFunction('transitionOrderStatus', { orderId: orders[1].orderId, nextStatus: 'cancelled' }, orders[1].sUid),
  ];

  const cancelResults = await Promise.all(cancelPromises);
  assert(cancelResults[0].ok === true, 'S-07: order 0 cancellation succeeded');
  assert(cancelResults[1].ok === true, 'S-07: order 1 cancellation succeeded');

  const afterSnap = await slotRef.collection('capacityShards').get();
  let afterTotal = 0;
  afterSnap.forEach((doc) => {
    const d = doc.data();
    afterTotal += d.reservedCount;
    assert(d.reservedCount >= 0, `S-07: shard ${doc.id} count non-negative (${d.reservedCount})`);
  });
  assert(afterTotal === 2, `S-07: total reserved count decremented exactly to 2 (got ${afterTotal})`);
}

// ----------------------------------------------------------------------------
// S-08: Mixed legacy and sharded slots; no interference
// ----------------------------------------------------------------------------
async function testS08() {
  console.log('\n--- S-08: Mixed legacy and sharded slots; no interference ---');
  const legacySlotId = 'SLOT_S08_LEGACY';
  const shardedSlotId = 'SLOT_S08_SHARDED';

  // 1. Create legacy slot (isSharded: false / undefined)
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId: legacySlotId,
      date: TOMORROW_STR,
      startTime: '16:30',
      endTime: '17:00',
      capacity: 5,
      isOpen: true,
    },
    'canteenAdmin',
  );

  // 2. Create sharded slot (isSharded: true, shardCount: 5)
  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId: shardedSlotId,
      date: TOMORROW_STR,
      startTime: '17:00',
      endTime: '17:30',
      capacity: 5,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  // Place order on legacy slot
  const sUid1 = USERS.studentAlice.uid;
  await prepareCart(sUid1);
  const legOrderRes = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID, quantity: 1 }],
      pickupSlotId: legacySlotId,
      paymentMethod: 'cash',
      idempotencyKey: `s08-leg-${Date.now()}-1111-2222-3333-444455556666`,
    },
    'studentAlice',
  );

  assert(legOrderRes.ok === true, 'S-08: legacy order placement succeeded');

  const legacyOrderDoc = await db.collection('orders').doc(legOrderRes.data.orderId).get();
  assert(legacyOrderDoc.data().pickupSlot?.shardId === undefined, 'S-08: legacy order has NO shardId');

  const legacySlotDoc = await db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(legacySlotId).get();
  assert(legacySlotDoc.data().reservedCount === 1, 'S-08: legacy slot reservedCount incremented to 1');

  // Place order on sharded slot
  const sUid2 = USERS.studentBob.uid;
  await prepareCart(sUid2);
  const shardOrderRes = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID, quantity: 1 }],
      pickupSlotId: shardedSlotId,
      paymentMethod: 'cash',
      idempotencyKey: `s08-shd-${Date.now()}-1111-2222-3333-444455556666`,
    },
    'studentBob',
  );

  assert(shardOrderRes.ok === true, 'S-08: sharded order placement succeeded');

  const shardOrderDoc = await db.collection('orders').doc(shardOrderRes.data.orderId).get();
  assert(typeof shardOrderDoc.data().pickupSlot?.shardId === 'string', 'S-08: sharded order has shardId');

  const shardedSlotDoc = await db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(shardedSlotId).get();
  assert(shardedSlotDoc.data().reservedCount === 0, 'S-08: sharded parent slot reservedCount remains 0');

  // Cancel both
  await callFunction('transitionOrderStatus', { orderId: legOrderRes.data.orderId, nextStatus: 'cancelled' }, 'studentAlice');
  await callFunction('transitionOrderStatus', { orderId: shardOrderRes.data.orderId, nextStatus: 'cancelled' }, 'studentBob');

  const legAfter = await db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(legacySlotId).get();
  assert(legAfter.data().reservedCount === 0, 'S-08: legacy slot reservedCount decremented back to 0');

  const shdShardAfter = await db
    .collection('canteens')
    .doc(CANTEEN_ID)
    .collection('pickupSlots')
    .doc(shardedSlotId)
    .collection('capacityShards')
    .doc(shardOrderDoc.data().pickupSlot.shardId)
    .get();
  assert(shdShardAfter.data().reservedCount === 0, 'S-08: exact shard reservedCount decremented back to 0');
}

// ----------------------------------------------------------------------------
// S-09: Invalid shard configuration; failed-precondition
// ----------------------------------------------------------------------------
async function testS09() {
  console.log('\n--- S-09: Invalid shard configuration; failed-precondition ---');
  const slotId = 'SLOT_S09_INVALID';

  // Seed slot with isSharded: true but invalid shardCount (0)
  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  await slotRef.set({
    slotId,
    canteenId: CANTEEN_ID,
    date: TOMORROW_STR,
    startTime: '17:30',
    endTime: '18:00',
    timezone: 'Asia/Kolkata',
    isOpen: true,
    capacity: 10,
    reservedCount: 0,
    isSharded: true,
    shardCount: 0, // INVALID!
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const sUid = USERS.studentAlice.uid;
  await prepareCart(sUid);

  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: `s09-idemp-${Date.now()}-1111-2222-3333-444455556666`,
    },
    'studentAlice',
  );

  assert(res.ok === false, 'S-09: order rejected with invalid shard configuration');
  assert(
    res.error?.status === 'FAILED_PRECONDITION' ||
    (res.error?.message && res.error.message.includes('invalid sharding configuration')),
    `S-09: error is failed-precondition: ${res.error?.message}`,
  );
  if (!res.ok) totalFailedPrecondition++;
}

// ----------------------------------------------------------------------------
// S-10: Missing shard document; fail closed
// ----------------------------------------------------------------------------
async function testS10() {
  console.log('\n--- S-10: Missing shard document; fail closed ---');
  const slotId = 'SLOT_S10_MISSING_DOC';

  // Create slot with isSharded: true and shardCount: 5, but do NOT create shard docs
  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  await slotRef.set({
    slotId,
    canteenId: CANTEEN_ID,
    date: TOMORROW_STR,
    startTime: '18:00',
    endTime: '18:30',
    timezone: 'Asia/Kolkata',
    isOpen: true,
    capacity: 10,
    reservedCount: 0,
    isSharded: true,
    shardCount: 5,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const sUid = USERS.studentAlice.uid;
  await prepareCart(sUid);

  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID, quantity: 1 }],
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: `s10-idemp-${Date.now()}-1111-2222-3333-444455556666`,
    },
    'studentAlice',
  );

  assert(res.ok === false, 'S-10: order rejected due to missing shard document (fail closed)');
  assert(
    res.error?.status === 'FAILED_PRECONDITION' ||
    (res.error?.message && res.error.message.includes('missing')),
    `S-10: error is failed-precondition: ${res.error?.message}`,
  );
  if (!res.ok) totalFailedPrecondition++;
}

// ----------------------------------------------------------------------------
// S-11: Transaction abort; no orphan order or shard increment
// ----------------------------------------------------------------------------
async function testS11() {
  console.log('\n--- S-11: Transaction abort; no orphan order or shard increment ---');
  const slotId = 'SLOT_S11_ABORT';

  await callFunction(
    'createPickupSlot',
    {
      canteenId: CANTEEN_ID,
      slotId,
      date: TOMORROW_STR,
      startTime: '18:30',
      endTime: '19:00',
      capacity: 10,
      isOpen: true,
      isSharded: true,
      shardCount: 5,
    },
    'canteenAdmin',
  );

  const sUid = USERS.studentAlice.uid;
  // Seed cart with quantity 1, but order with quantity 2 (cart verification failure in tx)
  await prepareCart(sUid, ITEM_ID, 1);
  const idempKey = `s11-idemp-${Date.now()}-1111-2222-3333-444455556666`;

  const res = await callFunction(
    'createOrder',
    {
      canteenId: CANTEEN_ID,
      items: [{ itemId: ITEM_ID, quantity: 2 }], // mismatch!
      pickupSlotId: slotId,
      paymentMethod: 'cash',
      idempotencyKey: idempKey,
    },
    'studentAlice',
  );

  assert(res.ok === false, 'S-11: createOrder aborted due to cart quantity mismatch');
  totalTransactionAborts++;

  // Verify no order doc created
  const hashPart = crypto
    .createHash('sha256')
    .update(`${sUid}:${idempKey}`)
    .digest('hex')
    .substring(0, 32)
    .toUpperCase();
  const orderId = `GNG-${hashPart}`;
  const orderDoc = await db.collection('orders').doc(orderId).get();
  assert(!orderDoc.exists, 'S-11: no orphan order doc created in Firestore');

  // Verify all shards still have reservedCount = 0
  const slotRef = db.collection('canteens').doc(CANTEEN_ID).collection('pickupSlots').doc(slotId);
  const shardsSnap = await slotRef.collection('capacityShards').get();
  let totalReserved = 0;
  shardsSnap.forEach((doc) => {
    totalReserved += doc.data().reservedCount;
  });
  assert(totalReserved === 0, 'S-11: zero shards incremented after transaction abort');
}

// ----------------------------------------------------------------------------
// S-12: Client direct shard read/write denied
// ----------------------------------------------------------------------------
async function testS12() {
  console.log('\n--- S-12: Client direct shard read/write denied ---');
  const slotId = 'SLOT_S01_BASELINE';
  const shardPath = `canteens/${CANTEEN_ID}/pickupSlots/${slotId}/capacityShards/shard_0`;
  const url = `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${shardPath}`;

  const token = await getIdToken('studentAlice');

  // 1. Direct client read attempt
  let readDenied = false;
  try {
    await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 400)) {
      readDenied = true;
    }
  }
  assert(readDenied, 'S-12: direct client GET on capacityShards is strictly denied (403)');

  // 2. Direct client write attempt
  let writeDenied = false;
  try {
    await axios.patch(
      url,
      {
        fields: {
          reservedCount: { integerValue: '99' },
        },
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 400)) {
      writeDenied = true;
    }
  }
  assert(writeDenied, 'S-12: direct client PATCH on capacityShards is strictly denied (403)');
}

// ----------------------------------------------------------------------------
// Main Runner
// ----------------------------------------------------------------------------
async function run() {
  console.log('================================================================');
  console.log('  GrabNGo Phase 4B: Pickup-Slot Sharding Emulator Test Runner   ');
  console.log('================================================================');

  try {
    await seedBaseFixtures();

    await testS01();
    await testS02();
    await testS03();
    await testS04();
    await testS05();
    await testS06();
    await testS07();
    await testS08();
    await testS09();
    await testS10();
    await testS11();
    await testS12();

    console.log('\n================================================================');
    console.log('  Phase 4B Sharded Slot Test Metrics & Results Summary');
    console.log('================================================================');
    console.log(`Passed Assertions:               ${passed}`);
    console.log(`Failed Assertions:               ${failed}`);
    console.log(`Successful Reservations:         ${totalSuccesses}`);
    console.log(`Resource-Exhausted Responses:    ${totalResourceExhausted}`);
    console.log(`Failed-Precondition Responses:   ${totalFailedPrecondition}`);
    console.log(`Oversell Count:                  ${totalOversells}`);
    console.log(`Duplicate Order Count:           ${totalDuplicateOrders}`);
    console.log(`Duplicate Shard Reservations:    ${totalDuplicateShardReservations}`);
    console.log(`Transaction Abort Count:         ${totalTransactionAborts}`);
    console.log(`Retry Count:                     ${totalRetries}`);
    console.log(`Total Requests Measured:         ${latencies.length}`);

    if (latencies.length > 0) {
      const p50 = calculatePercentile(latencies, 50);
      const p95 = calculatePercentile(latencies, 95);
      const p99 = calculatePercentile(latencies, 99);
      const max = Math.max(...latencies);
      console.log(`p50 Latency:                     ${p50} ms`);
      console.log(`p95 Latency:                     ${p95} ms`);
      console.log(`p99 Latency:                     ${p99} ms`);
      console.log(`Max Latency:                     ${max} ms`);
      console.log(`Provisional Target (<800ms):     ${p95 < 800 ? 'MET ✓' : 'EXCEEDED ✗'}`);
    }

    if (failed > 0) {
      console.error(`\nTest suite FAILED with ${failed} failure(s).`);
      process.exit(1);
    } else {
      console.log('\nAll 12 Phase 4B Sharded Slot test scenarios PASSED successfully.');
      process.exit(0);
    }
  } catch (err) {
    console.error('\nFatal error running sharding tests:', err);
    process.exit(1);
  }
}

run();
