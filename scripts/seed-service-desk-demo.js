/**
 * Seed script for Service Desk Demo in Local Emulator
 */
const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'demo-grabngo-local' });
}

const db = admin.firestore();
const auth = admin.auth();

async function seed() {
  console.log('[Seed] Seeding service desk user & demo orders...');
  const now = admin.firestore.FieldValue.serverTimestamp();

  // 1. Create / update auth user for service desk
  const phone = '+919999999999';
  let userRecord;
  try {
    userRecord = await auth.getUserByPhoneNumber(phone);
  } catch (e) {
    userRecord = await auth.createUser({
      phoneNumber: phone,
      displayName: 'Service Desk Operator',
    });
  }

  // 2. Set admin record in Firestore with service_desk role
  await db.collection('admins').doc(userRecord.uid).set({
    uid: userRecord.uid,
    role: 'service_desk',
    name: 'Service Desk Attendant',
    canteenIds: ['BIG_MINGOS', 'LIBRARY_CANTEEN'],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  console.log(`[Seed] Service Desk Admin seeded: UID=${userRecord.uid}, Phone=${phone}`);

  // 3. Seed sample orders in BIG_MINGOS
  const orders = [
    {
      orderId: 'ORD-1001',
      shortOrderReference: 'MING-1001',
      canteenId: 'BIG_MINGOS',
      studentUid: 'student_alice_demo',
      status: 'placed',
      paymentStatus: 'pending',
      paymentMethod: 'cash',
      totalInPaise: 12000,
      subtotalInPaise: 12000,
      currency: 'INR',
      itemsSnapshot: [
        { itemId: 'item_veg_sandwich', itemName: 'Veg Club Sandwich', quantity: 2, unitPriceInPaise: 6000, lineTotalInPaise: 12000 }
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      orderId: 'ORD-1002',
      shortOrderReference: 'MING-1002',
      canteenId: 'BIG_MINGOS',
      studentUid: 'student_bob_demo',
      status: 'payment_verified',
      paymentStatus: 'succeeded_demo',
      paymentMethod: 'upi_demo',
      totalInPaise: 8500,
      subtotalInPaise: 8500,
      currency: 'INR',
      itemsSnapshot: [
        { itemId: 'item_cold_coffee', itemName: 'Cold Coffee Frappe', quantity: 1, unitPriceInPaise: 8500, lineTotalInPaise: 8500 }
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      orderId: 'ORD-1003',
      shortOrderReference: 'MING-1003',
      canteenId: 'BIG_MINGOS',
      studentUid: 'student_carol_demo',
      status: 'accepted',
      paymentStatus: 'succeeded_demo',
      paymentMethod: 'upi_demo',
      totalInPaise: 15000,
      subtotalInPaise: 15000,
      currency: 'INR',
      itemsSnapshot: [
        { itemId: 'item_paneer_roll', itemName: 'Paneer Tikka Roll', quantity: 2, unitPriceInPaise: 7500, lineTotalInPaise: 15000 }
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      orderId: 'ORD-1004',
      shortOrderReference: 'MING-1004',
      canteenId: 'BIG_MINGOS',
      studentUid: 'student_david_demo',
      status: 'preparing',
      paymentStatus: 'succeeded_demo',
      paymentMethod: 'upi_demo',
      totalInPaise: 6500,
      subtotalInPaise: 6500,
      currency: 'INR',
      itemsSnapshot: [
        { itemId: 'item_samosa', itemName: 'Samosa Duo with Chutney', quantity: 1, unitPriceInPaise: 6500, lineTotalInPaise: 6500 }
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      orderId: 'ORD-1005',
      shortOrderReference: 'MING-1005',
      canteenId: 'BIG_MINGOS',
      studentUid: 'student_elena_demo',
      status: 'ready_for_pickup',
      paymentStatus: 'succeeded_demo',
      paymentMethod: 'upi_demo',
      totalInPaise: 4500,
      subtotalInPaise: 4500,
      currency: 'INR',
      itemsSnapshot: [
        { itemId: 'item_masala_chai', itemName: 'Special Masala Chai', quantity: 3, unitPriceInPaise: 1500, lineTotalInPaise: 4500 }
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const o of orders) {
    await db.collection('orders').doc(o.orderId).set(o);
    await db.collection('orders').doc(o.orderId).collection('auditEvents').doc(`${o.orderId}_created`).set({
      eventId: `${o.orderId}_created`,
      orderId: o.orderId,
      canteenId: o.canteenId,
      eventType: 'order_created',
      actorUid: o.studentUid,
      actorRole: 'student',
      createdAt: now,
    });
  }

  console.log(`[Seed] Seeded ${orders.length} orders into BIG_MINGOS successfully.`);
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
