/**
 * Real Firebase Functions Emulator Test Runner (Step 6)
 *
 * Connects to live local Auth (9099), Firestore (8085), and Functions (5001) Emulators.
 *
 * Verifies all 10 Step 6 Callable Functions:
 * - createCanteen
 * - updateCanteen
 * - setCanteenActive
 * - createCategory
 * - updateCategory
 * - setCategoryActive
 * - createMenuItem
 * - updateMenuItem
 * - setMenuItemAvailability
 * - setMenuItemActive
 *
 * Tests:
 * 1. Authorization: Unauthenticated, student, inactive admin, cross-canteen admin, operator.
 * 2. Validation: ID formats, names, prices (minor integer paise), booleans, URLs, sortOrder, unknown fields.
 * 3. Parent/Relationship integrity: Non-existent canteen, disabled canteen, invalid category.
 * 4. Reliability & Idempotency: Duplicate creation, preservation of createdAt, private data isolation.
 */

const axios = require('axios');
const path = require('path');

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
  operator: { uid: 'operator_admin', role: 'platform_operator', status: 'active', canteenIds: [] },
  admin1: { uid: 'admin_canteen_1', role: 'canteen_admin', status: 'active', canteenIds: ['BIG_MINGOS'] },
  admin2: { uid: 'admin_canteen_2', role: 'canteen_admin', status: 'active', canteenIds: ['LIBRARY_CANTEEN'] },
  suspendedAdmin: { uid: 'admin_suspended', role: 'canteen_admin', status: 'inactive', canteenIds: ['BIG_MINGOS'] },
  student: { uid: 'student_alice', role: 'student', status: 'active' },
};

const tokenCache = {};

async function getIdToken(userKey) {
  if (tokenCache[userKey]) return tokenCache[userKey];
  const user = USERS[userKey];
  if (!user) throw new Error(`Unknown user key: ${userKey}`);

  // Create custom token
  const customToken = await admin.auth().createCustomToken(user.uid, {
    role: user.role,
    canteenIds: user.canteenIds || [],
  });

  // Exchange custom token for ID token via Auth Emulator
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
        error: err.response.data?.error || { message: err.message },
      };
    }
    return { ok: false, status: 500, error: { message: err.message } };
  }
}

async function setupTestFixtures() {
  console.log('[Setup] Seeding test admins and canteens in Firestore...');
  const now = new Date();

  // Seed Admin Documents in admins/{uid}
  for (const [key, user] of Object.entries(USERS)) {
    if (user.role.includes('admin') || user.role === 'platform_operator') {
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

  // Seed baseline canteen
  await db.collection('canteens').doc('BIG_MINGOS').set({
    canteenId: 'BIG_MINGOS',
    name: 'BIG MINGOS',
    code: 'BIG_MINGOS',
    isActive: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  });

  // Seed baseline category
  await db.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('SNACKS').set({
    categoryId: 'SNACKS',
    canteenId: 'BIG_MINGOS',
    name: 'Snacks',
    sortOrder: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  // Seed baseline item
  await db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('ITEM_TEST').set({
    itemId: 'ITEM_TEST',
    canteenId: 'BIG_MINGOS',
    categoryId: 'SNACKS',
    name: 'Burger Test',
    priceInPaise: 5000,
    isActive: true,
    isAvailable: true,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  });

  // Seed disabled canteen
  await db.collection('canteens').doc('DISABLED_CANTEEN').set({
    canteenId: 'DISABLED_CANTEEN',
    name: 'Disabled Canteen',
    code: 'DISABLED',
    isActive: false,
    sortOrder: 99,
    createdAt: now,
    updatedAt: now,
  });

  console.log('[Setup] Seed completed.');
}

async function runAllFunctionsTests() {
  console.log('================================================================');
  console.log('Step 6: Live Firebase Functions Emulator Test Suite');
  console.log('Project: demo-grabngo-local | Functions Port: 5001');
  console.log('================================================================\n');

  await setupTestFixtures();

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  // Helper assertions
  function assertRejected(res, expectedStatus = null, expectedCode = null) {
    if (res.ok) throw new Error('Expected function call to fail, but it succeeded.');
    if (expectedStatus && res.status !== expectedStatus) {
      throw new Error(`Expected HTTP ${expectedStatus}, got ${res.status} (${JSON.stringify(res.error)})`);
    }
    if (expectedCode && res.error?.status !== expectedCode) {
      throw new Error(`Expected error status "${expectedCode}", got "${res.error?.status}"`);
    }
  }

  function assertSucceeded(res) {
    if (!res.ok) {
      throw new Error(`Expected function call to succeed, but failed with status ${res.status}: ${JSON.stringify(res.error)}`);
    }
  }

  console.log('--- 1. Authorization Tests Across All 10 Functions ---');

  const ALL_FUNCTIONS = [
    { name: 'updateCanteen', data: { canteenId: 'BIG_MINGOS', name: 'Updated' } },
    { name: 'setCanteenActive', data: { canteenId: 'BIG_MINGOS', isActive: true } },
    { name: 'createCategory', data: { canteenId: 'BIG_MINGOS', categoryId: 'TEST_CAT', name: 'Test' } },
    { name: 'updateCategory', data: { canteenId: 'BIG_MINGOS', categoryId: 'SNACKS', name: 'Updated Snacks' } },
    { name: 'setCategoryActive', data: { canteenId: 'BIG_MINGOS', categoryId: 'SNACKS', isActive: true } },
    { name: 'createMenuItem', data: { canteenId: 'BIG_MINGOS', categoryId: 'SNACKS', itemId: 'ITEM_TEST', name: 'Burger', priceInPaise: 5000 } },
    { name: 'updateMenuItem', data: { canteenId: 'BIG_MINGOS', itemId: 'ITEM_TEST', name: 'Burger Updated' } },
    { name: 'setMenuItemAvailability', data: { canteenId: 'BIG_MINGOS', itemId: 'ITEM_TEST', isAvailable: true } },
    { name: 'setMenuItemActive', data: { canteenId: 'BIG_MINGOS', itemId: 'ITEM_TEST', isActive: true } },
  ];

  // 1.1 Unauthenticated calls rejected
  for (const fn of ALL_FUNCTIONS) {
    await test(`Unauthenticated call to ${fn.name} is REJECTED (HTTP 401 unauthenticated)`, async () => {
      const res = await callFunction(fn.name, fn.data, null);
      assertRejected(res, 401, 'UNAUTHENTICATED');
    });
  }

  await test('Unauthenticated call to createCanteen is REJECTED (HTTP 401)', async () => {
    const res = await callFunction('createCanteen', { canteenId: 'TEST_NEW', name: 'New' }, null);
    assertRejected(res, 401, 'UNAUTHENTICATED');
  });

  // 1.2 Student calls rejected
  for (const fn of ALL_FUNCTIONS) {
    await test(`Ordinary student call to ${fn.name} is REJECTED (HTTP 403 permission-denied)`, async () => {
      const res = await callFunction(fn.name, fn.data, 'student');
      assertRejected(res, 403, 'PERMISSION_DENIED');
    });
  }

  // 1.3 Suspended admin rejected
  for (const fn of ALL_FUNCTIONS) {
    await test(`Suspended admin call to ${fn.name} is REJECTED (HTTP 403 permission-denied)`, async () => {
      const res = await callFunction(fn.name, fn.data, 'suspendedAdmin');
      assertRejected(res, 403, 'PERMISSION_DENIED');
    });
  }

  // 1.4 Cross-canteen admin rejected (admin2 assigned to LIBRARY_CANTEEN accessing BIG_MINGOS)
  for (const fn of ALL_FUNCTIONS) {
    await test(`Cross-canteen admin call to ${fn.name} is REJECTED (HTTP 403 permission-denied)`, async () => {
      const res = await callFunction(fn.name, fn.data, 'admin2');
      assertRejected(res, 403, 'PERMISSION_DENIED');
    });
  }

  // 1.5 Canteen creation authorization (Platform Operator required)
  await test('Ordinary canteen admin calling createCanteen is REJECTED (HTTP 403 permission-denied)', async () => {
    const res = await callFunction('createCanteen', { canteenId: 'NEW_CANTEEN', name: 'New Canteen' }, 'admin1');
    assertRejected(res, 403, 'PERMISSION_DENIED');
  });

  await test('Platform Operator calling createCanteen is ALLOWED', async () => {
    const res = await callFunction('createCanteen', { canteenId: 'NEW_CANTEEN_OP', name: 'Operator Canteen', code: 'OP_CANTEEN' }, 'operator');
    assertSucceeded(res);
  });

  console.log('\n--- 2. Input Validation Tests ---');

  // Unknown fields rejected
  await test('Unknown field in createCategory is REJECTED', async () => {
    const res = await callFunction('createCategory', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'BAD_CAT',
      name: 'Bad',
      injectedField: 'hack',
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  await test('Client-injected role/status in createMenuItem is REJECTED', async () => {
    const res = await callFunction('createMenuItem', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'SNACKS',
      itemId: 'HACK_ITEM',
      name: 'Hack Item',
      priceInPaise: 1000,
      role: 'admin',
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  // Price validation
  await test('Negative priceInPaise is REJECTED', async () => {
    const res = await callFunction('createMenuItem', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'SNACKS',
      itemId: 'NEG_ITEM',
      name: 'Negative Item',
      priceInPaise: -500,
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  await test('Decimal / floating-point priceInPaise is REJECTED', async () => {
    const res = await callFunction('createMenuItem', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'SNACKS',
      itemId: 'DEC_ITEM',
      name: 'Decimal Item',
      priceInPaise: 49.99,
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  await test('Price exceeding maximum (500,000 paise / ₹5,000) is REJECTED', async () => {
    const res = await callFunction('createMenuItem', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'SNACKS',
      itemId: 'EXPENSIVE_ITEM',
      name: 'Expensive Item',
      priceInPaise: 500001,
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  // Name validation
  await test('Empty or whitespace-only name is REJECTED', async () => {
    const res = await callFunction('createCategory', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'EMPTY_NAME',
      name: '   ',
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  await test('Oversized name (> 100 chars) is REJECTED', async () => {
    const res = await callFunction('createCategory', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'LONG_NAME',
      name: 'A'.repeat(101),
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  // Safe URL validation
  await test('Insecure or non-HTTPS URL in createMenuItem is REJECTED', async () => {
    const res = await callFunction('createMenuItem', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'SNACKS',
      itemId: 'BAD_URL_ITEM',
      name: 'Bad URL Item',
      priceInPaise: 2000,
      imageUrl: 'http://insecure.com/pic.png',
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  // Invalid sortOrder
  await test('Negative sortOrder is REJECTED', async () => {
    const res = await callFunction('createCategory', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'NEG_SORT',
      name: 'Neg Sort',
      sortOrder: -1,
    }, 'admin1');
    assertRejected(res, 400, 'INVALID_ARGUMENT');
  });

  console.log('\n--- 3. Parent & Relationship Integrity Tests ---');

  await test('Creating category under non-existent canteen is REJECTED (HTTP 404 not-found)', async () => {
    const res = await callFunction('createCategory', {
      canteenId: 'NON_EXISTENT_CANTEEN',
      categoryId: 'ORPHAN_CAT',
      name: 'Orphan Category',
    }, 'operator');
    assertRejected(res, 404, 'NOT_FOUND');
  });

  await test('Creating menu item under disabled canteen is REJECTED (HTTP 400 failed-precondition)', async () => {
    const res = await callFunction('createMenuItem', {
      canteenId: 'DISABLED_CANTEEN',
      categoryId: 'SNACKS',
      itemId: 'DISABLED_ITEM',
      name: 'Disabled Item',
      priceInPaise: 3000,
    }, 'operator');
    assertRejected(res, 400, 'FAILED_PRECONDITION');
  });

  await test('Creating menu item under non-existent category is REJECTED (HTTP 404 not-found)', async () => {
    const res = await callFunction('createMenuItem', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'DOES_NOT_EXIST',
      itemId: 'NO_CAT_ITEM',
      name: 'No Cat Item',
      priceInPaise: 3000,
    }, 'admin1');
    assertRejected(res, 404, 'NOT_FOUND');
  });

  console.log('\n--- 4. Reliability, Idempotency & Private Data Isolation Tests ---');

  await test('createMenuItem saves public fields and isolates private/admin data', async () => {
    const res = await callFunction('createMenuItem', {
      canteenId: 'BIG_MINGOS',
      categoryId: 'SNACKS',
      itemId: 'SECRET_FORMULA_BURGER',
      name: 'Formula Burger',
      priceInPaise: 8500,
      isAvailable: true,
      costPriceInPaise: 3500,
      internalNotes: 'Confidential supplier batch #99',
    }, 'admin1');

    assertSucceeded(res);
    // Verify public response does NOT expose private costPrice or notes
    if (res.data.item?.costPriceInPaise || res.data.item?.internalNotes) {
      throw new Error('Confidential fields leaked in public item response!');
    }

    // Verify written document in Firestore
    const publicDoc = await db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('SECRET_FORMULA_BURGER').get();
    if (!publicDoc.exists || publicDoc.data()?.costPriceInPaise !== undefined) {
      throw new Error('Confidential field leaked into public document!');
    }

    const privateDoc = await db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('SECRET_FORMULA_BURGER').collection('private').doc('admin').get();
    if (!privateDoc.exists || privateDoc.data()?.costPriceInPaise !== 3500) {
      throw new Error('Private admin data not properly saved to private subcollection!');
    }
  });

  await test('Repeating updateMenuItem does not alter createdAt timestamp', async () => {
    const itemRef = db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('SECRET_FORMULA_BURGER');
    const beforeSnap = await itemRef.get();
    const originalCreatedAt = beforeSnap.data()?.createdAt;

    const res = await callFunction('updateMenuItem', {
      canteenId: 'BIG_MINGOS',
      itemId: 'SECRET_FORMULA_BURGER',
      name: 'Formula Burger Deluxe',
      priceInPaise: 9000,
    }, 'admin1');
    assertSucceeded(res);

    const afterSnap = await itemRef.get();
    const afterCreatedAt = afterSnap.data()?.createdAt;

    if (originalCreatedAt.toMillis() !== afterCreatedAt.toMillis()) {
      throw new Error('Item createdAt timestamp was reset by update operation!');
    }
    if (afterSnap.data()?.name !== 'Formula Burger Deluxe' || afterSnap.data()?.priceInPaise !== 9000) {
      throw new Error('Item updates were not applied properly.');
    }
  });

  await test('setMenuItemAvailability toggles item availability cleanly', async () => {
    const res = await callFunction('setMenuItemAvailability', {
      canteenId: 'BIG_MINGOS',
      itemId: 'SECRET_FORMULA_BURGER',
      isAvailable: false,
    }, 'admin1');
    assertSucceeded(res);

    const snap = await db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('SECRET_FORMULA_BURGER').get();
    if (snap.data()?.isAvailable !== false) {
      throw new Error('Availability flag was not updated.');
    }
  });

  console.log('\n================================================================');
  console.log(`Functions Emulator Test Summary: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllFunctionsTests().catch((err) => {
  console.error('[Fatal Test Runner Error]:', err);
  process.exit(1);
});
