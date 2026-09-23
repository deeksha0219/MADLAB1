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
        pickupSlotId,
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

      // Write 5: Initial Status History Record
      const initialHistoryRef = orderRef
        .collection('statusHistory')
        .doc(`${orderId}_initial_placed`);
      transaction.set(initialHistoryRef, {
        eventId: `${orderId}_initial_placed`,
        orderId,
        fromStatus: 'none',
        toStatus: 'placed',
        actorUid: studentUid,
        actorRole: 'student',
        canteenId,
        reason: 'Order placed by student',
        createdAt: serverTimestamp(),
      });

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

/**
 * ============================================================================
 * STEP 8: ORDER STATUS TRANSITIONS, ADMIN QUEUE & SEARCH
 * ============================================================================
 */

export const VALID_ORDER_STATUSES = [
  'placed',
  'payment_verified',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'completed',
  'cancelled',
  'rejected',
] as const;
export type OrderStatus = typeof VALID_ORDER_STATUSES[number];

export const VALID_PAYMENT_STATUSES = [
  'pending',
  'processing',
  'succeeded_demo',
  'demo_verified',
  'failed',
  'cancelled',
  'expired',
  'refund_pending',
  'refunded_demo',
] as const;
export type PaymentStatus = typeof VALID_PAYMENT_STATUSES[number];

/**
 * Invariant-enforcing helper for pickup slot capacity release (Step 8 Hardening).
 *
 * Strict Invariants:
 * 1. Read pickup slot document inside the same Firestore transaction as the order transition.
 * 2. reservedCount must exist and be an integer.
 * 3. capacity must exist and be a non-negative integer.
 * 4. Invariant range: reservedCount >= 1 && reservedCount <= capacity.
 * 5. If reservedCount < 1 or any invariant fails, abort transaction with safe error:
 *    "failed-precondition: Pickup slot capacity state is inconsistent."
 * 6. Never silently clamp or convert invalid data to zero.
 * 7. Transaction abort ensures no writes occur to order, slot, or status history.
 * 8. If valid, decrement exactly once: newReservedCount = reservedCount - 1 (validated >= 0).
 */
function validateAndComputeSlotCapacityRelease(
  canteenId: string,
  slotId: string,
  slotSnap: FirebaseFirestore.DocumentSnapshot,
): { newReservedCount: number } {
  if (!slotSnap.exists) {
    console.warn(`[CapacityRelease] Slot doc not found: canteen=${canteenId}, slot=${slotId}`);
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Pickup slot capacity state is inconsistent.',
    );
  }

  const slotData = slotSnap.data();
  const reservedCount = slotData?.reservedCount;
  const capacity = slotData?.capacity;

  if (
    typeof reservedCount !== 'number' ||
    !Number.isInteger(reservedCount) ||
    typeof capacity !== 'number' ||
    !Number.isInteger(capacity) ||
    capacity < 0
  ) {
    console.warn(
      `[CapacityRelease] Malformed capacity fields: reservedCount=${reservedCount}, capacity=${capacity} (canteen=${canteenId}, slot=${slotId})`,
    );
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Pickup slot capacity state is inconsistent.',
    );
  }

  if (reservedCount < 1 || reservedCount > capacity) {
    console.warn(
      `[CapacityRelease] Invariant failed: reservedCount=${reservedCount}, capacity=${capacity} (canteen=${canteenId}, slot=${slotId})`,
    );
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Pickup slot capacity state is inconsistent.',
    );
  }

  const newReservedCount = reservedCount - 1;
  if (newReservedCount < 0) {
    console.warn(
      `[CapacityRelease] Calculation underflow: newReservedCount=${newReservedCount} (canteen=${canteenId}, slot=${slotId})`,
    );
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Pickup slot capacity state is inconsistent.',
    );
  }

  return { newReservedCount };
}

/**
 * Callable Function: transitionOrderStatus (Step 8)
 *
 * Enforces the strict server-side state machine for GrabNGo orders:
 * - Student Cancellation: Allowed strictly for own order while status == 'placed',
 *   paymentStatus == 'pending', and before the pickup slot begins.
 * - Admin Transitions: Active assigned canteen admin can transition:
 *   - placed -> accepted (cash orders only)
 *   - payment_verified -> accepted (online payment orders)
 *   - accepted -> preparing
 *   - preparing -> ready_for_pickup
 *   - ready_for_pickup -> completed
 *   - any active non-terminal state -> cancelled or rejected (with bounded reason)
 * - Capacity Release: Cancellation/rejection before pickup decrements slot reservedCount
 *   transactionally, ensuring reservedCount never drops below 0.
 * - Terminal-State Protection: completed, cancelled, and rejected orders cannot be modified.
 * - Separation of Concerns: Payment status is never modified by this function.
 * - Idempotency: Repeating the exact same transition returns an idempotent success response
 *   without creating duplicate history records.
 */
export const transitionOrderStatus = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required to transition order status.',
      );
    }
    const callerUid = context.auth.uid;

    // 2. Reject unknown & client-injected authoritative fields
    rejectUnknownFields(data, ['orderId', 'nextStatus', 'reason'], 'transitionOrderStatus');

    const orderId = validateId(data.orderId, 'orderId');
    if (
      typeof data.nextStatus !== 'string' ||
      !VALID_ORDER_STATUSES.includes(data.nextStatus as OrderStatus)
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Invalid nextStatus: ${data.nextStatus}. Must be one of: ${VALID_ORDER_STATUSES.join(', ')}.`,
      );
    }
    const nextStatus = data.nextStatus as OrderStatus;

    let reason: string | undefined = undefined;
    if (data.reason !== undefined && data.reason !== null) {
      if (typeof data.reason !== 'string' || data.reason.trim().length === 0 || data.reason.trim().length > 200) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'reason must be a string between 1 and 200 characters.',
        );
      }
      reason = data.reason.trim();
    }

    const orderRef = db.collection('orders').doc(orderId);

    return await db.runTransaction(async (transaction) => {
      // READ 1: Order Document
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;
      const currentStatus = orderData.status as OrderStatus;
      const currentPaymentStatus = orderData.paymentStatus as PaymentStatus;
      const paymentMethod = orderData.paymentMethod;

      // Idempotent retry check: If order already has nextStatus, return cleanly without duplicating history
      if (currentStatus === nextStatus) {
        return {
          success: true,
          isIdempotent: true,
          orderId,
          status: nextStatus,
          paymentStatus: currentPaymentStatus,
        };
      }

      // Terminal State Protection: Once completed, cancelled, or rejected, no further transitions are allowed
      if (['completed', 'cancelled', 'rejected'].includes(currentStatus)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} is in terminal state '${currentStatus}' and cannot be modified.`,
        );
      }

      // READ 2: Caller Admin Profile (if not student owner)
      const isStudentOwner = orderData.studentUid === callerUid;
      let isAdmin = false;
      let actorRole: 'student' | 'canteen_admin' = 'student';

      const adminSnap = await transaction.get(db.collection('admins').doc(callerUid));
      if (adminSnap.exists && adminSnap.data()?.status === 'active') {
        const adminData = adminSnap.data()!;
        if (
          adminData.role === 'platform_operator' ||
          adminData.isOperator === true ||
          (Array.isArray(adminData.canteenIds) && adminData.canteenIds.includes(orderData.canteenId))
        ) {
          isAdmin = true;
          actorRole = 'canteen_admin';
        }
      }

      // Authorization & State Machine Enforcement
      if (isStudentOwner && !isAdmin) {
        // --- STUDENT CANCELLATION RULES ---
        if (nextStatus !== 'cancelled') {
          throw new functions.https.HttpsError(
            'permission-denied',
            'Students are only authorized to cancel their own orders.',
          );
        }

        // Rule: Only while status == 'placed'
        if (currentStatus !== 'placed') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Students can only cancel orders in 'placed' status. Current status is '${currentStatus}'.`,
          );
        }

        // Rule: Only while paymentStatus == 'pending'
        if (currentPaymentStatus !== 'pending') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Orders with verified or completed payment cannot be self-cancelled by students.',
          );
        }

        // Rule: Only before the pickup slot begins
        const kolkataTime = getKolkataTime();
        const slotDate = orderData.pickupSlot?.pickupDate;
        const slotStartTime = orderData.pickupSlot?.pickupStartTime;
        if (slotDate && slotStartTime) {
          const slotStartMinutes = parseTimeToMinutes(slotStartTime);
          const isPastOrBegun =
            slotDate < kolkataTime.dateStr ||
            (slotDate === kolkataTime.dateStr && slotStartMinutes <= kolkataTime.totalMinutes);

          if (isPastOrBegun) {
            throw new functions.https.HttpsError(
              'failed-precondition',
              'Cannot cancel order after the pickup slot has already begun or passed.',
            );
          }
        }
      } else if (isAdmin) {
        // --- ADMIN TRANSITION RULES ---
        let allowedNext: OrderStatus[] = [];

        if (currentStatus === 'placed') {
          if (paymentMethod === 'cash') {
            // Cash orders skip payment_verified and can be directly accepted by admin
            allowedNext = ['accepted', 'cancelled', 'rejected'];
          } else {
            // Online orders must have payment verified before admin can accept
            allowedNext = ['cancelled', 'rejected'];
          }
        } else if (currentStatus === 'payment_verified') {
          allowedNext = ['accepted', 'cancelled', 'rejected'];
        } else if (currentStatus === 'accepted') {
          allowedNext = ['preparing', 'cancelled', 'rejected'];
        } else if (currentStatus === 'preparing') {
          allowedNext = ['ready_for_pickup', 'cancelled', 'rejected'];
        } else if (currentStatus === 'ready_for_pickup') {
          allowedNext = ['completed', 'cancelled', 'rejected'];
        }

        if (!allowedNext.includes(nextStatus)) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Invalid status transition from '${currentStatus}' to '${nextStatus}' for order with paymentMethod '${paymentMethod}'.`,
          );
        }

        // Rule: Cancellation or completion after pickup slot has ended
        // Rejection / cancellation requires a reason from admin
        if ((nextStatus === 'cancelled' || nextStatus === 'rejected') && !reason) {
          reason = `Order ${nextStatus} by canteen administrator.`;
        }
      } else {
        throw new functions.https.HttpsError(
          'permission-denied',
          `Caller is not authorized to transition status for order ${orderId} in canteen ${orderData.canteenId}.`,
        );
      }

      // READ 3 & INVARIANT VALIDATION: Pickup Slot for Capacity Release (on cancellation / rejection)
      const isCancellationOrRejection = nextStatus === 'cancelled' || nextStatus === 'rejected';
      const slotId = orderData.pickupSlotId || orderData.pickupSlot?.slotId;
      let slotRef: FirebaseFirestore.DocumentReference | null = null;
      let validatedNewReservedCount: number | null = null;

      if (isCancellationOrRejection && slotId && typeof slotId === 'string' && slotId.trim().length > 0) {
        slotRef = db
          .collection('canteens')
          .doc(orderData.canteenId)
          .collection('pickupSlots')
          .doc(slotId);
        const slotSnap = await transaction.get(slotRef);
        const releaseResult = validateAndComputeSlotCapacityRelease(
          orderData.canteenId,
          slotId,
          slotSnap,
        );
        validatedNewReservedCount = releaseResult.newReservedCount;
      }

      // READ 4: Payment doc for demo refund if order was paid (Step 9 Ordering)
      let activePaidPaymentSnap: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      if (isCancellationOrRejection && currentPaymentStatus === 'succeeded_demo') {
        const paidPaymentsQuery = await transaction.get(
          orderRef.collection('payments').where('status', '==', 'succeeded_demo').limit(1),
        );
        if (!paidPaymentsQuery.empty) {
          activePaidPaymentSnap = paidPaymentsQuery.docs[0];
        }
      }

      // ======================================================================
      // ALL READS & INVARIANT VALIDATIONS COMPLETE -> PERFORM ATOMIC WRITES
      // ======================================================================

      // Write 1: Update order status (and paymentStatus if demo refund initiated)
      const nextPaymentStatus =
        isCancellationOrRejection && currentPaymentStatus === 'succeeded_demo'
          ? 'refund_pending'
          : currentPaymentStatus;

      transaction.update(orderRef, {
        status: nextStatus,
        paymentStatus: nextPaymentStatus,
        updatedAt: serverTimestamp(),
      });

      // Write 2: Decrement slot capacity reservedCount (exactly once, validated newReservedCount >= 0)
      if (slotRef && validatedNewReservedCount !== null) {
        transaction.update(slotRef, {
          reservedCount: validatedNewReservedCount,
          updatedAt: serverTimestamp(),
        });
      }

      // Write 3: Append deterministic immutable status history entry
      const eventId = `${orderId}_${currentStatus}_to_${nextStatus}`;
      const historyRef = orderRef.collection('statusHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        orderId,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        actorUid: callerUid,
        actorRole,
        canteenId: orderData.canteenId,
        reason: reason || (isStudentOwner ? 'Cancelled by student' : `Status updated to ${nextStatus}`),
        createdAt: serverTimestamp(),
      });

      // Write 4: Process demo refund state & write payment history (Step 9 Ordering)
      if (activePaidPaymentSnap) {
        const paymentId = activePaidPaymentSnap.id;
        const paymentRef = orderRef.collection('payments').doc(paymentId);
        transaction.update(paymentRef, {
          status: 'refund_pending',
          updatedAt: serverTimestamp(),
        });

        const refundHistoryEventId = `${paymentId}_refund_pending`;
        const paymentHistoryRef = orderRef.collection('paymentHistory').doc(refundHistoryEventId);
        transaction.set(paymentHistoryRef, {
          eventId: refundHistoryEventId,
          paymentId,
          orderId,
          fromStatus: 'succeeded_demo',
          toStatus: 'refund_pending',
          actorUid: callerUid,
          actorRole,
          canteenId: orderData.canteenId,
          reason: `Demo refund initiated upon order ${nextStatus}`,
          createdAt: serverTimestamp(),
        });
      }

      return {
        success: true,
        isIdempotent: false,
        orderId,
        fromStatus: currentStatus,
        status: nextStatus,
        paymentStatus: nextPaymentStatus,
      };
    });
  },
);

/**
 * Callable Function: verifyDemoPayment (Step 8 — Emulator-Only Demo Behavior)
 *
 * Simulates verified online payment for UPI demo checkout strictly within the local emulator.
 * RESTRICTED: Will fail with failed-precondition if FUNCTIONS_EMULATOR !== 'true'.
 * Does not use, accept, or process real payment credentials.
 */
export const verifyDemoPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'verifyDemoPayment is an emulator-only testing helper and is disabled in cloud environments.',
      );
    }

    // 2. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required to verify demo payment.',
      );
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(data, ['orderId'], 'verifyDemoPayment');
    const orderId = validateId(data.orderId, 'orderId');
    const orderRef = db.collection('orders').doc(orderId);

    return await db.runTransaction(async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      // Ownership check: Student owner or assigned admin
      if (orderData.studentUid !== callerUid) {
        const adminSnap = await transaction.get(db.collection('admins').doc(callerUid));
        const isAdmin =
          adminSnap.exists &&
          adminSnap.data()?.status === 'active' &&
          (adminSnap.data()?.canteenIds?.includes(orderData.canteenId) ||
            adminSnap.data()?.role === 'platform_operator');
        if (!isAdmin) {
          throw new functions.https.HttpsError(
            'permission-denied',
            'Only the order owner or assigned admin can verify demo payment.',
          );
        }
      }

      // Preconditions
      if (orderData.paymentMethod !== 'upi_demo') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Cannot verify demo online payment for order with paymentMethod '${orderData.paymentMethod}'.`,
        );
      }
      if (orderData.status !== 'placed') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} is in status '${orderData.status}'. Demo payment verification requires status == 'placed'.`,
        );
      }
      if (orderData.paymentStatus !== 'pending') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} paymentStatus is already '${orderData.paymentStatus}'.`,
        );
      }

      // Write 1: Update paymentStatus and order status
      transaction.update(orderRef, {
        paymentStatus: 'demo_verified',
        status: 'payment_verified',
        updatedAt: serverTimestamp(),
      });

      // Write 2: Add deterministic history entry
      const eventId = `${orderId}_placed_to_payment_verified`;
      const historyRef = orderRef.collection('statusHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        orderId,
        fromStatus: 'placed',
        toStatus: 'payment_verified',
        actorUid: callerUid,
        actorRole: 'demo_payment_gateway',
        canteenId: orderData.canteenId,
        reason: 'Demo UPI payment verified locally in emulator',
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        orderId,
        status: 'payment_verified',
        paymentStatus: 'demo_verified',
      };
    });
  },
);

/**
 * Callable Function: getAdminOrderQueue (Step 8)
 *
 * Fetches order queue for an assigned canteen with server-side authorization,
 * status filtering, bounded pagination (max 50 records), and masked customer identifiers.
 */
export const getAdminOrderQueue = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(
      data,
      ['canteenId', 'status', 'limit', 'startAfterOrderId'],
      'getAdminOrderQueue',
    );

    const canteenId = validateId(data.canteenId, 'canteenId');
    await verifyAdminForCanteen(context, canteenId);

    const limitCount =
      typeof data.limit === 'number' && Number.isInteger(data.limit) && data.limit > 0 && data.limit <= 50
        ? data.limit
        : 20;

    let query: FirebaseFirestore.Query = db
      .collection('orders')
      .where('canteenId', '==', canteenId);

    if (data.status) {
      if (!VALID_ORDER_STATUSES.includes(data.status)) {
        throw new functions.https.HttpsError('invalid-argument', `Invalid filter status: ${data.status}.`);
      }
      query = query.where('status', '==', data.status);
    }

    query = query.orderBy('createdAt', 'desc').limit(limitCount);

    if (data.startAfterOrderId) {
      const cursorDoc = await db.collection('orders').doc(data.startAfterOrderId).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();

    const orders = snapshot.docs.map((doc) => {
      const d = doc.data();
      // Mask customer UID to protect student privacy: e.g. "student_...a1b2"
      const rawUid = typeof d.studentUid === 'string' ? d.studentUid : '';
      const maskedCustomer = rawUid ? `student_...${rawUid.slice(-4)}` : 'anonymous_student';

      return {
        orderId: d.orderId || doc.id,
        referenceId: d.orderId || doc.id,
        canteenId: d.canteenId,
        status: d.status,
        paymentStatus: d.paymentStatus,
        paymentMethod: d.paymentMethod,
        totalInPaise: d.totalInPaise,
        pickupSlot: d.pickupSlot,
        itemsSnapshot: d.itemsSnapshot,
        maskedCustomer,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    });

    return {
      success: true,
      canteenId,
      count: orders.length,
      orders,
    };
  },
);

/**
 * Callable Function: searchAdminOrder (Step 8)
 *
 * Performs exact-match order lookup for canteen staff.
 * Enforces canteen isolation: will return NOT_FOUND if order belongs to another canteen,
 * preventing cross-canteen order probing. Exposes masked customer identifier.
 */
export const searchAdminOrder = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId', 'queryOrderId'], 'searchAdminOrder');

    const canteenId = validateId(data.canteenId, 'canteenId');
    const queryOrderId = validateId(data.queryOrderId, 'queryOrderId');
    await verifyAdminForCanteen(context, canteenId);

    const docSnap = await db.collection('orders').doc(queryOrderId).get();
    if (!docSnap.exists || docSnap.data()?.canteenId !== canteenId) {
      throw new functions.https.HttpsError(
        'not-found',
        `Order ${queryOrderId} not found in canteen ${canteenId}.`,
      );
    }

    const d = docSnap.data()!;
    const rawUid = typeof d.studentUid === 'string' ? d.studentUid : '';
    const maskedCustomer = rawUid ? `student_...${rawUid.slice(-4)}` : 'anonymous_student';

    return {
      success: true,
      order: {
        orderId: d.orderId || docSnap.id,
        referenceId: d.orderId || docSnap.id,
        canteenId: d.canteenId,
        status: d.status,
        paymentStatus: d.paymentStatus,
        paymentMethod: d.paymentMethod,
        totalInPaise: d.totalInPaise,
        pickupSlot: d.pickupSlot,
        itemsSnapshot: d.itemsSnapshot,
        maskedCustomer,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      },
    };
  },
);

// ============================================================================
// STEP 9: PAYMENT INTEGRATION FOUNDATION, DEMO PAYMENTS, & SECURITY
// ============================================================================

export type DemoPaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded_demo'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refund_pending'
  | 'refunded_demo';

function sanitizeFailureCode(code: any): string {
  if (typeof code !== 'string' || !/^[A-Z0-9_]{3,32}$/.test(code)) {
    return 'PAYMENT_FAILED_DEMO';
  }
  return code;
}

function sanitizeFailureMessage(msg: any): string {
  if (typeof msg !== 'string' || msg.trim().length === 0) {
    return 'Simulated demo payment failure.';
  }
  // Max 200 characters (Correction 9)
  return msg.trim().slice(0, 200);
}

/**
 * Callable Function: createDemoPayment (Step 9)
 *
 * Initiates an idempotent demo payment attempt for an order in 'placed' status.
 * Server derives amount directly from immutable order totalInPaise.
 * Enforces max 1 active attempt and max 3 failed attempts per order.
 */
export const createDemoPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required to initiate demo payment.',
      );
    }
    const studentUid = context.auth.uid;

    // 2. Reject unknown fields
    rejectUnknownFields(data, ['orderId', 'idempotencyKey'], 'createDemoPayment');

    const orderId = validateId(data.orderId, 'orderId');

    // Validate idempotencyKey (36-128 chars regex - Correction 9)
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

    const orderRef = db.collection('orders').doc(orderId);
    const idempotencyRef = db
      .collection('users')
      .doc(studentUid)
      .collection('paymentRequests')
      .doc(idempotencyKey);

    return await db.runTransaction(async (transaction) => {
      // READ 1: Order
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      // Ownership check: must belong to authenticated student
      if (orderData.studentUid !== studentUid) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'You are not authorized to create payment for another student order.',
        );
      }

      // Precondition: Order payment method must be upi_demo
      if (orderData.paymentMethod !== 'upi_demo') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order paymentMethod is '${orderData.paymentMethod}'. Demo online payment requires 'upi_demo'.`,
        );
      }

      // Precondition: Order must be in status 'placed'
      if (orderData.status !== 'placed') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} is in status '${orderData.status}'. Payment can only be initiated for orders in 'placed' status.`,
        );
      }

      // READ 2: Idempotency Record
      const idempSnap = await transaction.get(idempotencyRef);
      if (idempSnap.exists) {
        const idempData = idempSnap.data()!;
        if (idempData.orderId === orderId) {
          // Exact replay: return existing payment attempt
          const existingPaymentSnap = await transaction.get(
            orderRef.collection('payments').doc(idempData.paymentId),
          );
          if (existingPaymentSnap.exists) {
            const pData = existingPaymentSnap.data()!;
            return {
              success: true,
              isRetry: true,
              paymentId: pData.paymentId,
              orderId,
              status: pData.status,
              amountInPaise: pData.amountInPaise,
              currency: 'INR',
              providerReference: pData.providerReference,
            };
          }
        }
        // Different payload under same key: reject
        throw new functions.https.HttpsError(
          'already-exists',
          `Idempotency key ${idempotencyKey} has already been used for another payment request.`,
        );
      }

      // READ 3: Existing Payment Attempts for this order
      const paymentsSnap = await transaction.get(orderRef.collection('payments'));
      const existingPayments = paymentsSnap.docs.map((d) => d.data());

      // Rule: Order must not already have a succeeded_demo payment
      const hasSucceeded = existingPayments.some((p) => p.status === 'succeeded_demo');
      if (hasSucceeded || orderData.paymentStatus === 'succeeded_demo') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} has already been successfully paid.`,
        );
      }

      // Rule: Max 1 active attempt (pending or processing) (Correction 9)
      const hasActive = existingPayments.some(
        (p) => p.status === 'pending' || p.status === 'processing',
      );
      if (hasActive) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `An active payment attempt is already in progress for order ${orderId}.`,
        );
      }

      // Rule: Max 3 failed attempts per order (Correction 9)
      const failedCount = existingPayments.filter((p) => p.status === 'failed').length;
      if (failedCount >= 3) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Maximum failed payment attempts (3) exceeded for order ${orderId}. Please contact support or pay at counter.`,
        );
      }

      // Validations passed: generate new payment attempt
      const attemptNumber = existingPayments.length + 1;
      const paymentId = `PAY-${orderId.replace(/^GNG-/, '')}-${attemptNumber}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const providerReference = `DEMO-UPI-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
      const amountInPaise = orderData.totalInPaise;

      if (typeof amountInPaise !== 'number' || !Number.isInteger(amountInPaise) || amountInPaise <= 0) {
        throw new functions.https.HttpsError('internal', 'Corrupted order amount.');
      }

      // Write 1: Payment Record (orders/{orderId}/payments/{paymentId})
      const paymentRef = orderRef.collection('payments').doc(paymentId);
      transaction.set(paymentRef, {
        paymentId,
        orderId,
        studentUid,
        canteenId: orderData.canteenId,
        amountInPaise,
        currency: 'INR',
        paymentMethod: 'upi_demo',
        provider: 'demo',
        status: 'pending',
        attemptNumber,
        idempotencyKey,
        providerReference,
        failureCode: null,
        failureMessage: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        completedAt: null,
      });

      // Write 2: Deterministic Payment History Event ({paymentId}_created - Correction 6)
      const eventId = `${paymentId}_created`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: 'none',
        toStatus: 'pending',
        actorUid: studentUid,
        actorRole: 'student',
        canteenId: orderData.canteenId,
        reason: `Demo payment attempt ${attemptNumber} initiated`,
        createdAt: serverTimestamp(),
      });

      // Write 3: Idempotency Record (users/{studentUid}/paymentRequests/{idempotencyKey})
      transaction.set(idempotencyRef, {
        idempotencyKey,
        studentUid,
        orderId,
        paymentId,
        paymentMethod: 'upi_demo',
        amountInPaise,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        success: true,
        isRetry: false,
        paymentId,
        orderId,
        status: 'pending',
        amountInPaise,
        currency: 'INR',
        providerReference,
      };
    });
  },
);

/**
 * Callable Function: completeDemoPayment (Step 9 — Emulator Only)
 *
 * Atomically marks payment attempt succeeded_demo and order status payment_verified.
 * Strictly guarded by FUNCTIONS_EMULATOR === 'true'.
 * Prevents duplicate completion and guarantees failed attempts cannot be completed.
 */
export const completeDemoPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard (Correction 3)
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'completeDemoPayment is an emulator-only testing helper and is disabled in cloud environments.',
      );
    }

    // 2. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(data, ['orderId', 'paymentId'], 'completeDemoPayment');
    const orderId = validateId(data.orderId, 'orderId');
    const paymentId = validateId(data.paymentId, 'paymentId');

    const orderRef = db.collection('orders').doc(orderId);
    const paymentRef = orderRef.collection('payments').doc(paymentId);

    return await db.runTransaction(async (transaction) => {
      // READ 1: Order
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      // Ownership: Student owner or assigned admin
      const isStudentOwner = orderData.studentUid === callerUid;
      let isAdmin = false;
      if (!isStudentOwner) {
        const adminSnap = await transaction.get(db.collection('admins').doc(callerUid));
        isAdmin =
          adminSnap.exists &&
          adminSnap.data()?.status === 'active' &&
          (adminSnap.data()?.canteenIds?.includes(orderData.canteenId) ||
            adminSnap.data()?.role === 'platform_operator');
        if (!isAdmin) {
          throw new functions.https.HttpsError(
            'permission-denied',
            'Caller is not authorized to complete payment for this order.',
          );
        }
      }

      // READ 2: Payment Document
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          `Payment ${paymentId} not found under order ${orderId}.`,
        );
      }
      const paymentData = paymentSnap.data()!;

      // Rule: Successful retry returns original result (Correction 5)
      if (paymentData.status === 'succeeded_demo') {
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          status: 'succeeded_demo',
          orderStatus: 'payment_verified',
        };
      }

      // Rule: Failed or cancelled attempts are IMMUTABLE; cannot transition to succeeded_demo (Correction 4)
      if (paymentData.status === 'failed' || paymentData.status === 'cancelled') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment attempt ${paymentId} has status '${paymentData.status}' and cannot be completed. A new payment attempt is required.`,
        );
      }

      // Rule: Payment must be pending or processing
      if (paymentData.status !== 'pending' && paymentData.status !== 'processing') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Invalid payment status transition from '${paymentData.status}' to 'succeeded_demo'.`,
        );
      }

      // Rule: Order must be in 'placed' status (Correction 5: prevent duplicate success)
      if (orderData.status !== 'placed') {
        if (orderData.status === 'payment_verified' || orderData.paymentStatus === 'succeeded_demo') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Order ${orderId} has already been paid and verified. Duplicate payment rejected.`,
          );
        }
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} is in status '${orderData.status}'. Payment completion requires order status 'placed'.`,
        );
      }

      // Write 1: Update Payment Document
      transaction.update(paymentRef, {
        status: 'succeeded_demo',
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      });

      // Write 2: Update Order Status & PaymentStatus atomically
      transaction.update(orderRef, {
        status: 'payment_verified',
        paymentStatus: 'succeeded_demo',
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_succeeded_demo - Correction 6)
      const payHistoryEventId = `${paymentId}_succeeded_demo`;
      const payHistoryRef = orderRef.collection('paymentHistory').doc(payHistoryEventId);
      transaction.set(payHistoryRef, {
        eventId: payHistoryEventId,
        paymentId,
        orderId,
        fromStatus: paymentData.status,
        toStatus: 'succeeded_demo',
        actorUid: callerUid,
        actorRole: isAdmin ? 'admin' : 'demo_payment_gateway',
        canteenId: orderData.canteenId,
        reason: 'Demo UPI payment completed successfully in emulator',
        createdAt: serverTimestamp(),
      });

      // Write 4: Deterministic Order Status History Event (exactly one event - Correction 5)
      const orderHistoryEventId = `${orderId}_placed_to_payment_verified`;
      const orderHistoryRef = orderRef.collection('statusHistory').doc(orderHistoryEventId);
      transaction.set(orderHistoryRef, {
        eventId: orderHistoryEventId,
        orderId,
        fromStatus: 'placed',
        toStatus: 'payment_verified',
        actorUid: callerUid,
        actorRole: isAdmin ? 'admin' : 'demo_payment_gateway',
        canteenId: orderData.canteenId,
        reason: 'Demo UPI payment verified locally in emulator',
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        isRetry: false,
        orderId,
        paymentId,
        status: 'succeeded_demo',
        orderStatus: 'payment_verified',
      };
    });
  },
);

/**
 * Callable Function: failDemoPayment (Step 9 — Emulator Only)
 *
 * Transitions payment attempt to 'failed' with sanitized failureCode & failureMessage.
 * Order status remains 'placed', paymentStatus updated to 'failed'.
 * Failed records are immutable.
 */
export const failDemoPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard (Correction 3)
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'failDemoPayment is an emulator-only testing helper.',
      );
    }

    // 2. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(
      data,
      ['orderId', 'paymentId', 'failureCode', 'failureMessage'],
      'failDemoPayment',
    );
    const orderId = validateId(data.orderId, 'orderId');
    const paymentId = validateId(data.paymentId, 'paymentId');
    const failureCode = sanitizeFailureCode(data.failureCode);
    const failureMessage = sanitizeFailureMessage(data.failureMessage);

    const orderRef = db.collection('orders').doc(orderId);
    const paymentRef = orderRef.collection('payments').doc(paymentId);

    return await db.runTransaction(async (transaction) => {
      // READ 1: Order
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      // Ownership: Student owner or assigned admin
      const isStudentOwner = orderData.studentUid === callerUid;
      if (!isStudentOwner) {
        const adminSnap = await transaction.get(db.collection('admins').doc(callerUid));
        const isAdmin =
          adminSnap.exists &&
          adminSnap.data()?.status === 'active' &&
          (adminSnap.data()?.canteenIds?.includes(orderData.canteenId) ||
            adminSnap.data()?.role === 'platform_operator');
        if (!isAdmin) {
          throw new functions.https.HttpsError('permission-denied', 'Not authorized.');
        }
      }

      // READ 2: Payment
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Payment ${paymentId} not found.`);
      }
      const paymentData = paymentSnap.data()!;

      // Idempotency: If already failed with same code/msg, return safe result
      if (paymentData.status === 'failed') {
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          status: 'failed',
          failureCode: paymentData.failureCode,
          failureMessage: paymentData.failureMessage,
        };
      }

      // Precondition: Cannot fail a succeeded_demo payment
      if (paymentData.status === 'succeeded_demo') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Cannot mark a succeeded payment as failed.',
        );
      }

      // Must be pending or processing
      if (paymentData.status !== 'pending' && paymentData.status !== 'processing') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment in status '${paymentData.status}' cannot transition to 'failed'.`,
        );
      }

      // Write 1: Update payment record
      transaction.update(paymentRef, {
        status: 'failed',
        failureCode,
        failureMessage,
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      });

      // Write 2: Update order paymentStatus (Order status remains 'placed'!)
      transaction.update(orderRef, {
        paymentStatus: 'failed',
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_failed - Correction 6)
      const eventId = `${paymentId}_failed`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: paymentData.status,
        toStatus: 'failed',
        actorUid: callerUid,
        actorRole: 'demo_payment_gateway',
        canteenId: orderData.canteenId,
        reason: `Payment failed: [${failureCode}] ${failureMessage}`,
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        isRetry: false,
        orderId,
        paymentId,
        status: 'failed',
        failureCode,
        failureMessage,
      };
    });
  },
);

/**
 * Callable Function: cancelDemoPayment (Step 9 — Emulator Only)
 *
 * Cancels a pending or processing demo payment attempt on student request.
 */
export const cancelDemoPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard (Correction 3)
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'cancelDemoPayment is an emulator-only testing helper.',
      );
    }

    // 2. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(data, ['orderId', 'paymentId', 'reason'], 'cancelDemoPayment');
    const orderId = validateId(data.orderId, 'orderId');
    const paymentId = validateId(data.paymentId, 'paymentId');
    const reason =
      typeof data.reason === 'string' && data.reason.trim().length > 0
        ? data.reason.trim().slice(0, 200)
        : 'Payment cancelled by user';

    const orderRef = db.collection('orders').doc(orderId);
    const paymentRef = orderRef.collection('payments').doc(paymentId);

    return await db.runTransaction(async (transaction) => {
      // READ 1: Order
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      // Ownership: Student only
      if (orderData.studentUid !== callerUid) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Only the student owner can cancel their payment attempt.',
        );
      }

      // READ 2: Payment
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Payment ${paymentId} not found.`);
      }
      const paymentData = paymentSnap.data()!;

      // Idempotency
      if (paymentData.status === 'cancelled') {
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          status: 'cancelled',
        };
      }

      if (paymentData.status !== 'pending' && paymentData.status !== 'processing') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment in status '${paymentData.status}' cannot be cancelled.`,
        );
      }

      // Write 1: Update payment
      transaction.update(paymentRef, {
        status: 'cancelled',
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      });

      // Write 2: Update order paymentStatus
      transaction.update(orderRef, {
        paymentStatus: 'cancelled',
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_cancelled - Correction 6)
      const eventId = `${paymentId}_cancelled`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: paymentData.status,
        toStatus: 'cancelled',
        actorUid: callerUid,
        actorRole: 'student',
        canteenId: orderData.canteenId,
        reason,
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        isRetry: false,
        orderId,
        paymentId,
        status: 'cancelled',
      };
    });
  },
);

/**
 * Callable Function: getPaymentStatus (Step 9)
 *
 * Retrieves sanitized payment details with ownership authorization.
 * Limits admin reads to required operational fields (Correction 8).
 */
export const getPaymentStatus = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(data, ['orderId', 'paymentId'], 'getPaymentStatus');
    const orderId = validateId(data.orderId, 'orderId');
    const paymentId = validateId(data.paymentId, 'paymentId');

    const orderSnap = await db.collection('orders').doc(orderId).get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
    }
    const orderData = orderSnap.data()!;

    const isStudentOwner = orderData.studentUid === callerUid;
    let isAdmin = false;
    if (!isStudentOwner) {
      const adminSnap = await db.collection('admins').doc(callerUid).get();
      isAdmin =
        adminSnap.exists &&
        adminSnap.data()?.status === 'active' &&
        (adminSnap.data()?.canteenIds?.includes(orderData.canteenId) ||
          adminSnap.data()?.role === 'platform_operator');
      if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Not authorized to view payment.');
      }
    }

    const paymentSnap = await db
      .collection('orders')
      .doc(orderId)
      .collection('payments')
      .doc(paymentId)
      .get();

    if (!paymentSnap.exists) {
      throw new functions.https.HttpsError('not-found', `Payment ${paymentId} not found.`);
    }
    const p = paymentSnap.data()!;

    // Admin view: operational fields only, no synthetic provider references or internal codes (Correction 8)
    if (isAdmin && !isStudentOwner) {
      return {
        success: true,
        payment: {
          paymentId: p.paymentId,
          orderId: p.orderId,
          canteenId: p.canteenId,
          status: p.status,
          amountInPaise: p.amountInPaise,
          currency: p.currency,
          paymentMethod: p.paymentMethod,
          attemptNumber: p.attemptNumber,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          completedAt: p.completedAt,
        },
      };
    }

    // Student view: full sanitized client fields
    return {
      success: true,
      payment: {
        paymentId: p.paymentId,
        orderId: p.orderId,
        canteenId: p.canteenId,
        status: p.status,
        amountInPaise: p.amountInPaise,
        currency: p.currency,
        paymentMethod: p.paymentMethod,
        attemptNumber: p.attemptNumber,
        providerReference: p.providerReference,
        failureCode: p.failureCode,
        failureMessage: p.failureMessage,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        completedAt: p.completedAt,
      },
    };
  },
);

/**
 * Callable Function: requestDemoRefund (Step 9 — Emulator Only)
 *
 * Requests demo refund for an order that is cancelled or rejected after payment succeeded.
 * Strictly emulator-only.
 */
export const requestDemoRefund = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard (Correction 3)
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'requestDemoRefund is an emulator-only testing helper.',
      );
    }

    // 2. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(data, ['orderId', 'paymentId', 'reason'], 'requestDemoRefund');
    const orderId = validateId(data.orderId, 'orderId');
    const paymentId = validateId(data.paymentId, 'paymentId');
    const reason =
      typeof data.reason === 'string' && data.reason.trim().length > 0
        ? data.reason.trim().slice(0, 200)
        : 'Demo refund requested';

    const orderRef = db.collection('orders').doc(orderId);
    const paymentRef = orderRef.collection('payments').doc(paymentId);

    return await db.runTransaction(async (transaction) => {
      // READ 1: Order
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      // Ownership: Student owner or assigned admin
      const isStudentOwner = orderData.studentUid === callerUid;
      let isAdmin = false;
      if (!isStudentOwner) {
        const adminSnap = await transaction.get(db.collection('admins').doc(callerUid));
        isAdmin =
          adminSnap.exists &&
          adminSnap.data()?.status === 'active' &&
          (adminSnap.data()?.canteenIds?.includes(orderData.canteenId) ||
            adminSnap.data()?.role === 'platform_operator');
        if (!isAdmin) {
          throw new functions.https.HttpsError('permission-denied', 'Not authorized.');
        }
      }

      // Precondition: Order must be in terminal state 'cancelled' or 'rejected'
      if (orderData.status !== 'cancelled' && orderData.status !== 'rejected') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} has status '${orderData.status}'. Refund can only be requested for cancelled or rejected orders.`,
        );
      }

      // READ 2: Payment
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Payment ${paymentId} not found.`);
      }
      const paymentData = paymentSnap.data()!;

      // Idempotency
      if (paymentData.status === 'refund_pending') {
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          status: 'refund_pending',
        };
      }
      if (paymentData.status === 'refunded_demo') {
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          status: 'refunded_demo',
        };
      }

      // Must be succeeded_demo
      if (paymentData.status !== 'succeeded_demo') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment in status '${paymentData.status}' is not eligible for refund. Must be 'succeeded_demo'.`,
        );
      }

      // Write 1: Update payment status to refund_pending
      transaction.update(paymentRef, {
        status: 'refund_pending',
        updatedAt: serverTimestamp(),
      });

      // Write 2: Update order paymentStatus
      transaction.update(orderRef, {
        paymentStatus: 'refund_pending',
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_refund_pending - Correction 6)
      const eventId = `${paymentId}_refund_pending`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: 'succeeded_demo',
        toStatus: 'refund_pending',
        actorUid: callerUid,
        actorRole: isAdmin ? 'admin' : 'student',
        canteenId: orderData.canteenId,
        reason,
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        isRetry: false,
        orderId,
        paymentId,
        status: 'refund_pending',
      };
    });
  },
);

/**
 * Callable Function: completeDemoRefund (Step 9 — Emulator Only)
 *
 * Finalizes demo refund state to 'refunded_demo'. Admin authorization required.
 */
export const completeDemoRefund = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard (Correction 3)
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'completeDemoRefund is an emulator-only testing helper.',
      );
    }

    // 2. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(data, ['orderId', 'paymentId'], 'completeDemoRefund');
    const orderId = validateId(data.orderId, 'orderId');
    const paymentId = validateId(data.paymentId, 'paymentId');

    const orderRef = db.collection('orders').doc(orderId);
    const paymentRef = orderRef.collection('payments').doc(paymentId);

    return await db.runTransaction(async (transaction) => {
      // READ 1: Order
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      // Authorization: Admin only
      const adminSnap = await transaction.get(db.collection('admins').doc(callerUid));
      const isAdmin =
        adminSnap.exists &&
        adminSnap.data()?.status === 'active' &&
        (adminSnap.data()?.canteenIds?.includes(orderData.canteenId) ||
          adminSnap.data()?.role === 'platform_operator');
      if (!isAdmin) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Only authorized canteen administrators can finalize refunds.',
        );
      }

      // READ 2: Payment
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Payment ${paymentId} not found.`);
      }
      const paymentData = paymentSnap.data()!;

      // Idempotency: Already refunded
      if (paymentData.status === 'refunded_demo') {
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          status: 'refunded_demo',
        };
      }

      // Precondition: Must be in refund_pending
      if (paymentData.status !== 'refund_pending') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment in status '${paymentData.status}' cannot be finalized as refunded. Must be 'refund_pending'.`,
        );
      }

      // Write 1: Update payment to refunded_demo
      transaction.update(paymentRef, {
        status: 'refunded_demo',
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      });

      // Write 2: Update order paymentStatus
      transaction.update(orderRef, {
        paymentStatus: 'refunded_demo',
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_refunded_demo - Correction 6)
      const eventId = `${paymentId}_refunded_demo`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: 'refund_pending',
        toStatus: 'refunded_demo',
        actorUid: callerUid,
        actorRole: 'admin',
        canteenId: orderData.canteenId,
        reason: 'Demo refund finalized by canteen administrator in emulator',
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        isRetry: false,
        orderId,
        paymentId,
        status: 'refunded_demo',
      };
    });
  },
);

/**
 * HTTP Function: verifySyntheticWebhook (Step 9 — Local-Only Emulator Verification Harness)
 *
 * Verifies raw-body HMAC-SHA256 signature using constant-time comparison (crypto.timingSafeEqual).
 * Implements idempotent processing for synthetic provider events.
 * Strictly guarded by FUNCTIONS_EMULATOR === 'true' (Correction 2 & 3).
 */
export const verifySyntheticWebhook = functions.https.onRequest(
  async (req, res) => {
    // 1. Emulator Guard (Correction 3)
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      res.status(403).json({ error: 'verifySyntheticWebhook is disabled in cloud environments.' });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Only POST is supported.' });
      return;
    }

    // 2. Validate raw body and signature header
    const signature = req.headers['x-synthetic-signature'] as string;
    if (!signature || typeof signature !== 'string' || signature.trim().length === 0) {
      res.status(400).json({ error: 'Missing x-synthetic-signature header.' });
      return;
    }

    // Raw body extraction (supports express rawBody buffer or string)
    const rawBodyBuffer: Buffer = (req as any).rawBody
      ? Buffer.from((req as any).rawBody)
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    // Secret from test environment (fallback test-only synthetic key, never committed)
    const syntheticSecret =
      process.env.SYNTHETIC_WEBHOOK_SECRET || 'emulator-test-synthetic-secret-key-32b';

    // 3. Compute HMAC-SHA256 signature over raw request body
    const expectedSignature = crypto
      .createHmac('sha256', syntheticSecret)
      .update(rawBodyBuffer)
      .digest('hex');

    // 4. Constant-time comparison using crypto.timingSafeEqual
    let isValidSignature = false;
    try {
      const sigBuf = Buffer.from(signature.trim(), 'hex');
      const expectedBuf = Buffer.from(expectedSignature, 'hex');
      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        isValidSignature = true;
      }
    } catch {
      isValidSignature = false;
    }

    if (!isValidSignature) {
      res.status(401).json({ error: 'Invalid HMAC signature.' });
      return;
    }

    // 5. Parse JSON payload
    let payload: any;
    try {
      payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(rawBodyBuffer.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload.' });
      return;
    }

    // 6. Validate Schema
    const { eventId, eventType, orderId, paymentId, providerReference, amountInPaise } = payload || {};
    if (
      typeof eventId !== 'string' || !eventId ||
      typeof eventType !== 'string' || !eventType ||
      typeof orderId !== 'string' || !orderId ||
      typeof paymentId !== 'string' || !paymentId ||
      typeof providerReference !== 'string' || !providerReference ||
      typeof amountInPaise !== 'number' || !Number.isInteger(amountInPaise) || amountInPaise <= 0
    ) {
      res.status(400).json({ error: 'Invalid webhook event schema.' });
      return;
    }

    // 7. Check Duplicate Event Idempotency in orders/{orderId}/webhookEvents/{eventId}
    const eventRef = db.collection('orders').doc(orderId).collection('webhookEvents').doc(eventId);
    const existingEventSnap = await eventRef.get();
    if (existingEventSnap.exists) {
      res.status(200).json({
        success: true,
        isIdempotent: true,
        status: 'already_processed',
        eventId,
      });
      return;
    }

    // 8. Validate against server payment record
    const paymentRef = db.collection('orders').doc(orderId).collection('payments').doc(paymentId);
    const paymentSnap = await paymentRef.get();
    if (!paymentSnap.exists) {
      res.status(404).json({ error: `Payment ${paymentId} not found.` });
      return;
    }
    const paymentData = paymentSnap.data()!;

    if (paymentData.providerReference !== providerReference) {
      res.status(400).json({
        error: `Provider reference mismatch. Server has ${paymentData.providerReference}, webhook has ${providerReference}.`,
      });
      return;
    }

    if (paymentData.amountInPaise !== amountInPaise) {
      res.status(400).json({
        error: `Amount mismatch. Server expected ${paymentData.amountInPaise}, webhook supplied ${amountInPaise}.`,
      });
      return;
    }

    // 9. Process event atomically
    await db.runTransaction(async (transaction) => {
      // Record processed event
      transaction.set(eventRef, {
        eventId,
        eventType,
        orderId,
        paymentId,
        amountInPaise,
        providerReference,
        processedAt: serverTimestamp(),
      });

      // If event indicates success, transition payment and order atomically
      if (
        eventType === 'payment.succeeded' &&
        (paymentData.status === 'pending' || paymentData.status === 'processing')
      ) {
        transaction.update(paymentRef, {
          status: 'succeeded_demo',
          updatedAt: serverTimestamp(),
          completedAt: serverTimestamp(),
        });

        transaction.update(db.collection('orders').doc(orderId), {
          status: 'payment_verified',
          paymentStatus: 'succeeded_demo',
          updatedAt: serverTimestamp(),
        });

        const payHistoryId = `${paymentId}_succeeded_demo`;
        transaction.set(
          db.collection('orders').doc(orderId).collection('paymentHistory').doc(payHistoryId),
          {
            eventId: payHistoryId,
            paymentId,
            orderId,
            fromStatus: paymentData.status,
            toStatus: 'succeeded_demo',
            actorUid: 'synthetic_webhook_gateway',
            actorRole: 'webhook_simulator',
            canteenId: paymentData.canteenId,
            reason: 'Payment succeeded via verified synthetic webhook',
            createdAt: serverTimestamp(),
          },
        );

        const orderHistoryId = `${orderId}_placed_to_payment_verified`;
        transaction.set(
          db.collection('orders').doc(orderId).collection('statusHistory').doc(orderHistoryId),
          {
            eventId: orderHistoryId,
            orderId,
            fromStatus: 'placed',
            toStatus: 'payment_verified',
            actorUid: 'synthetic_webhook_gateway',
            actorRole: 'webhook_simulator',
            canteenId: paymentData.canteenId,
            reason: 'Payment verified via verified synthetic webhook',
            createdAt: serverTimestamp(),
          },
        );
      }
    });

    res.status(200).json({
      success: true,
      isIdempotent: false,
      processedEventId: eventId,
    });
  },
);
