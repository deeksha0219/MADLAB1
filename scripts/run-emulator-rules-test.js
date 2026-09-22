/**
 * Real Firestore Rules Emulator Test Harness (Steps 4 & 6)
 * Uses @firebase/rules-unit-testing against a live Firestore Emulator.
 *
 * Verifies:
 * 1. Step 4 User & Admin rules.
 * 2. Step 6 Public/Student Canteen, Category, Item reads and blocked writes.
 * 3. Step 6 Protected private/admin subcollection security.
 * 4. Step 6 Active/Inactive and Available/Unavailable visibility gates.
 * 5. Step 6 Cross-canteen admin isolation.
 */

const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-grabngo-local';
const RULES_PATH = path.resolve(__dirname, '../firestore.rules');

async function runRealRulesEmulatorTests() {
  console.log('[Emulator Tests] Initializing test environment against Firestore Emulator on port 8085...');
  const rules = fs.readFileSync(RULES_PATH, 'utf8');

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8085,
    },
  });

  let testsPassed = 0;
  let testsFailed = 0;

  async function runTest(testName, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${testName}`);
      testsPassed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${testName}`);
      console.error(`    Error: ${err.message}`);
      testsFailed++;
    }
  }

  try {
    console.log('\n--- Seeding Initial Test Fixtures ---');

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      const now = new Date();

      // Users
      await adminDb.collection('users').doc('student_alice').set({
        uid: 'student_alice',
        name: 'Alice RVU',
        phone: '+919876543210',
        collegeId: 'alice@rvu.edu.in',
        role: 'student',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await adminDb.collection('users').doc('student_bob').set({
        uid: 'student_bob',
        name: 'Bob RVU',
        phone: '+918765432109',
        collegeId: 'bob@rvu.edu.in',
        role: 'student',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      // Admins
      await adminDb.collection('admins').doc('admin_canteen_1').set({
        uid: 'admin_canteen_1',
        role: 'canteen_admin',
        canteenIds: ['BIG_MINGOS'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await adminDb.collection('admins').doc('admin_canteen_2').set({
        uid: 'admin_canteen_2',
        role: 'canteen_admin',
        canteenIds: ['LIBRARY_CANTEEN'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await adminDb.collection('admins').doc('admin_suspended').set({
        uid: 'admin_suspended',
        role: 'canteen_admin',
        canteenIds: ['BIG_MINGOS'],
        status: 'inactive',
        createdAt: now,
        updatedAt: now,
      });

      // Canteens
      await adminDb.collection('canteens').doc('BIG_MINGOS').set({
        name: 'BIG MINGOS',
        code: 'BIG_MINGOS',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await adminDb.collection('canteens').doc('ADMIN_BLOCK_CANTEEN').set({
        name: 'Admin Block Canteen',
        code: 'ADMIN_BLOCK_CANTEEN',
        isActive: false, // Inactive
        createdAt: now,
        updatedAt: now,
      });

      // Categories
      await adminDb.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('BREAKFAST').set({
        name: 'Breakfast',
        sortOrder: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await adminDb.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('SECRET_CAT').set({
        name: 'Secret Category',
        sortOrder: 99,
        isActive: false, // Inactive
        createdAt: now,
        updatedAt: now,
      });

      // Items
      const dosaDoc = adminDb.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01');
      await dosaDoc.set({
        name: 'Masala Dosa',
        categoryId: 'BREAKFAST',
        priceInPaise: 7000,
        isAvailable: true,
        isActive: true,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      });

      // Item private admin metadata
      await dosaDoc.collection('private').doc('admin').set({
        costPrice: 3200,
        internalNotes: 'Wholesale batch #12',
        supplierData: 'Supplier A',
        updatedAt: now,
      });

      // Unavailable item
      await adminDb.collection('canteens').doc('BIG_MINGOS').collection('items').doc('samosa_01').set({
        name: 'Samosa',
        categoryId: 'BREAKFAST',
        priceInPaise: 2500,
        isAvailable: false, // Out of stock
        isActive: true,
        sortOrder: 2,
        createdAt: now,
        updatedAt: now,
      });

      // Inactive item
      await adminDb.collection('canteens').doc('BIG_MINGOS').collection('items').doc('secret_01').set({
        name: 'Secret Dish',
        categoryId: 'BREAKFAST',
        priceInPaise: 99900,
        isAvailable: true,
        isActive: false, // Inactive
        sortOrder: 99,
        createdAt: now,
        updatedAt: now,
      });
    });

    console.log('\n--- Step 4: User & Admin Security Rules ---');

    await runTest('Direct client profile create is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('users').doc('student_alice_new').set({
        uid: 'student_alice_new',
        name: 'Self',
        phone: '+919999999999',
        collegeId: 'new@rvu.edu.in',
        role: 'student',
        status: 'active',
      }));
    });

    await runTest('Unauthenticated read of student profile is DENIED', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.collection('users').doc('student_alice').get());
    });

    await runTest('Student reading own profile is ALLOWED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertSucceeds(db.collection('users').doc('student_alice').get());
    });

    await runTest('Student reading another student profile is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('users').doc('student_bob').get());
    });

    await runTest('Student updating allowed fields (name, collegeId, updatedAt) is ALLOWED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertSucceeds(db.collection('users').doc('student_alice').update({
        name: 'Alice Updated',
        collegeId: 'alice.updated@rvu.edu.in',
        updatedAt: new Date(),
      }));
    });

    await runTest('Student escalating role is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('users').doc('student_alice').update({ role: 'canteen_admin' }));
    });

    await runTest('Client writing directly to /admins collection is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('admins').doc('student_alice').set({
        uid: 'student_alice',
        role: 'canteen_admin',
        canteenIds: ['BIG_MINGOS'],
        status: 'active',
      }));
    });

    console.log('\n--- Step 6: Public / Student Catalog Access Tests ---');

    await runTest('Unauthenticated read of canteens is DENIED', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').get());
    });

    await runTest('Authenticated student can read active canteen', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertSucceeds(db.collection('canteens').doc('BIG_MINGOS').get());
    });

    await runTest('Authenticated student reading inactive canteen is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('ADMIN_BLOCK_CANTEEN').get());
    });

    await runTest('Authenticated student can read active category', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertSucceeds(db.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('BREAKFAST').get());
    });

    await runTest('Authenticated student reading inactive category is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('SECRET_CAT').get());
    });

    await runTest('Authenticated student can read available & active menu item', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertSucceeds(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01').get());
    });

    await runTest('Authenticated student reading unavailable menu item is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('samosa_01').get());
    });

    await runTest('Authenticated student reading inactive menu item is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('secret_01').get());
    });

    await runTest('Authenticated student reading private/admin subcollection is DENIED', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01').collection('private').doc('admin').get());
    });

    await runTest('Student cannot write/create canteens', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('NEW_CANTEEN').set({
        name: 'Hack Canteen',
        code: 'HACK',
        isActive: true,
      }));
    });

    await runTest('Student cannot write/create categories', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('HACK_CAT').set({
        name: 'Hack Cat',
        isActive: true,
      }));
    });

    await runTest('Student cannot write/create menu items', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('hack_item').set({
        name: 'Free Food',
        priceInPaise: 0,
        categoryId: 'BREAKFAST',
      }));
    });

    await runTest('Student cannot tamper with menu item price directly', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01').update({
        priceInPaise: 10,
      }));
    });

    await runTest('Student cannot tamper with item availability directly', async () => {
      const db = testEnv.authenticatedContext('student_alice').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('samosa_01').update({
        isAvailable: true,
      }));
    });

    console.log('\n--- Step 6: Admin Access & Isolation Tests ---');

    await runTest('Assigned active admin can read unavailable item in own canteen', async () => {
      const db = testEnv.authenticatedContext('admin_canteen_1').firestore();
      await assertSucceeds(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('samosa_01').get());
    });

    await runTest('Assigned active admin can read inactive item in own canteen', async () => {
      const db = testEnv.authenticatedContext('admin_canteen_1').firestore();
      await assertSucceeds(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('secret_01').get());
    });

    await runTest('Assigned active admin can read private/admin subcollection', async () => {
      const db = testEnv.authenticatedContext('admin_canteen_1').firestore();
      await assertSucceeds(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01').collection('private').doc('admin').get());
    });

    await runTest('Active admin reading private data of UNASSIGNED canteen is DENIED', async () => {
      // admin_canteen_2 is assigned only to LIBRARY_CANTEEN, not BIG_MINGOS
      const db = testEnv.authenticatedContext('admin_canteen_2').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01').collection('private').doc('admin').get());
    });

    await runTest('Suspended/inactive admin reading private data is DENIED', async () => {
      const db = testEnv.authenticatedContext('admin_suspended').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01').collection('private').doc('admin').get());
    });

    await runTest('Direct client write by admin is DENIED (enforcing Cloud Functions write path)', async () => {
      const db = testEnv.authenticatedContext('admin_canteen_1').firestore();
      await assertFails(db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01').update({
        priceInPaise: 5000,
      }));
    });

    await runTest('Admin cannot self-assign additional canteenIds', async () => {
      const db = testEnv.authenticatedContext('admin_canteen_1').firestore();
      await assertFails(db.collection('admins').doc('admin_canteen_1').update({
        canteenIds: ['BIG_MINGOS', 'LIBRARY_CANTEEN'],
      }));
    });

  } finally {
    await testEnv.cleanup();
    console.log(`\n[Real Emulator Tests Summary] Total: ${testsPassed + testsFailed} | Passed: ${testsPassed} | Failed: ${testsFailed}`);
  }

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runRealRulesEmulatorTests().catch((err) => {
  console.error('[Emulator Test Fatal Error]:', err);
  process.exit(1);
});
