/**
 * GrabNGo Cloud Functions - Authentication & Authorization Operations
 *
 * Security Invariants:
 * 1. Student profiles are initialized strictly by the server; clients cannot set role, status, uid, or timestamps.
 * 2. Strict input validation rejecting any unknown fields.
 * 3. Verified phone numbers are derived directly from Firebase Auth; mismatched submissions are rejected.
 * 4. Admin assignments are managed exclusively through server-controlled functions with operator authorization.
 *    No client-provided static secret is accepted. Local emulator bootstrap is restricted to FUNCTIONS_EMULATOR === 'true'.
 * 5. Zero plaintext passwords are ever accepted, stored, or processed.
 * 6. Suffix checking (@rvu.edu.in) validates institutional domain format, but DOES NOT prove email ownership
 *    without email link confirmation or institutional SSO.
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function serverTimestamp() {
  if (admin.firestore?.FieldValue?.serverTimestamp) {
    return admin.firestore.FieldValue.serverTimestamp();
  }
  try {
    const { FieldValue } = require('@google-cloud/firestore');
    return FieldValue.serverTimestamp();
  } catch {
    return admin.firestore.FieldValue.serverTimestamp();
  }
}

// Approved canteen identifiers in GrabNGo
export const ALLOWED_CANTEEN_IDS = ['BIG_MINGOS', 'LIBRARY_CANTEEN'] as const;
export type CanteenId = typeof ALLOWED_CANTEEN_IDS[number];

/**
 * Strict server-side normalization and validation of Indian mobile numbers.
 * Enforces canonical E.164 format: +91 followed by 10 digits starting with 6, 7, 8, or 9.
 */
export function strictNormalizePhone(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Phone number must be a non-empty string.',
    );
  }

  const digits = rawPhone.replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    const core = digits.substring(2);
    if (/^[6-9]\d{9}$/.test(core)) {
      return `+91${core}`;
    }
  }

  if (digits.length === 10) {
    if (/^[6-9]\d{9}$/.test(digits)) {
      return `+91${digits}`;
    }
  }

  throw new functions.https.HttpsError(
    'invalid-argument',
    'Phone number must be a valid 10-digit Indian mobile number starting with 6-9.',
  );
}

/**
 * Validates that an object contains ONLY the allowed keys (rejects unexpected fields).
 */
function rejectUnknownFields(
  data: Record<string, any>,
  allowedKeys: string[],
  functionName: string,
): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${functionName} expects a JSON object payload.`,
    );
  }

  const payloadKeys = Object.keys(data);
  const unknownKeys = payloadKeys.filter((key) => !allowedKeys.includes(key));

  if (unknownKeys.length > 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Unexpected field(s) detected in ${functionName} payload: ${unknownKeys.join(', ')}.`,
    );
  }
}

/**
 * Callable Function: createStudentProfile
 *
 * Allows an authenticated student to register their name and RVU college email.
 * The server assigns:
 * - uid: context.auth.uid
 * - phone: derived from verified Firebase Auth record
 * - role: 'student' (immutable by client)
 * - status: 'active' (immutable by client)
 * - createdAt / updatedAt: serverTimestamp()
 */
export const createStudentProfile = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Verify authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required to create a profile.',
      );
    }

    // 2. Strict input validation - reject unknown fields
    rejectUnknownFields(data, ['name', 'collegeId', 'phone'], 'createStudentProfile');

    const uid = context.auth.uid;
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const collegeId = typeof data.collegeId === 'string' ? data.collegeId.trim().toLowerCase() : '';

    // Validate Name: 2-60 characters, letters, spaces, hyphens, dots
    if (!name || name.length < 2 || name.length > 60 || !/^[a-zA-Z\s.'-]+$/.test(name)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Full name must be between 2 and 60 characters and contain only letters, spaces, hyphens, or dots.',
      );
    }

    // Validate RVU Email format
    // NOTE: Suffix checking verifies institutional formatting. It DOES NOT prove ownership
    // of the mailbox without sending an email verification link or using institutional SSO.
    const emailRegex = /^[a-zA-Z0-9._%+-]+@rvu\.edu\.in$/;
    if (!collegeId || !emailRegex.test(collegeId)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'A valid RVU student email address (@rvu.edu.in) is required.',
      );
    }

    // 3. Fetch verified phone number directly from Firebase Auth record
    const userRecord = await admin.auth().getUser(uid);
    const authPhone = userRecord.phoneNumber;

    if (!authPhone) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Verified phone number not found in Firebase Authentication record.',
      );
    }

    // 4. If client submitted a phone, strictly validate and verify it matches the Auth phone
    if (data.phone) {
      const normalizedSubmitted = strictNormalizePhone(data.phone);
      if (normalizedSubmitted !== authPhone) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Submitted phone number does not match the verified authentication phone number.',
        );
      }
    }

    const userRef = db.collection('users').doc(uid);
    const existingDoc = await userRef.get();

    if (existingDoc.exists) {
      // Profile already exists; return existing authoritative data without permitting role/status override
      return {
        success: true,
        message: 'Profile already exists.',
        profile: existingDoc.data(),
      };
    }

    // 5. Create server-authoritative profile
    const newProfile = {
      uid,
      name,
      phone: authPhone, // Derived from Firebase Auth
      collegeId,
      role: 'student', // Server-controlled role
      status: 'active', // Server-controlled status
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await userRef.set(newProfile);

    return {
      success: true,
      message: 'Student profile created successfully.',
      profile: {
        uid,
        name,
        phone: authPhone,
        collegeId,
        role: 'student',
        status: 'active',
      },
    };
  },
);

/**
 * Callable Function: assignAdminRole
 *
 * Assigns an admin role and canteen assignments to a designated user UID.
 * Requires caller to be an active admin, OR local-emulator-only execution (FUNCTIONS_EMULATOR === 'true').
 * No client-provided static secret is accepted.
 */
export const assignAdminRole = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Strict input validation - reject unknown fields
    rejectUnknownFields(data, ['targetUid', 'canteenIds'], 'assignAdminRole');

    const { targetUid, canteenIds } = data;

    // Validate targetUid: non-empty string, length 1-128
    if (!targetUid || typeof targetUid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(targetUid)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a valid alphanumeric user ID.',
      );
    }

    // Validate canteenIds: array of strings, all belonging to ALLOWED_CANTEEN_IDS
    if (
      !Array.isArray(canteenIds) ||
      canteenIds.length === 0 ||
      canteenIds.some((id) => typeof id !== 'string' || !ALLOWED_CANTEEN_IDS.includes(id as any))
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `canteenIds must be a non-empty array containing only approved IDs: ${ALLOWED_CANTEEN_IDS.join(', ')}.`,
      );
    }

    // 2. Authorization check:
    // Requires caller to possess an existing active admin document in Firestore,
    // OR strictly running inside the local Firebase Functions Emulator.
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

    let isCallerAdmin = false;
    if (context.auth && context.auth.uid) {
      const callerDoc = await db.collection('admins').doc(context.auth.uid).get();
      isCallerAdmin = callerDoc.exists && callerDoc.data()?.status === 'active';
    }

    if (!isCallerAdmin && !isEmulator) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Administrative authorization required. Unprivileged clients cannot assign admin roles.',
      );
    }

    const adminRef = db.collection('admins').doc(targetUid);
    const adminRecord = {
      uid: targetUid,
      role: 'canteen_admin',
      canteenIds,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await adminRef.set(adminRecord, { merge: true });

    // Assign custom claims for token-level validation
    await admin.auth().setCustomUserClaims(targetUid, {
      role: 'canteen_admin',
      canteenIds,
    });

    return {
      success: true,
      message: `Admin role and canteens assigned to user ${targetUid}.`,
    };
  },
);

// ============================================================================
// ============================================================================
// STEP 6: CANTEEN, CATEGORY & MENU ITEM MANAGEMENT CALLABLE FUNCTIONS
// ============================================================================

/**
 * Helper: Verifies caller is a trusted platform operator.
 * Platform operators have role === 'platform_operator' or isOperator === true in admins/{uid}.
 * Used for platform-level management including creating new canteens.
 */
async function verifyPlatformOperator(
  context: functions.https.CallableContext,
): Promise<void> {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Authentication required for platform administration.',
    );
  }

  const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
  const data = adminDoc.data();
  const isOperator = adminDoc.exists && data?.status === 'active' && (
    data?.role === 'platform_operator' || data?.isOperator === true || context.auth.token?.role === 'platform_operator'
  );

  if (!isOperator) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Platform operator privileges required to create canteens. Ordinary canteen admins cannot create canteens.',
    );
  }
}

/**
 * Helper: Verifies the caller is an active admin assigned to the target canteen,
 * or a platform operator.
 */
async function verifyAdminForCanteen(
  context: functions.https.CallableContext,
  canteenId: string,
): Promise<void> {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Authentication required for catalog administration.',
    );
  }

  const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
  if (!adminDoc.exists || adminDoc.data()?.status !== 'active') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Active administrative privileges required.',
    );
  }

  const data = adminDoc.data()!;
  if (data.role === 'platform_operator' || data.isOperator === true) {
    return;
  }

  const assignedCanteens: string[] = Array.isArray(data.canteenIds) ? data.canteenIds : [];

  if (!assignedCanteens.includes(canteenId)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      `Caller is not an authorized administrator for canteen ${canteenId}.`,
    );
  }
}

function validatePriceInPaise(price: any): number {
  if (
    typeof price !== 'number' ||
    !Number.isInteger(price) ||
    price < 0 ||
    price > 500000 ||
    isNaN(price) ||
    !isFinite(price)
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'priceInPaise must be an integer between 0 and 500,000 paise (₹0 to ₹5,000).',
    );
  }
  return price;
}

function validateName(name: any, fieldName = 'name'): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length < 1 || name.trim().length > 100) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} must be a non-empty string between 1 and 100 characters.`,
    );
  }
  return name.trim();
}

function validateId(id: any, fieldName = 'ID'): string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} must be an alphanumeric identifier between 1 and 64 characters.`,
    );
  }
  return id;
}

function validateSortOrder(sortOrder: any): number {
  if (sortOrder === undefined || sortOrder === null) return 0;
  if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder) || sortOrder < 0 || !isFinite(sortOrder)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'sortOrder must be a non-negative integer.',
    );
  }
  return sortOrder;
}

function validateSafeUrl(url: any, fieldName = 'imageUrl'): string | undefined {
  if (url === undefined || url === null || url === '') return undefined;
  if (typeof url !== 'string' || !url.startsWith('https://') || url.length > 500) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} must be a valid secure HTTPS URL under 500 characters.`,
    );
  }
  return url;
}

/**
 * Callable: createCanteen
 * Requires trusted platform operator authorization (Model A & B).
 */
export const createCanteen = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'name', 'code', 'description', 'sortOrder'], 'createCanteen');

    await verifyPlatformOperator(context);

    const canteenId = validateId(data.canteenId, 'canteenId').toUpperCase();
    const name = validateName(data.name, 'Canteen name');
    const code = typeof data.code === 'string' && /^[A-Z0-9_]{2,30}$/.test(data.code)
      ? data.code
      : canteenId.substring(0, 30);
    const description = typeof data.description === 'string' ? data.description.substring(0, 1000) : '';
    const sortOrder = validateSortOrder(data.sortOrder);

    const canteenRef = db.collection('canteens').doc(canteenId);
    const existing = await canteenRef.get();

    const payload = {
      canteenId,
      name,
      code,
      description,
      sortOrder,
      isActive: true,
      updatedAt: serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: serverTimestamp() }),
    };

    await canteenRef.set(payload, { merge: true });

    return {
      success: true,
      message: `Canteen ${canteenId} configured successfully.`,
      canteen: { canteenId, name, code, isActive: true },
    };
  },
);

/**
 * Callable: updateCanteen
 */
export const updateCanteen = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'name', 'code', 'description', 'sortOrder'], 'updateCanteen');

    const canteenId = validateId(data.canteenId, 'canteenId');
    await verifyAdminForCanteen(context, canteenId);

    const canteenRef = db.collection('canteens').doc(canteenId);
    const docSnap = await canteenRef.get();
    if (!docSnap.exists) {
      throw new functions.https.HttpsError('not-found', `Canteen ${canteenId} not found.`);
    }

    const updates: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };

    if (data.name !== undefined) updates.name = validateName(data.name, 'Canteen name');
    if (data.code !== undefined) {
      if (typeof data.code !== 'string' || !/^[A-Z0-9_]{2,30}$/.test(data.code)) {
        throw new functions.https.HttpsError('invalid-argument', 'code must be uppercase alphanumeric (2-30 chars).');
      }
      updates.code = data.code;
    }
    if (data.description !== undefined) {
      updates.description = typeof data.description === 'string' ? data.description.substring(0, 1000) : '';
    }
    if (data.sortOrder !== undefined) {
      updates.sortOrder = validateSortOrder(data.sortOrder);
    }

    await canteenRef.update(updates);
    return { success: true, message: `Canteen ${canteenId} updated successfully.` };
  },
);

/**
 * Callable: setCanteenActive
 */
export const setCanteenActive = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'isActive'], 'setCanteenActive');

    const canteenId = validateId(data.canteenId, 'canteenId');
    if (typeof data.isActive !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'isActive must be a boolean.');
    }

    await verifyAdminForCanteen(context, canteenId);

    const canteenRef = db.collection('canteens').doc(canteenId);
    const docSnap = await canteenRef.get();
    if (!docSnap.exists) {
      throw new functions.https.HttpsError('not-found', `Canteen ${canteenId} not found.`);
    }

    await canteenRef.update({
      isActive: data.isActive,
      updatedAt: serverTimestamp(),
    });

    return { success: true, canteenId, isActive: data.isActive };
  },
);

/**
 * Callable: createCategory
 */
export const createCategory = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'categoryId', 'name', 'sortOrder'], 'createCategory');

    const canteenId = validateId(data.canteenId, 'canteenId');
    const categoryId = validateId(data.categoryId, 'categoryId').toUpperCase();
    await verifyAdminForCanteen(context, canteenId);

    // Validate parent canteen exists and is active
    const canteenDoc = await db.collection('canteens').doc(canteenId).get();
    if (!canteenDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Canteen ${canteenId} does not exist.`);
    }
    if (canteenDoc.data()?.isActive === false) {
      throw new functions.https.HttpsError('failed-precondition', `Canteen ${canteenId} is disabled.`);
    }

    const name = validateName(data.name, 'Category name');
    const sortOrder = validateSortOrder(data.sortOrder);

    const catRef = db.collection('canteens').doc(canteenId).collection('categories').doc(categoryId);
    const existing = await catRef.get();

    const payload = {
      categoryId,
      canteenId,
      name,
      sortOrder,
      isActive: true,
      updatedAt: serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: serverTimestamp() }),
    };

    await catRef.set(payload, { merge: true });

    return {
      success: true,
      message: `Category ${categoryId} saved under canteen ${canteenId}.`,
      category: { categoryId, canteenId, name, sortOrder, isActive: true },
    };
  },
);

/**
 * Callable: updateCategory
 */
export const updateCategory = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'categoryId', 'name', 'sortOrder'], 'updateCategory');

    const canteenId = validateId(data.canteenId, 'canteenId');
    const categoryId = validateId(data.categoryId, 'categoryId');
    await verifyAdminForCanteen(context, canteenId);

    const catRef = db.collection('canteens').doc(canteenId).collection('categories').doc(categoryId);
    const existing = await catRef.get();
    if (!existing.exists) {
      throw new functions.https.HttpsError('not-found', `Category ${categoryId} not found in canteen ${canteenId}.`);
    }

    const updates: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };

    if (data.name !== undefined) updates.name = validateName(data.name, 'Category name');
    if (data.sortOrder !== undefined) updates.sortOrder = validateSortOrder(data.sortOrder);

    await catRef.update(updates);
    return { success: true, message: `Category ${categoryId} updated.` };
  },
);

/**
 * Callable: setCategoryActive
 */
export const setCategoryActive = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'categoryId', 'isActive'], 'setCategoryActive');

    const canteenId = validateId(data.canteenId, 'canteenId');
    const categoryId = validateId(data.categoryId, 'categoryId');
    if (typeof data.isActive !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'isActive must be a boolean.');
    }

    await verifyAdminForCanteen(context, canteenId);

    const catRef = db.collection('canteens').doc(canteenId).collection('categories').doc(categoryId);
    const existing = await catRef.get();
    if (!existing.exists) {
      throw new functions.https.HttpsError('not-found', `Category ${categoryId} not found in canteen ${canteenId}.`);
    }

    await catRef.update({
      isActive: data.isActive,
      updatedAt: serverTimestamp(),
    });

    return { success: true, categoryId, isActive: data.isActive };
  },
);

/**
 * Callable: createMenuItem
 */
export const createMenuItem = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(
      data,
      [
        'canteenId',
        'categoryId',
        'itemId',
        'name',
        'description',
        'priceInPaise',
        'imageUrl',
        'sortOrder',
        'isAvailable',
        'costPriceInPaise',
        'internalNotes',
      ],
      'createMenuItem',
    );

    const canteenId = validateId(data.canteenId, 'canteenId');
    const categoryId = validateId(data.categoryId, 'categoryId');
    const itemId = validateId(data.itemId, 'itemId');
    await verifyAdminForCanteen(context, canteenId);

    // Validate parent canteen exists and is active
    const canteenDoc = await db.collection('canteens').doc(canteenId).get();
    if (!canteenDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Canteen ${canteenId} does not exist.`);
    }
    if (canteenDoc.data()?.isActive === false) {
      throw new functions.https.HttpsError('failed-precondition', `Canteen ${canteenId} is disabled.`);
    }

    // Validate that category exists under this canteen and is active
    const catDoc = await db
      .collection('canteens')
      .doc(canteenId)
      .collection('categories')
      .doc(categoryId)
      .get();
    if (!catDoc.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        `Category ${categoryId} does not exist under canteen ${canteenId}.`,
      );
    }
    if (catDoc.data()?.isActive === false) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Category ${categoryId} is disabled.`,
      );
    }

    const name = validateName(data.name, 'Item name');
    const description = typeof data.description === 'string' ? data.description.substring(0, 1000) : '';
    const priceInPaise = validatePriceInPaise(data.priceInPaise);
    const imageUrl = validateSafeUrl(data.imageUrl);
    const sortOrder = validateSortOrder(data.sortOrder);

    if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'isAvailable must be a boolean.');
    }
    const isAvailable = data.isAvailable !== false; // Default true

    const itemRef = db.collection('canteens').doc(canteenId).collection('items').doc(itemId);
    const existing = await itemRef.get();

    const publicPayload: Record<string, any> = {
      itemId,
      canteenId,
      categoryId,
      name,
      description,
      priceInPaise,
      isAvailable,
      isActive: true,
      sortOrder,
      updatedAt: serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: serverTimestamp() }),
    };
    if (imageUrl) {
      publicPayload.imageUrl = imageUrl;
    }

    await itemRef.set(publicPayload, { merge: true });

    // Handle confidential admin fields if supplied (written strictly to private/admin)
    if (data.costPriceInPaise !== undefined || data.internalNotes !== undefined) {
      const adminSubDoc = itemRef.collection('private').doc('admin');
      const adminPayload: Record<string, any> = {
        updatedAt: serverTimestamp(),
      };
      if (data.costPriceInPaise !== undefined) {
        adminPayload.costPriceInPaise = validatePriceInPaise(data.costPriceInPaise);
      }
      if (data.internalNotes !== undefined) {
        adminPayload.internalNotes = typeof data.internalNotes === 'string' ? data.internalNotes.substring(0, 2000) : '';
      }
      await adminSubDoc.set(adminPayload, { merge: true });
    }

    return {
      success: true,
      message: `Menu item ${itemId} saved successfully.`,
      item: { itemId, canteenId, categoryId, name, priceInPaise, isAvailable, isActive: true },
    };
  },
);

/**
 * Callable: updateMenuItem
 */
export const updateMenuItem = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(
      data,
      ['canteenId', 'itemId', 'name', 'description', 'priceInPaise', 'imageUrl', 'sortOrder'],
      'updateMenuItem',
    );

    const canteenId = validateId(data.canteenId, 'canteenId');
    const itemId = validateId(data.itemId, 'itemId');
    await verifyAdminForCanteen(context, canteenId);

    const itemRef = db.collection('canteens').doc(canteenId).collection('items').doc(itemId);
    const existing = await itemRef.get();
    if (!existing.exists) {
      throw new functions.https.HttpsError('not-found', `Item ${itemId} not found in canteen ${canteenId}.`);
    }

    const updates: Record<string, any> = {
      updatedAt: serverTimestamp(),
    };

    if (data.name !== undefined) updates.name = validateName(data.name, 'Item name');
    if (data.description !== undefined) {
      updates.description = typeof data.description === 'string' ? data.description.substring(0, 1000) : '';
    }
    if (data.priceInPaise !== undefined) updates.priceInPaise = validatePriceInPaise(data.priceInPaise);
    if (data.imageUrl !== undefined) updates.imageUrl = validateSafeUrl(data.imageUrl);
    if (data.sortOrder !== undefined) updates.sortOrder = validateSortOrder(data.sortOrder);

    await itemRef.update(updates);
    return { success: true, message: `Item ${itemId} updated successfully.` };
  },
);

/**
 * Callable: setMenuItemAvailability
 */
export const setMenuItemAvailability = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'itemId', 'isAvailable'], 'setMenuItemAvailability');

    const canteenId = validateId(data.canteenId, 'canteenId');
    const itemId = validateId(data.itemId, 'itemId');
    if (typeof data.isAvailable !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'isAvailable must be a boolean.');
    }

    await verifyAdminForCanteen(context, canteenId);

    const itemRef = db.collection('canteens').doc(canteenId).collection('items').doc(itemId);
    const existing = await itemRef.get();
    if (!existing.exists) {
      throw new functions.https.HttpsError('not-found', `Item ${itemId} not found in canteen ${canteenId}.`);
    }

    await itemRef.update({
      isAvailable: data.isAvailable,
      updatedAt: serverTimestamp(),
    });

    return { success: true, itemId, isAvailable: data.isAvailable };
  },
);

/**
 * Callable: setMenuItemActive
 */
export const setMenuItemActive = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'itemId', 'isActive'], 'setMenuItemActive');

    const canteenId = validateId(data.canteenId, 'canteenId');
    const itemId = validateId(data.itemId, 'itemId');
    if (typeof data.isActive !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'isActive must be a boolean.');
    }

    await verifyAdminForCanteen(context, canteenId);

    const itemRef = db.collection('canteens').doc(canteenId).collection('items').doc(itemId);
    const existing = await itemRef.get();
    if (!existing.exists) {
      throw new functions.https.HttpsError('not-found', `Item ${itemId} not found in canteen ${canteenId}.`);
    }

    await itemRef.update({
      isActive: data.isActive,
      updatedAt: serverTimestamp(),
    });

    return { success: true, itemId, isActive: data.isActive };
  },
);

/**
 * Helper: Asia/Kolkata timezone calculations (UTC + 05:30)
 */
export function getKolkataTime(now = new Date()): {
  dateStr: string;
  timeStr: string;
  totalMinutes: number;
  fullDate: Date;
} {
  const utcMillis = now.getTime() + now.getTimezoneOffset() * 60000;
  const kolkataMillis = utcMillis + 330 * 60000;
  const kolkataDate = new Date(kolkataMillis);

  const year = kolkataDate.getFullYear();
  const month = String(kolkataDate.getMonth() + 1).padStart(2, '0');
  const day = String(kolkataDate.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  const hours = kolkataDate.getHours();
  const minutes = kolkataDate.getMinutes();
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const totalMinutes = hours * 60 + minutes;

  return { dateStr, timeStr, totalMinutes, fullDate: kolkataDate };
}

export function parseTimeToMinutes(timeStr: string): number {
  if (!/^\d{2}:\d{2}$/.test(timeStr)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Invalid time format: ${timeStr}. Expected HH:mm.`,
    );
  }
  const [h, m] = timeStr.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Time out of bounds: ${timeStr}.`,
    );
  }
  return h * 60 + m;
}

export function computeRequestHash(payload: {
  canteenId: string;
  items: Array<{ itemId: string; quantity: number }>;
  pickupSlotId: string;
  paymentMethod: string;
}): string {
  const sortedItems = [...payload.items].sort((a, b) => a.itemId.localeCompare(b.itemId));
  const canonical = JSON.stringify({
    canteenId: payload.canteenId,
    items: sortedItems,
    paymentMethod: payload.paymentMethod,
    pickupSlotId: payload.pickupSlotId,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Callable Function: createPickupSlot (Admin only)
 * Creates or configures a designated pickup slot for a canteen.
 */
export const createPickupSlot = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(
      data,
      ['canteenId', 'slotId', 'date', 'startTime', 'endTime', 'capacity', 'isOpen'],
      'createPickupSlot',
    );
    const canteenId = validateId(data.canteenId, 'canteenId');
    const slotId = validateId(data.slotId, 'slotId');
    await verifyAdminForCanteen(context, canteenId);

    if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      throw new functions.https.HttpsError('invalid-argument', 'date must be in YYYY-MM-DD format.');
    }
    const startMinutes = parseTimeToMinutes(data.startTime);
    const endMinutes = parseTimeToMinutes(data.endTime);
    if (startMinutes >= endMinutes) {
      throw new functions.https.HttpsError('invalid-argument', 'startTime must be before endTime.');
    }
    if (startMinutes < 8 * 60 || endMinutes > 19 * 60) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Pickup slot must be within operating hours (08:00 - 19:00 IST).',
      );
    }
    if (data.capacity !== undefined) {
      if (
        typeof data.capacity !== 'number' ||
        !Number.isInteger(data.capacity) ||
        data.capacity < 1 ||
        data.capacity > 500
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'capacity must be an integer between 1 and 500.',
        );
      }
    }
    const capacity = typeof data.capacity === 'number' ? data.capacity : 30;
    const isOpen = data.isOpen !== false;

    const slotRef = db.collection('canteens').doc(canteenId).collection('pickupSlots').doc(slotId);
    await slotRef.set({
      slotId,
      canteenId,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      timezone: 'Asia/Kolkata',
      isOpen,
      capacity,
      reservedCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { success: true, slotId };
  },
);

/**
 * Callable Function: createOrder (Step 7)
 *
 * Core Security & Invariance:
 * 1. Client sends only validated intent: canteenId, items: [{itemId, quantity}], pickupSlotId, paymentMethod, idempotencyKey.
 * 2. Reject all client-supplied price, unitPrice, lineTotal, subtotal, total, status, or timestamps.
 * 3. Authoritative prices are re-read from Firestore catalog inside an atomic transaction.
 * 4. Slot capacity is checked and reserved transactionally.
 * 5. Submitted cart items in users/{studentUid}/cart/{itemId} are cleared in the same transaction.
 * 6. Deterministic orderId derived from studentUid and idempotencyKey.
 * 7. ALL transaction reads execute BEFORE any transaction writes.
 */
export const createOrder = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required to place an order.',
      );
    }
    const studentUid = context.auth.uid;

    // 2. Reject unknown / forbidden fields
    rejectUnknownFields(
      data,
      ['canteenId', 'items', 'pickupSlotId', 'paymentMethod', 'idempotencyKey'],
      'createOrder',
    );

    // 3. Validate canteenId
    const canteenId = validateId(data.canteenId, 'canteenId');

    // 4. Validate idempotencyKey (36-128 chars)
    if (
      typeof data.idempotencyKey !== 'string' ||
      !/^[a-zA-Z0-9_-]{36,128}$/.test(data.idempotencyKey)
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'idempotencyKey must be a 36-128 character alphanumeric/hyphen/underscore string.',
      );
    }
    const idempotencyKey = data.idempotencyKey;

    // 5. Validate paymentMethod strictly
    if (data.paymentMethod !== 'cash' && data.paymentMethod !== 'upi_demo') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        "paymentMethod must be strictly 'cash' or 'upi_demo'. Live payment is deferred to Step 9.",
      );
    }
    const paymentMethod: 'cash' | 'upi_demo' = data.paymentMethod;

    // 6. Validate pickupSlotId
    const pickupSlotId = validateId(data.pickupSlotId, 'pickupSlotId');

    // 7. Validate items array
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'items must be a non-empty array.',
      );
    }
    if (data.items.length > 50) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Maximum 50 distinct items allowed per order.',
      );
    }

    const seenItemIds = new Set<string>();
    const sanitizedItems: Array<{ itemId: string; quantity: number }> = [];

    for (const item of data.items) {
      if (!item || typeof item !== 'object') {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Each item in items array must be an object.',
        );
      }
      rejectUnknownFields(item, ['itemId', 'quantity'], 'item');
      const itemId = validateId(item.itemId, 'itemId');
      if (seenItemIds.has(itemId)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Duplicate item ${itemId} in items array.`,
        );
      }
      seenItemIds.add(itemId);

      if (
        typeof item.quantity !== 'number' ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Item ${itemId} quantity must be an integer between 1 and 99.`,
        );
      }
      sanitizedItems.push({ itemId, quantity: item.quantity });
    }

    // Compute canonical request hash
    const requestHash = computeRequestHash({
      canteenId,
      items: sanitizedItems,
      pickupSlotId,
      paymentMethod,
    });

    // Derive orderId securely from studentUid and idempotencyKey (32-character hash slice for collision resistance)
    const hashPart = crypto
      .createHash('sha256')
      .update(`${studentUid}:${idempotencyKey}`)
      .digest('hex')
      .substring(0, 32)
      .toUpperCase();
    const orderId = `GNG-${hashPart}`;

    const orderRef = db.collection('orders').doc(orderId);
    const idempotencyRef = db
      .collection('users')
      .doc(studentUid)
      .collection('orderRequests')
      .doc(idempotencyKey);
    const canteenRef = db.collection('canteens').doc(canteenId);
    const slotRef = canteenRef.collection('pickupSlots').doc(pickupSlotId);

    // 8. Execute Firestore Transaction: ALL READS FIRST, THEN ALL WRITES
    const result = await db.runTransaction(async (transaction) => {
      // --- READ 1: Idempotency Record ---
      const existingReq = await transaction.get(idempotencyRef);
      if (existingReq.exists) {
        const reqData = existingReq.data()!;
        if (reqData.requestHash === requestHash) {
          // Idempotent retry: read existing order and return
          const existingOrder = await transaction.get(orderRef);
          if (existingOrder.exists) {
            const ordData = existingOrder.data()!;
            return {
              isRetry: true,
              orderId: ordData.orderId,
              status: ordData.status,
              paymentStatus: ordData.paymentStatus,
              totalInPaise: ordData.totalInPaise,
              subtotalInPaise: ordData.subtotalInPaise,
              pickupSlot: ordData.pickupSlot,
              itemsSnapshot: ordData.itemsSnapshot,
            };
          }
        } else {
          throw new functions.https.HttpsError(
            'already-exists',
            'Idempotency key reuse with differing request parameters.',
          );
        }
      }

      // --- READ 2: Canteen ---
      const canteenSnap = await transaction.get(canteenRef);
      if (!canteenSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Canteen ${canteenId} not found.`);
      }
      const canteenData = canteenSnap.data()!;
      if (canteenData.isActive !== true) {
        throw new functions.https.HttpsError('failed-precondition', `Canteen ${canteenId} is not active.`);
      }

      // --- READ 3: Pickup Slot ---
      const slotSnap = await transaction.get(slotRef);
      if (!slotSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Pickup slot ${pickupSlotId} not found.`);
      }
      const slotData = slotSnap.data()!;
      if (slotData.isOpen !== true) {
        throw new functions.https.HttpsError('failed-precondition', `Pickup slot ${pickupSlotId} is closed.`);
      }

      // Validate slot schema
      if (
        typeof slotData.date !== 'string' ||
        typeof slotData.startTime !== 'string' ||
        typeof slotData.endTime !== 'string' ||
        slotData.timezone !== 'Asia/Kolkata' ||
        typeof slotData.capacity !== 'number' ||
        typeof slotData.reservedCount !== 'number'
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Pickup slot ${pickupSlotId} has invalid configuration.`,
        );
      }

      // Time validation in Asia/Kolkata
      const kolkataTime = getKolkataTime();
      const slotStartMinutes = parseTimeToMinutes(slotData.startTime);
      const slotEndMinutes = parseTimeToMinutes(slotData.endTime);

      // College operating hours: 08:00 to 19:00 IST
      if (slotStartMinutes < 8 * 60 || slotEndMinutes > 19 * 60 || slotStartMinutes >= slotEndMinutes) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Pickup slot ${pickupSlotId} is outside operating hours (08:00 - 19:00 IST).`,
        );
      }

      // Past slot rejection
      if (slotData.date < kolkataTime.dateStr) {
        throw new functions.https.HttpsError('failed-precondition', 'Cannot book a pickup slot in the past.');
      }
      if (slotData.date === kolkataTime.dateStr && slotStartMinutes <= kolkataTime.totalMinutes) {
        throw new functions.https.HttpsError('failed-precondition', 'Pickup slot has already passed for today.');
      }

      // Capacity verification
      if (slotData.reservedCount >= slotData.capacity) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          `Pickup slot ${pickupSlotId} is full (Capacity: ${slotData.capacity}).`,
        );
      }

      // --- READ 4: Cart Items for Cart-Backed Checkout Verification & Clearing ---
      const cartRefs = sanitizedItems.map((i) =>
        db.collection('users').doc(studentUid).collection('cart').doc(i.itemId),
      );
      const cartSnaps = await Promise.all(cartRefs.map((ref) => transaction.get(ref)));

      for (let idx = 0; idx < sanitizedItems.length; idx++) {
        const inputItem = sanitizedItems[idx];
        const cartSnap = cartSnaps[idx];

        if (!cartSnap.exists) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Item ${inputItem.itemId} is not present in your cart. Cart-backed checkout requires all items to exist in cart.`,
          );
        }
        const cartData = cartSnap.data()!;
        if (cartData.canteenId !== canteenId) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Cart item ${inputItem.itemId} belongs to canteen ${cartData.canteenId}, not ${canteenId}.`,
          );
        }
        if (cartData.quantity !== inputItem.quantity) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Quantity mismatch for item ${inputItem.itemId}: cart has ${cartData.quantity}, requested ${inputItem.quantity}.`,
          );
        }
      }

      // --- READ 5: Catalog Items ---
      const itemRefs = sanitizedItems.map((i) =>
        canteenRef.collection('items').doc(i.itemId),
      );
      const itemSnaps = await Promise.all(itemRefs.map((ref) => transaction.get(ref)));

      const itemsSnapshot: Array<{
        itemId: string;
        itemName: string;
        categoryId: string;
        unitPriceInPaise: number;
        quantity: number;
        lineTotalInPaise: number;
      }> = [];

      let subtotalInPaise = 0;

      for (let idx = 0; idx < sanitizedItems.length; idx++) {
        const inputItem = sanitizedItems[idx];
        const snap = itemSnaps[idx];

        if (!snap.exists) {
          throw new functions.https.HttpsError(
            'not-found',
            `Item ${inputItem.itemId} not found in canteen ${canteenId}.`,
          );
        }
        const itemData = snap.data()!;
        if (itemData.isActive !== true) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Item ${itemData.name || inputItem.itemId} is no longer active.`,
          );
        }
        if (itemData.isAvailable !== true) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Item ${itemData.name || inputItem.itemId} is currently out of stock.`,
          );
        }

        const unitPriceInPaise = itemData.priceInPaise;
        if (
          typeof unitPriceInPaise !== 'number' ||
          !Number.isInteger(unitPriceInPaise) ||
          unitPriceInPaise < 0
        ) {
          throw new functions.https.HttpsError(
            'internal',
            `Corrupt price for item ${inputItem.itemId}.`,
          );
        }

        const lineTotalInPaise = unitPriceInPaise * inputItem.quantity;
        subtotalInPaise += lineTotalInPaise;

        itemsSnapshot.push({
          itemId: inputItem.itemId,
          itemName: itemData.name || inputItem.itemId,
          categoryId: itemData.categoryId || '',
          unitPriceInPaise,
          quantity: inputItem.quantity,
          lineTotalInPaise,
        });
      }

      const totalInPaise = subtotalInPaise;

      // ======================================================================
      // ALL READS ARE COMPLETE. NOW PERFORM ALL WRITES.
      // ======================================================================

      const pickupSlotSnapshot = {
        slotId: pickupSlotId,
        pickupDate: slotData.date,
        pickupStartTime: slotData.startTime,
        pickupEndTime: slotData.endTime,
        timezone: 'Asia/Kolkata',
      };

      // Write 1: Order Document
      const newOrderData = {
        orderId,
        studentUid,
        canteenId,
        pickupSlot: pickupSlotSnapshot,
        itemsSnapshot,
        subtotalInPaise,
        totalInPaise,
        currency: 'INR',
        status: 'placed',
        paymentStatus: 'pending',
        paymentMethod,
        idempotencyKey,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      transaction.set(orderRef, newOrderData);

      // Write 2: Idempotency Record
      transaction.set(idempotencyRef, {
        studentUid,
        orderId,
        requestHash,
        totalInPaise,
        status: 'placed',
        createdAt: serverTimestamp(),
      });

      // Write 3: Reserve Slot Capacity
      transaction.update(slotRef, {
        reservedCount: slotData.reservedCount + 1,
        updatedAt: serverTimestamp(),
      });

      // Write 4: Delete submitted items from user's cart
      for (let idx = 0; idx < cartSnaps.length; idx++) {
        transaction.delete(cartRefs[idx]);
      }

      return {
        isRetry: false,
        orderId,
        status: 'placed',
        paymentStatus: 'pending',
        totalInPaise,
        subtotalInPaise,
        pickupSlot: pickupSlotSnapshot,
        itemsSnapshot,
      };
    });

    return {
      success: true,
      ...result,
    };
  },
);


