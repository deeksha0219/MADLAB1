/**
 * Synthetic Seed Data for Firestore Emulator Suite (Step 6)
 *
 * Populates synthetic test data for local emulator testing:
 * - Canteens (Active & Inactive)
 * - Categories (Active & Inactive)
 * - Menu Items (Available, Unavailable, and Inactive)
 * - Protected private admin metadata (costPrice, internalNotes, supplierData)
 * - Synthetic Admins (Active & Suspended)
 * - Synthetic Students
 *
 * SAFETY GUARANTEES:
 * - Runs ONLY against demo-grabngo-local Firestore Emulator on port 8085.
 * - Staging / Production connections are strictly blocked.
 */

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-grabngo-local';
const RULES_PATH = path.resolve(__dirname, '../firestore.rules');

async function seedCatalogEmulator() {
  console.log('[Seed] Connecting to Firestore Emulator on port 8085...');
  const rules = fs.readFileSync(RULES_PATH, 'utf8');

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8085,
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const now = new Date();

      console.log('[Seed] Seeding synthetic admins and users...');
      // 1. Synthetic Admins
      await db.collection('admins').doc('admin_canteen_1').set({
        uid: 'admin_canteen_1',
        role: 'canteen_admin',
        canteenIds: ['BIG_MINGOS'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await db.collection('admins').doc('admin_canteen_2').set({
        uid: 'admin_canteen_2',
        role: 'canteen_admin',
        canteenIds: ['LIBRARY_CANTEEN'],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await db.collection('admins').doc('admin_suspended').set({
        uid: 'admin_suspended',
        role: 'canteen_admin',
        canteenIds: ['BIG_MINGOS'],
        status: 'inactive',
        createdAt: now,
        updatedAt: now,
      });

      // 2. Synthetic Students
      await db.collection('users').doc('student_alice').set({
        uid: 'student_alice',
        name: 'Alice RVU',
        phone: '+919876543210',
        collegeId: 'alice@rvu.edu.in',
        role: 'student',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      console.log('[Seed] Seeding canteens...');
      // 3. Canteens
      await db.collection('canteens').doc('BIG_MINGOS').set({
        name: 'BIG MINGOS',
        code: 'BIG_MINGOS',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await db.collection('canteens').doc('LIBRARY_CANTEEN').set({
        name: 'M.M Foods (Library)',
        code: 'LIBRARY_CANTEEN',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await db.collection('canteens').doc('ADMIN_BLOCK_CANTEEN').set({
        name: 'M.M Foods (Admin Block)',
        code: 'ADMIN_BLOCK_CANTEEN',
        isActive: false, // Inactive canteen
        createdAt: now,
        updatedAt: now,
      });

      console.log('[Seed] Seeding categories...');
      // 4. Categories for BIG_MINGOS
      const catBreakfast = db.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('BREAKFAST');
      await catBreakfast.set({
        name: 'Breakfast',
        sortOrder: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      const catSnacks = db.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('SNACKS');
      await catSnacks.set({
        name: 'Snacks',
        sortOrder: 2,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      const catSecret = db.collection('canteens').doc('BIG_MINGOS').collection('categories').doc('SECRET_SPECIALS');
      await catSecret.set({
        name: 'Secret Specials',
        sortOrder: 3,
        isActive: false, // Inactive category
        createdAt: now,
        updatedAt: now,
      });

      console.log('[Seed] Seeding menu items & private admin data...');
      // 5. Menu Items for BIG_MINGOS
      // Item 1: Masala Dosa (Active, Available)
      const itemDosa = db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('dosa_01');
      await itemDosa.set({
        name: 'Masala Dosa',
        description: 'Crispy dosa with chutney and sambar',
        categoryId: 'BREAKFAST',
        priceInPaise: 7000, // ₹70.00
        imageUrl: 'https://images.unsplash.com/photo-masala-dosa',
        isAvailable: true,
        isActive: true,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      });

      // Private Admin metadata for Masala Dosa
      await itemDosa.collection('private').doc('admin').set({
        internalNotes: 'Supplier: South Spices Ltd',
        costPrice: 3200, // ₹32.00
        supplierData: 'Vendor ID 8847',
        updatedAt: now,
      });

      // Item 2: Samosa (Active, but Unavailable / Out of stock)
      const itemSamosa = db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('samosa_01');
      await itemSamosa.set({
        name: 'Crispy Samosa',
        description: 'Spiced potato stuffed pastry',
        categoryId: 'SNACKS',
        priceInPaise: 2500, // ₹25.00
        isAvailable: false, // Out of stock
        isActive: true,
        sortOrder: 2,
        createdAt: now,
        updatedAt: now,
      });

      // Item 3: Secret Item (Inactive)
      const itemSecret = db.collection('canteens').doc('BIG_MINGOS').collection('items').doc('secret_01');
      await itemSecret.set({
        name: 'Off-Menu Secret',
        description: 'Hidden item for staff only',
        categoryId: 'SECRET_SPECIALS',
        priceInPaise: 99900,
        isAvailable: true,
        isActive: false, // Soft deleted / inactive
        sortOrder: 99,
        createdAt: now,
        updatedAt: now,
      });

      console.log('[Seed] Catalog seeding complete successfully.');
    });
  } finally {
    await testEnv.cleanup();
  }
}

if (require.main === module) {
  seedCatalogEmulator()
    .then(() => console.log('[Seed] Finished.'))
    .catch((err) => {
      console.error('[Seed Error]:', err);
      process.exit(1);
    });
}

module.exports = { seedCatalogEmulator };
