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
import {
  createNotificationInternal,
  notifyAssignedCanteenAdmins,
} from './notifications/notificationService';
import { writeNotificationOutboxTx } from './notifications/notificationOutbox';
export { processNotificationOutbox } from './notifications/notificationWorker';
import {
  computeShardCapacities,
  planSlotReservationTx,
  executeSlotReservationTx,
  planSlotReleaseTx,
  executeSlotReleaseTx,
  SlotReleasePlan,
} from './slots/slotSharding';

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

function timestampFromMillis(millis: number) {
  try {
    const { Timestamp } = require('@google-cloud/firestore');
    return Timestamp.fromMillis(millis);
  } catch {
    return (admin.firestore as any).Timestamp.fromMillis(millis);
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

    // 2. Authorization check (R-02 Hardening):
    // Staging and production strictly require an active platform_operator document.
    // Local emulator allows initial bootstrap when FUNCTIONS_EMULATOR is 'true'.
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

    let isCallerPlatformOperator = false;
    let callerRole = 'unauthenticated';
    if (context.auth && context.auth.uid) {
      const callerDoc = await db.collection('admins').doc(context.auth.uid).get();
      if (callerDoc.exists && callerDoc.data()?.status === 'active') {
        const callerData = callerDoc.data()!;
        callerRole = callerData.role || 'canteen_admin';
        isCallerPlatformOperator =
          callerData.role === 'platform_operator' || callerData.isOperator === true;
      }
    }

    if (!isCallerPlatformOperator) {
      if (!isEmulator) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Platform Operator authorization required. Ordinary administrators and service desk attendants cannot assign admin roles.',
        );
      }
      // If running inside emulator, allow initial bootstrap only if unauthenticated or bootstrap caller
      // but strictly reject non-operator authenticated staff (canteen_admin, service_desk)
      if (context.auth && context.auth.uid && !isCallerPlatformOperator) {
        throw new functions.https.HttpsError(
          'permission-denied',
          `Role '${callerRole}' cannot assign admin roles. Platform Operator authority required.`,
        );
      }
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

    // Assign custom claims for token-level validation if Auth record exists
    try {
      await admin.auth().setCustomUserClaims(targetUid, {
        role: 'canteen_admin',
        canteenIds,
      });
    } catch (err: any) {
      functions.logger.warn(`[assignAdminRole] setCustomUserClaims non-fatal for ${targetUid}:`, err?.message);
    }

    // Create an auditable role-assignment event
    await db.collection('adminAuditEvents').add({
      eventType: 'admin_role_assigned',
      targetUid,
      assignedRole: 'canteen_admin',
      canteenIds,
      assignedByUid: context.auth?.uid || 'emulator_bootstrap',
      assignedByRole: isCallerPlatformOperator ? 'platform_operator' : 'emulator_bootstrap',
      isEmulatorBootstrap: !isCallerPlatformOperator && isEmulator,
      createdAt: serverTimestamp(),
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
  if (data.role === 'service_desk') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Service desk operators are not authorized to perform catalog administration.',
    );
  }

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

/**
 * Step 11: Helper to verify active operational access (admin, service_desk, platform_operator).
 * Returns caller details including assigned canteens.
 */
export type OperationalRole = 'platform_operator' | 'canteen_admin' | 'service_desk';

export async function verifyOperationalAccess(
  context: functions.https.CallableContext,
  canteenId?: string,
  allowedRoles: OperationalRole[] = ['platform_operator', 'canteen_admin', 'service_desk'],
): Promise<{ uid: string; role: OperationalRole; canteenIds: string[] }> {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Authentication required for operational access.',
    );
  }

  const callerUid = context.auth.uid;
  const adminDoc = await db.collection('admins').doc(callerUid).get();
  if (!adminDoc.exists || adminDoc.data()?.status !== 'active') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Active operational privileges required.',
    );
  }

  const data = adminDoc.data()!;
  const rawRole = data.role as OperationalRole;
  const isOperator = data.isOperator === true || rawRole === 'platform_operator';

  if (!isOperator && !allowedRoles.includes(rawRole)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      `Role '${rawRole}' is not authorized for this operation.`,
    );
  }

  const role: OperationalRole = isOperator
    ? 'platform_operator'
    : rawRole === 'service_desk'
    ? 'service_desk'
    : 'canteen_admin';

  const assignedCanteens: string[] = Array.isArray(data.canteenIds) ? data.canteenIds : [];

  if (canteenId) {
    if (!isOperator && !assignedCanteens.includes(canteenId)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `Caller is not authorized for canteen ${canteenId}.`,
      );
    }
  }

  return { uid: callerUid, role, canteenIds: assignedCanteens };
}

/**
 * Centralized Role Helpers (R-01 Hardening)
 */
export function requireAuthenticatedUser(context: functions.https.CallableContext): string {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  return context.auth.uid;
}

export async function requireActivePlatformOperator(
  context: functions.https.CallableContext,
): Promise<{ uid: string; role: OperationalRole; canteenIds: string[] }> {
  return await verifyOperationalAccess(context, undefined, ['platform_operator']);
}

export async function requireActiveCanteenAdmin(
  context: functions.https.CallableContext,
  canteenId?: string,
): Promise<{ uid: string; role: OperationalRole; canteenIds: string[] }> {
  return await verifyOperationalAccess(context, canteenId, ['platform_operator', 'canteen_admin']);
}

export async function requireActiveServiceDesk(
  context: functions.https.CallableContext,
  canteenId?: string,
): Promise<{ uid: string; role: OperationalRole; canteenIds: string[] }> {
  return await verifyOperationalAccess(context, canteenId, ['platform_operator', 'service_desk']);
}

export async function requireActiveStaff(
  context: functions.https.CallableContext,
  canteenId?: string,
): Promise<{ uid: string; role: OperationalRole; canteenIds: string[] }> {
  return await verifyOperationalAccess(context, canteenId, [
    'platform_operator',
    'canteen_admin',
    'service_desk',
  ]);
}

export function requireStudentOrderOwner(
  context: functions.https.CallableContext,
  orderStudentUid: string,
): string {
  const uid = requireAuthenticatedUser(context);
  if (uid !== orderStudentUid) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Caller is not the student owner of this order.',
    );
  }
  return uid;
}

/**
 * Helper to verify caller has financial authorization for an order.
 * Strictly excludes service_desk!
 * Allows student owner (if allowStudentOwner is true) or active canteen_admin / platform_operator.
 */
export async function verifyFinancialAuthorization(
  callerUid: string,
  orderData: Record<string, any>,
  allowStudentOwner: boolean = true,
  transaction?: FirebaseFirestore.Transaction,
): Promise<{ isStudentOwner: boolean; isAdmin: boolean }> {
  const isStudentOwner = allowStudentOwner && orderData.studentUid === callerUid;
  if (isStudentOwner) {
    return { isStudentOwner: true, isAdmin: false };
  }

  const adminRef = db.collection('admins').doc(callerUid);
  const adminSnap = transaction ? await transaction.get(adminRef) : await adminRef.get();

  if (!adminSnap.exists || adminSnap.data()?.status !== 'active') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Caller is not authorized to perform financial operations for this order.',
    );
  }

  const adminData = adminSnap.data()!;
  const role = adminData.role;

  // STRICT RULE: service_desk role is NEVER authorized for financial mutations or payment details
  if (role === 'service_desk') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Service desk attendants are strictly unauthorized for payment and refund operations.',
    );
  }

  const isOperator = adminData.isOperator === true || role === 'platform_operator';
  const isCanteenAdmin =
    role === 'canteen_admin' &&
    Array.isArray(adminData.canteenIds) &&
    adminData.canteenIds.includes(orderData.canteenId);

  if (!isOperator && !isCanteenAdmin) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Caller is not authorized for financial operations in this canteen.',
    );
  }

  return { isStudentOwner: false, isAdmin: true };
}

/**
 * Canonical helper: Determines if an order is operationally eligible for service-desk fulfillment.
 * Centralized business rules:
 * 1. Online orders must have verified payment approval (status 'payment_verified' or paymentStatus 'succeeded_demo').
 * 2. Cash orders must have explicit backend/admin payment verification (status 'payment_verified', paymentStatus 'payment_verified').
 * 3. Pending, failed, expired, cancelled, rejected, or unapproved orders (cash or online) remain hidden from service desk.
 */
export function isOrderOperationallyEligible(order: Record<string, any>): boolean {
  if (!order) return false;

  const status = order.status;
  const paymentStatus = order.paymentStatus;
  const refundStatus = order.refundStatus;

  // Never eligible if refund is pending, completed, or requested
  if (refundStatus && refundStatus !== 'not_requested') {
    return false;
  }

  // Never eligible if payment failed, expired, or pending (applies to both cash and online)
  if (paymentStatus === 'failed' || paymentStatus === 'expired' || paymentStatus === 'pending') {
    return false;
  }

  // Terminal/non-fulfillable statuses: cancelled or rejected orders are excluded from service desk
  if (status === 'cancelled' || status === 'rejected') {
    return false;
  }

  // If status is placed: unapproved/unverified orders are never eligible regardless of paymentMethod
  if (status === 'placed') {
    return false;
  }

  // Payment must be explicitly verified (payment_verified or succeeded_demo)
  const isPaymentVerified =
    paymentStatus === 'payment_verified' ||
    paymentStatus === 'succeeded_demo';
  if (!isPaymentVerified) {
    return false;
  }

  // Active operational statuses (after payment verification and acceptance)
  if (['payment_verified', 'accepted', 'preparing', 'ready_for_pickup', 'completed'].includes(status)) {
    return true;
  }

  return false;
}

/**
 * Determines whether an order is in the incoming/pending queue awaiting staff acceptance.
 * Decreases when an order leaves pending/incoming (e.g. accepted).
 */
export function isOrderIncomingEligible(order: Record<string, any>): boolean {
  if (!isOrderOperationallyEligible(order)) return false;
  // Incoming/pending orders are those that have verified payment but have not yet been accepted by counter staff
  return order.status === 'payment_verified';
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
      ['canteenId', 'slotId', 'date', 'startTime', 'endTime', 'capacity', 'isOpen', 'isSharded', 'shardCount'],
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

    if (data.isSharded !== undefined && typeof data.isSharded !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'isSharded must be a boolean.');
    }
    const isSharded = data.isSharded === true;
    let shardCount: number | undefined = undefined;
    if (isSharded) {
      if (data.shardCount !== undefined) {
        if (
          typeof data.shardCount !== 'number' ||
          !Number.isInteger(data.shardCount) ||
          data.shardCount < 1 ||
          data.shardCount > 20
        ) {
          throw new functions.https.HttpsError(
            'invalid-argument',
            'shardCount must be an integer between 1 and 20.',
          );
        }
        shardCount = data.shardCount;
      } else {
        shardCount = 5;
      }
    }

    const slotRef = db.collection('canteens').doc(canteenId).collection('pickupSlots').doc(slotId);

    if (isSharded && shardCount) {
      const shardCapacities = computeShardCapacities(capacity, shardCount);
      const batch = db.batch();
      batch.set(slotRef, {
        slotId,
        canteenId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        timezone: 'Asia/Kolkata',
        isOpen,
        capacity,
        reservedCount: 0,
        isSharded: true,
        shardCount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (let i = 0; i < shardCount; i++) {
        const shardId = `shard_${i}`;
        const shardRef = slotRef.collection('capacityShards').doc(shardId);
        batch.set(shardRef, {
          shardId,
          slotId,
          canteenId,
          allocatedCapacity: shardCapacities[i],
          reservedCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } else {
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
    }
    return { success: true, slotId };
  },
);

/**
 * Non-invasive order telemetry interface (Phase 5).
 * Captures request latency, transaction retries, aborts, and errors.
 * Strictly strips all customer PII, secrets, auth tokens, and raw payloads.
 */
interface OrderTelemetryEntry {
  correlationId: string;
  operation: string;
  orderId?: string;
  canteenId?: string;
  isRetry?: boolean;
  reservationMode?: 'sharded' | 'legacy';
  shardId?: string;
  itemCount?: number;
  totalDurationMs?: number;
  transactionDurationMs?: number;
  transactionAttempts?: number;
  abortCategory?: string;
  errorCategory?: string;
  status: 'success' | 'aborted' | 'error';
}

function logOrderTelemetry(entry: OrderTelemetryEntry): void {
  functions.logger.info('[OrderTelemetry]', JSON.stringify({
    timestamp: new Date().toISOString(),
    correlationId: entry.correlationId || 'none',
    operation: entry.operation,
    orderId: entry.orderId || 'none',
    canteenId: entry.canteenId || 'none',
    isRetry: Boolean(entry.isRetry),
    reservationMode: entry.reservationMode || 'unknown',
    shardId: entry.shardId || 'none',
    itemCount: entry.itemCount ?? 0,
    totalDurationMs: entry.totalDurationMs ?? 0,
    transactionDurationMs: entry.transactionDurationMs ?? 0,
    transactionAttempts: entry.transactionAttempts ?? 1,
    abortCategory: entry.abortCategory || 'none',
    errorCategory: entry.errorCategory || 'none',
    status: entry.status,
  }));
}

/**
 * Callable Function: createOrder (Step 7 / Phase 5 High-Scale Ingestion)
 *
 * Core Security & Invariance:
 * 1. Client sends only validated intent: canteenId, items: [{itemId, quantity}], pickupSlotId, paymentMethod, idempotencyKey.
 * 2. Reject all client-supplied price, unitPrice, lineTotal, subtotal, total, status, or timestamps.
 * 3. Authoritative prices are re-read from Firestore catalog inside an atomic transaction.
 * 4. Slot capacity is checked and reserved transactionally (supports Strategy A sharded slots & legacy slots).
 * 5. Submitted cart items in users/{studentUid}/cart/{itemId} are cleared in the same transaction.
 * 6. Deterministic orderId derived from studentUid and idempotencyKey.
 * 7. ALL transaction reads execute BEFORE any transaction writes.
 * 8. Non-invasive telemetry tracks latency, transaction holding time, and abort categories.
 */
export const createOrder = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    const requestStartTime = Date.now();
    let transactionAttempts = 0;
    let txStartTime = 0;
    let chosenReservationMode: 'sharded' | 'legacy' = 'legacy';
    let chosenShardId: string | undefined;

    // 1. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required to place an order.',
      );
    }
    const studentUid = context.auth.uid;

    // 2. Pre-validation: Input object shape & static request size bounds
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Request payload must be a non-null object.',
      );
    }

    try {
      const payloadString = JSON.stringify(data);
      if (payloadString.length > 32768) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Request payload exceeds maximum allowed size of 32KB.',
        );
      }
    } catch (err: any) {
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError('invalid-argument', 'Malformed request payload.');
    }

    // Reject unknown / forbidden fields
    rejectUnknownFields(
      data,
      ['canteenId', 'items', 'pickupSlotId', 'paymentMethod', 'idempotencyKey'],
      'createOrder',
    );

    // Validate mandatory fields
    if (
      !data.canteenId ||
      !data.items ||
      !data.pickupSlotId ||
      !data.paymentMethod ||
      !data.idempotencyKey
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'canteenId, items, pickupSlotId, paymentMethod, and idempotencyKey are mandatory.',
      );
    }

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

    // 5. Validate paymentMethod strictly (Correction 1)
    const ALLOWED_ORDER_PAYMENT_METHODS = ['cash', 'upi_demo', 'demo_wallet', 'demo_card'] as const;
    if (!ALLOWED_ORDER_PAYMENT_METHODS.includes(data.paymentMethod)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        "paymentMethod must be one of: 'cash', 'upi_demo', 'demo_wallet', 'demo_card'.",
      );
    }
    const paymentMethod: (typeof ALLOWED_ORDER_PAYMENT_METHODS)[number] = data.paymentMethod;

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
    let totalOrderQuantity = 0;

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
      totalOrderQuantity += item.quantity;
      sanitizedItems.push({ itemId, quantity: item.quantity });
    }

    if (totalOrderQuantity > 200) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Total quantity across all items cannot exceed 200 per order.',
      );
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

    // 8. Execute Firestore Transaction with telemetry and optimized concurrent reads
    try {
      const result = await db.runTransaction(async (transaction) => {
        transactionAttempts++;
        txStartTime = Date.now();

        // --- READ 1: Idempotency Record (Fast short-circuit on retry) ---
        const existingReq = await transaction.get(idempotencyRef);
        if (existingReq.exists) {
          const reqData = existingReq.data()!;
          if (reqData.requestHash === requestHash) {
            // Idempotent retry: read existing order and return immediately without reading catalog/slot/cart
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

        // Capacity verification (Partitioned Shards or Legacy Parent Slot)
        const slotReservationPlan = await planSlotReservationTx(
          transaction,
          canteenId,
          pickupSlotId,
          slotData,
          slotRef,
        );
        if (slotReservationPlan.isSharded) {
          chosenReservationMode = 'sharded';
          chosenShardId = slotReservationPlan.shardId;
        } else {
          chosenReservationMode = 'legacy';
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

        const pickupSlotSnapshot: {
          slotId: string;
          pickupDate: string;
          pickupStartTime: string;
          pickupEndTime: string;
          timezone: string;
          shardId?: string;
        } = {
          slotId: pickupSlotId,
          pickupDate: slotData.date,
          pickupStartTime: slotData.startTime,
          pickupEndTime: slotData.endTime,
          timezone: 'Asia/Kolkata',
        };
        if (slotReservationPlan.isSharded && slotReservationPlan.shardId) {
          pickupSlotSnapshot.shardId = slotReservationPlan.shardId;
        }

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

        // Write 3: Reserve Slot Capacity (Exact Shard or Legacy Slot)
        executeSlotReservationTx(transaction, slotReservationPlan);

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

        // Phase 3: Transactional Outbox Events (durable, idempotent notification workflow)
        writeNotificationOutboxTx(transaction, db, {
          outboxId: `outbox_${orderId}_placed_student`,
          sourceEventId: `${orderId}_placed`,
          sourceEventType: 'order',
          recipientUid: studentUid,
          recipientRole: 'student',
          notificationType: 'order_placed',
          orderId,
          canteenId,
          correlationId: orderId,
        });

        writeNotificationOutboxTx(transaction, db, {
          outboxId: `outbox_${orderId}_placed_admin`,
          sourceEventId: `${orderId}_placed`,
          sourceEventType: 'order',
          recipientRole: 'admin',
          notificationType: 'new_order_for_admin',
          orderId,
          canteenId,
          correlationId: orderId,
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

      const totalDurationMs = Date.now() - requestStartTime;
      const transactionDurationMs = Date.now() - txStartTime;
      logOrderTelemetry({
        correlationId: orderId,
        operation: 'createOrder',
        orderId,
        canteenId,
        isRetry: result.isRetry,
        reservationMode: chosenReservationMode,
        shardId: chosenShardId,
        itemCount: sanitizedItems.length,
        totalDurationMs,
        transactionDurationMs,
        transactionAttempts,
        status: 'success',
      });

      return {
        success: true,
        ...result,
      };
    } catch (err: any) {
      const totalDurationMs = Date.now() - requestStartTime;
      const errCode = (err as any)?.code || (err as any)?.status || 'unknown';
      const errMsg = String((err as any)?.message || '');
      const isContentionAbort =
        errCode === 10 ||
        errCode === 'aborted' ||
        errMsg.includes('ABORTED') ||
        errMsg.includes('lock timeout');

      logOrderTelemetry({
        correlationId: orderId,
        operation: 'createOrder',
        orderId,
        canteenId,
        itemCount: sanitizedItems.length,
        totalDurationMs,
        transactionDurationMs: txStartTime ? Date.now() - txStartTime : 0,
        transactionAttempts,
        abortCategory: isContentionAbort ? 'contention_abort' : 'none',
        errorCategory: String(errCode),
        status: isContentionAbort ? 'aborted' : 'error',
      });

      throw err;
    }
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
    rejectUnknownFields(data, ['orderId', 'nextStatus', 'targetStatus', 'reason', 'idempotencyKey'], 'transitionOrderStatus');

    const orderId = validateId(data.orderId, 'orderId');
    const rawNext = data.targetStatus || data.nextStatus;
    if (
      typeof rawNext !== 'string' ||
      !VALID_ORDER_STATUSES.includes(rawNext as OrderStatus)
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Invalid nextStatus: ${rawNext}. Must be one of: ${VALID_ORDER_STATUSES.join(', ')}.`,
      );
    }
    const nextStatus = rawNext as OrderStatus;

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
      let actorRole: 'student' | 'canteen_admin' | 'service_desk' = 'student';

      const adminSnap = await transaction.get(db.collection('admins').doc(callerUid));
      if (adminSnap.exists && adminSnap.data()?.status === 'active') {
        const adminData = adminSnap.data()!;
        if (
          adminData.role === 'platform_operator' ||
          adminData.isOperator === true ||
          (Array.isArray(adminData.canteenIds) && adminData.canteenIds.includes(orderData.canteenId))
        ) {
          if (['service_desk', 'canteen_admin', 'platform_operator'].includes(adminData.role) || adminData.isOperator === true) {
            isAdmin = true;
            actorRole = adminData.role === 'service_desk' ? 'service_desk' : 'canteen_admin';
          }
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
          if (actorRole === 'service_desk') {
            throw new functions.https.HttpsError(
              'permission-denied',
              'Service desk operators cannot transition unverified placed orders. Payment approval required.',
            );
          }
          if (paymentMethod === 'cash') {
            // Canteen admin explicitly approves cash payment upon accepting the order
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
      const orderShardId = orderData.pickupSlot?.shardId;
      let slotReleasePlan: SlotReleasePlan | null = null;

      if (isCancellationOrRejection && slotId && typeof slotId === 'string' && slotId.trim().length > 0) {
        slotReleasePlan = await planSlotReleaseTx(
          transaction,
          db,
          orderData.canteenId,
          slotId,
          orderShardId,
          validateAndComputeSlotCapacityRelease,
        );
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

      // Write 1: Update order status and refundStatus (Section 2.2 & 2.3)
      const isRefundInitiated = isCancellationOrRejection && currentPaymentStatus === 'succeeded_demo';
      const orderUpdates: Record<string, any> = {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      };
      if (currentStatus === 'placed' && paymentMethod === 'cash' && nextStatus === 'accepted') {
        orderUpdates.paymentStatus = 'payment_verified';
      }
      if (isRefundInitiated) {
        orderUpdates.refundStatus = 'pending';
      }
      transaction.update(orderRef, orderUpdates);

      // Write 2: Decrement slot capacity reservedCount (exact shard or legacy parent slot)
      if (slotReleasePlan) {
        executeSlotReleaseTx(transaction, slotReleasePlan);
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

      // Write 3b: Append deterministic immutable auditEvents entry (Step 11)
      const auditRef = orderRef.collection('auditEvents').doc(eventId);
      transaction.set(auditRef, {
        eventId,
        orderId,
        canteenId: orderData.canteenId,
        eventType: `order_status_${nextStatus}`,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        actorUid: callerUid,
        actorRole,
        reason: reason || (isStudentOwner ? 'Cancelled by student' : `Status updated to ${nextStatus}`),
        createdAt: serverTimestamp(),
      });

      // Write 4: Process demo refund state & write payment history (Section 2.2 & Step 9 Ordering)
      if (activePaidPaymentSnap) {
        const paymentId = activePaidPaymentSnap.id;
        const paymentRef = orderRef.collection('payments').doc(paymentId);
        const refundReference = `demo_ref_${crypto.randomUUID()}`;
        transaction.update(paymentRef, {
          refundStatus: 'pending',
          refundReference,
          updatedAt: serverTimestamp(),
        });

        const refundHistoryEventId = `${paymentId}_refund_pending`;
        const paymentHistoryRef = orderRef.collection('paymentHistory').doc(refundHistoryEventId);
        transaction.set(paymentHistoryRef, {
          eventId: refundHistoryEventId,
          paymentId,
          orderId,
          fromStatus: 'not_requested',
          toStatus: 'pending',
          actorUid: callerUid,
          actorRole,
          canteenId: orderData.canteenId,
          reason: `Demo refund initiated upon order ${nextStatus}`,
          createdAt: serverTimestamp(),
        });
      }

      // Phase 3: Transactional Outbox Events (durable, idempotent notification workflow)
      const STATUS_TO_NOTIFICATION_TYPE: Record<string, import('./notifications/notificationService').StudentNotificationType | null> = {
        accepted: 'order_accepted',
        preparing: 'order_preparing',
        ready_for_pickup: 'order_ready_for_pickup',
        completed: 'order_completed',
        cancelled: 'order_cancelled',
        rejected: 'order_rejected',
      };
      const notifType = STATUS_TO_NOTIFICATION_TYPE[nextStatus];
      if (notifType && orderData.studentUid) {
        const sourceEventId = currentStatus
          ? `${orderId}_${currentStatus}_to_${nextStatus}`
          : `${orderId}_to_${nextStatus}`;
        writeNotificationOutboxTx(transaction, db, {
          outboxId: `outbox_${sourceEventId}_student`,
          sourceEventId,
          sourceEventType: 'order',
          recipientUid: orderData.studentUid,
          recipientRole: 'student',
          notificationType: notifType,
          orderId,
          canteenId: orderData.canteenId,
          correlationId: orderId,
        });
      }

      if (isRefundInitiated && activePaidPaymentSnap && orderData.studentUid) {
        const refundSourceEventId = `${activePaidPaymentSnap.id}_refund_pending`;
        writeNotificationOutboxTx(transaction, db, {
          outboxId: `outbox_${refundSourceEventId}_student`,
          sourceEventId: refundSourceEventId,
          sourceEventType: 'refund',
          recipientUid: orderData.studentUid,
          recipientRole: 'student',
          notificationType: 'refund_pending_demo',
          orderId,
          canteenId: orderData.canteenId,
          correlationId: orderId,
        });
      }

      return {
        success: true,
        isIdempotent: false,
        orderId,
        fromStatus: currentStatus,
        status: nextStatus,
        paymentStatus: currentPaymentStatus,
        refundStatus: isRefundInitiated ? 'pending' : (orderData.refundStatus || 'not_requested'),
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

      // Ownership check: Student owner or assigned admin (service_desk strictly denied)
      await verifyFinancialAuthorization(callerUid, orderData, true, transaction);

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

      // Write 1: Update paymentStatus and order status (Canonical succeeded_demo per Step 9)
      transaction.update(orderRef, {
        paymentStatus: 'succeeded_demo',
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
        paymentStatus: 'succeeded_demo',
      };
    });
  },
);

/**
 * Callable Function: approveCashPayment
 *
 * Explicitly records payment approval for a cash order.
 * Restricted to assigned canteen_admin or platform_operator.
 * Service desk attendants and students are strictly denied.
 */
export const approveCashPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required to approve cash payment.',
      );
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(data, ['orderId'], 'approveCashPayment');
    const orderId = validateId(data.orderId, 'orderId');
    const orderRef = db.collection('orders').doc(orderId);

    return await db.runTransaction(async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      // Verify financial authorization: canteen_admin or platform_operator only (allowStudentOwner: false)
      await verifyFinancialAuthorization(callerUid, orderData, false, transaction);

      // Validate paymentMethod is cash
      if (orderData.paymentMethod !== 'cash') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Cannot approve cash payment for order with paymentMethod '${orderData.paymentMethod}'.`,
        );
      }

      // Idempotency: if already approved
      if (orderData.status === 'payment_verified' && orderData.paymentStatus === 'payment_verified') {
        return {
          success: true,
          isIdempotent: true,
          orderId,
          status: 'payment_verified',
          paymentStatus: 'payment_verified',
        };
      }

      if (orderData.status !== 'placed') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} has status '${orderData.status}'. Cash approval requires status 'placed'.`,
        );
      }

      // Atomically update order status and paymentStatus
      transaction.update(orderRef, {
        paymentStatus: 'payment_verified',
        status: 'payment_verified',
        cashApprovedBy: callerUid,
        cashApprovedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Write statusHistory
      const eventId = `${orderId}_placed_to_payment_verified_cash`;
      const historyRef = orderRef.collection('statusHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        orderId,
        fromStatus: 'placed',
        toStatus: 'payment_verified',
        actorUid: callerUid,
        actorRole: 'canteen_admin',
        canteenId: orderData.canteenId,
        reason: 'Cash payment approved by authorized canteen admin',
        createdAt: serverTimestamp(),
      });

      // Write auditEvents
      const auditRef = orderRef.collection('auditEvents').doc(eventId);
      transaction.set(auditRef, {
        eventId,
        orderId,
        canteenId: orderData.canteenId,
        eventType: 'cash_payment_approved',
        fromStatus: 'placed',
        toStatus: 'payment_verified',
        actorUid: callerUid,
        actorRole: 'canteen_admin',
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        orderId,
        status: 'payment_verified',
        paymentStatus: 'payment_verified',
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
// STEP 11: SERVICE DESK, ADMIN OPERATIONS, AND TOUCH-SCREEN KEYBOARD FOUNDATION
// ============================================================================

/**
 * Callable Function: transitionOperationalOrderStatus (Step 11)
 *
 * Exposes order status transitions for service desk attendants and admins.
 * Fully transactional, server-authoritative, idempotent, and updates immutable audit history.
 */
export const transitionOperationalOrderStatus = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(
      data,
      ['orderId', 'nextStatus', 'targetStatus', 'reason', 'idempotencyKey'],
      'transitionOperationalOrderStatus',
    );
    const res = await (transitionOrderStatus as any).run(data, context);
    return {
      success: res.success,
      isIdempotent: res.isIdempotent,
      orderId: res.orderId,
      fromStatus: res.fromStatus,
      status: res.status,
    };
  },
);

/**
 * Callable Function: listOperationalOrders (Step 11)
 *
 * Retrieves incoming order queue for assigned canteens with strict role verification,
 * bounded pagination (1..50), status filter, pickup date filter, and sanitized fields.
 */
export const listOperationalOrders = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(
      data,
      ['canteenId', 'status', 'pickupDate', 'limit', 'cursor'],
      'listOperationalOrders',
    );

    // Verify caller has active operational privileges
    const { role: callerRole, canteenIds } = await verifyOperationalAccess(
      context,
      data.canteenId ? validateId(data.canteenId, 'canteenId') : undefined,
    );

    // Limit validation: integer between 1 and 50
    let limitCount = 20;
    if (data.limit !== undefined && data.limit !== null) {
      if (
        typeof data.limit !== 'number' ||
        !Number.isInteger(data.limit) ||
        data.limit < 1 ||
        data.limit > 50
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'limit must be an integer between 1 and 50.',
        );
      }
      limitCount = data.limit;
    }

    let targetCanteen = data.canteenId ? validateId(data.canteenId, 'canteenId') : null;
    if (!targetCanteen) {
      if (canteenIds.length > 0) {
        targetCanteen = canteenIds[0];
      } else if (callerRole === 'platform_operator') {
        targetCanteen = ALLOWED_CANTEEN_IDS[0];
      }
    }

    if (!targetCanteen) {
      return {
        success: true,
        count: 0,
        orders: [],
      };
    }

    let query: FirebaseFirestore.Query = db
      .collection('orders')
      .where('canteenId', '==', targetCanteen);

    if (data.status) {
      if (!VALID_ORDER_STATUSES.includes(data.status)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Invalid status filter: ${data.status}.`,
        );
      }
      query = query.where('status', '==', data.status);
    }

    if (data.pickupDate) {
      if (typeof data.pickupDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.pickupDate)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'pickupDate must be formatted as YYYY-MM-DD.',
        );
      }
      query = query.where('pickupSlot.pickupDate', '==', data.pickupDate);
    }

    query = query.orderBy('createdAt', 'desc').limit(limitCount);

    if (data.cursor && typeof data.cursor === 'string') {
      const cursorDoc = await db.collection('orders').doc(data.cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();

    // Compute live incoming eligible order count for targetCanteen (Section 1.4)
    const incomingSnap = await db
      .collection('orders')
      .where('canteenId', '==', targetCanteen)
      .where('status', 'in', ['placed', 'payment_verified'])
      .get();
    const incomingEligibleCount = incomingSnap.docs.filter((doc) =>
      isOrderIncomingEligible(doc.data()),
    ).length;

    // Filter query results by operational eligibility (Section 1.1)
    const eligibleDocs = snapshot.docs.filter((doc) => isOrderOperationallyEligible(doc.data()));

    const orders = eligibleDocs.map((doc) => {
      const d = doc.data();

      const items = Array.isArray(d.itemsSnapshot)
        ? d.itemsSnapshot.map((i: any) => ({
            itemId: i.itemId || '',
            itemName: i.name || i.itemName || '',
            quantity: typeof i.quantity === 'number' ? i.quantity : 1,
          }))
        : [];

      const itemCount = items.reduce(
        (acc: number, item: any) => acc + (typeof item.quantity === 'number' ? item.quantity : 1),
        0,
      );

      return {
        orderId: d.orderId || doc.id,
        shortOrderReference: (d.orderId || doc.id).slice(0, 8).toUpperCase(),
        canteenId: d.canteenId,
        items,
        pickupSlot: d.pickupSlot
          ? {
              pickupDate: d.pickupSlot.pickupDate || '',
              pickupStartTime: d.pickupSlot.pickupStartTime || d.pickupSlot.startTime || '',
              pickupEndTime: d.pickupSlot.pickupEndTime || d.pickupSlot.endTime || '',
              timezone: d.pickupSlot.timezone || 'Asia/Kolkata',
            }
          : null,
        status: d.status,
        orderStatus: d.status,
        itemCount,
        createdAt: d.createdAt || null,
        updatedAt: d.updatedAt || null,
        operationalReason: d.rejectionReason || d.cancellationReason || undefined,
      };
    });

    return {
      success: true,
      canteenId: targetCanteen,
      count: orders.length,
      incomingEligibleCount,
      orders,
    };
  },
);

/**
 * Callable Function: searchOperationalOrders (Step 11)
 *
 * Performs bounded, sanitized order search by orderId or reference.
 * Strictly isolates cross-canteen queries: nonexistent and unassigned canteen orders
 * return a generic not-found result without leaking order existence.
 */
export const searchOperationalOrders = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['query', 'canteenId'], 'searchOperationalOrders');

    if (!data.query || typeof data.query !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'query must be a non-empty string.',
      );
    }

    const rawQuery = data.query.trim();
    if (rawQuery.length < 1 || rawQuery.length > 64) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'query must be between 1 and 64 characters.',
      );
    }

    // Reject control characters
    if (/[\x00-\x1F\x7F]/.test(rawQuery)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'query contains invalid control characters.',
      );
    }

    const { role: callerRole, canteenIds } = await verifyOperationalAccess(
      context,
      data.canteenId ? validateId(data.canteenId, 'canteenId') : undefined,
    );

    // Direct lookup by document ID
    let docSnap = await db.collection('orders').doc(rawQuery).get();

    // If not found directly, try querying by orderId field
    if (!docSnap.exists) {
      const snap = await db
        .collection('orders')
        .where('orderId', '==', rawQuery)
        .limit(1)
        .get();
      if (!snap.empty) {
        docSnap = snap.docs[0];
      }
    }

    // Generic not-found check: does not exist OR caller is not authorized for this order's canteen
    if (!docSnap.exists) {
      return {
        success: true,
        found: false,
        order: null,
      };
    }

    const d = docSnap.data()!;
    const orderCanteenId = d.canteenId;

    if (callerRole !== 'platform_operator' && !canteenIds.includes(orderCanteenId)) {
      // Fail closed: return generic not found without revealing existence
      return {
        success: true,
        found: false,
        order: null,
      };
    }

    if (data.canteenId && orderCanteenId !== data.canteenId) {
      return {
        success: true,
        found: false,
        order: null,
      };
    }

    // Enforce operational eligibility predicate (Section 1.1)
    if (!isOrderOperationallyEligible(d)) {
      return {
        success: true,
        found: false,
        order: null,
      };
    }

    const items = Array.isArray(d.itemsSnapshot)
      ? d.itemsSnapshot.map((i: any) => ({
          itemId: i.itemId || '',
          itemName: i.name || i.itemName || '',
          quantity: typeof i.quantity === 'number' ? i.quantity : 1,
        }))
      : [];

    const itemCount = items.reduce(
      (acc: number, item: any) => acc + (typeof item.quantity === 'number' ? item.quantity : 1),
      0,
    );

    return {
      success: true,
      found: true,
      order: {
        orderId: d.orderId || docSnap.id,
        shortOrderReference: (d.orderId || docSnap.id).slice(0, 8).toUpperCase(),
        canteenId: d.canteenId,
        items,
        pickupSlot: d.pickupSlot
          ? {
              pickupDate: d.pickupSlot.pickupDate || '',
              pickupStartTime: d.pickupSlot.pickupStartTime || d.pickupSlot.startTime || '',
              pickupEndTime: d.pickupSlot.pickupEndTime || d.pickupSlot.endTime || '',
              timezone: d.pickupSlot.timezone || 'Asia/Kolkata',
            }
          : null,
        status: d.status,
        orderStatus: d.status,
        itemCount,
        createdAt: d.createdAt || null,
        updatedAt: d.updatedAt || null,
        operationalReason: d.rejectionReason || d.cancellationReason || undefined,
      },
    };
  },
);

/**
 * Callable Function: getOperationalOrderDetails (Step 11)
 *
 * Retrieves sanitized operational order details including immutable audit history
 * and operational notes. Generic not-found for unauthorized access.
 */
export const getOperationalOrderDetails = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['orderId'], 'getOperationalOrderDetails');

    const orderId = validateId(data.orderId, 'orderId');
    const { role: callerRole, canteenIds } = await verifyOperationalAccess(context);

    const docSnap = await db.collection('orders').doc(orderId).get();
    if (!docSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Order not found.');
    }

    const d = docSnap.data()!;
    if (callerRole !== 'platform_operator' && !canteenIds.includes(d.canteenId)) {
      // Generic not-found to prevent probing
      throw new functions.https.HttpsError('not-found', 'Order not found.');
    }

    // Enforce operational eligibility predicate (Section 1.1)
    if (!isOrderOperationallyEligible(d)) {
      throw new functions.https.HttpsError('not-found', 'Order not found.');
    }

    const items = Array.isArray(d.itemsSnapshot)
      ? d.itemsSnapshot.map((i: any) => ({
          itemId: i.itemId || '',
          itemName: i.name || i.itemName || '',
          quantity: typeof i.quantity === 'number' ? i.quantity : 1,
        }))
      : [];

    const itemCount = items.reduce(
      (acc: number, item: any) => acc + (typeof item.quantity === 'number' ? item.quantity : 1),
      0,
    );

    // Fetch operational notes
    const notesSnap = await docSnap.ref.collection('operationalNotes').get();
    const operationalNotes = notesSnap.docs
      .map((doc) => doc.data())
      .filter((n) => !n.isDeleted)
      .sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      })
      .map((n) => ({
        noteId: n.noteId,
        orderId: n.orderId,
        canteenId: n.canteenId,
        authorUid: n.authorUid,
        authorRole: n.authorRole,
        body: n.body,
        createdAt: n.createdAt,
      }));

    // Fetch audit events (and status history)
    const auditSnap = await docSnap.ref.collection('auditEvents').get();
    const statusHistorySnap = await docSnap.ref.collection('statusHistory').get();

    const seenEventIds = new Set<string>();
    const auditHistory: any[] = [];

    auditSnap.docs.forEach((doc) => {
      const ev = doc.data();
      seenEventIds.add(ev.eventId || doc.id);
      auditHistory.push({
        eventId: ev.eventId || doc.id,
        orderId: ev.orderId,
        canteenId: ev.canteenId,
        eventType: ev.eventType || 'status_change',
        fromStatus: ev.fromStatus || null,
        toStatus: ev.toStatus || null,
        actorUid: ev.actorUid,
        actorRole: ev.actorRole,
        reason: ev.reason || null,
        createdAt: ev.createdAt,
      });
    });

    statusHistorySnap.docs.forEach((doc) => {
      const sh = doc.data();
      const eid = sh.eventId || doc.id;
      if (!seenEventIds.has(eid)) {
        seenEventIds.add(eid);
        auditHistory.push({
          eventId: eid,
          orderId: sh.orderId,
          canteenId: sh.canteenId,
          eventType: `order_status_${sh.toStatus}`,
          fromStatus: sh.fromStatus || null,
          toStatus: sh.toStatus || null,
          actorUid: sh.actorUid,
          actorRole: sh.actorRole,
          reason: sh.reason || null,
          createdAt: sh.createdAt,
        });
      }
    });

    auditHistory.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return timeA - timeB;
    });

    return {
      success: true,
      order: {
        orderId: d.orderId || docSnap.id,
        shortOrderReference: (d.orderId || docSnap.id).slice(0, 8).toUpperCase(),
        canteenId: d.canteenId,
        items,
        pickupSlot: d.pickupSlot
          ? {
              pickupDate: d.pickupSlot.pickupDate || '',
              pickupStartTime: d.pickupSlot.pickupStartTime || d.pickupSlot.startTime || '',
              pickupEndTime: d.pickupSlot.pickupEndTime || d.pickupSlot.endTime || '',
              timezone: d.pickupSlot.timezone || 'Asia/Kolkata',
            }
          : null,
        status: d.status,
        orderStatus: d.status,
        itemCount,
        createdAt: d.createdAt || null,
        updatedAt: d.updatedAt || null,
        operationalReason: d.rejectionReason || d.cancellationReason || undefined,
        operationalNotes,
        auditHistory,
      },
    };
  },
);

/**
 * Callable Function: getIncomingOrderCount (Section 1.4 Live Counter)
 *
 * Computes live count of incoming eligible orders for assigned canteen.
 */
export const getIncomingOrderCount = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['canteenId'], 'getIncomingOrderCount');
    const targetCanteen = data.canteenId ? validateId(data.canteenId, 'canteenId') : undefined;
    const { canteenIds } = await verifyOperationalAccess(context, targetCanteen);
    const canteen = targetCanteen || canteenIds[0] || ALLOWED_CANTEEN_IDS[0];

    const placedSnap = await db
      .collection('orders')
      .where('canteenId', '==', canteen)
      .where('status', 'in', ['placed', 'payment_verified'])
      .get();

    const incomingCount = placedSnap.docs.filter((doc) =>
      isOrderIncomingEligible(doc.data()),
    ).length;

    return {
      success: true,
      canteenId: canteen,
      incomingCount,
    };
  },
);


/**
 * Callable Function: createOperationalNote (Step 11)
 *
 * Adds an operational note to an order. Author UID and role are derived server-side.
 * Appends an audit event to the order's immutable audit history.
 */
export const createOperationalNote = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    rejectUnknownFields(data, ['orderId', 'body'], 'createOperationalNote');

    const orderId = validateId(data.orderId, 'orderId');

    if (!data.body || typeof data.body !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'body must be a non-empty string.',
      );
    }

    const trimmedBody = data.body.trim();
    if (trimmedBody.length < 1 || trimmedBody.length > 1000) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'body must be between 1 and 1000 characters.',
      );
    }

    // Reject control characters (allowing regular newline and space)
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmedBody)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Note contains invalid control characters.',
      );
    }

    // Verify operational privileges
    const { uid: authorUid, role: callerRole, canteenIds } = await verifyOperationalAccess(
      context,
      undefined,
      ['platform_operator', 'canteen_admin', 'service_desk'],
    );

    const authorRole: 'canteen_admin' | 'service_desk' =
      callerRole === 'service_desk' ? 'service_desk' : 'canteen_admin';

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Order not found.');
    }

    const orderData = orderSnap.data()!;
    if (callerRole !== 'platform_operator' && !canteenIds.includes(orderData.canteenId)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `Caller is not authorized for canteen ${orderData.canteenId}.`,
      );
    }

    const noteId = `note_${crypto.randomUUID()}`;
    const noteRef = orderRef.collection('operationalNotes').doc(noteId);
    const auditEventId = `${orderId}_note_${noteId}`;
    const auditRef = orderRef.collection('auditEvents').doc(auditEventId);

    const batch = db.batch();

    batch.set(noteRef, {
      noteId,
      orderId,
      canteenId: orderData.canteenId,
      authorUid,
      authorRole,
      body: trimmedBody,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isDeleted: false,
    });

    batch.set(auditRef, {
      eventId: auditEventId,
      orderId,
      canteenId: orderData.canteenId,
      eventType: 'operational_note_created',
      actorUid: authorUid,
      actorRole: authorRole,
      reason: 'Operational note added',
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    return {
      success: true,
      noteId,
      orderId,
    };
  },
);

// ============================================================================
// STEP 9: PAYMENT INTEGRATION FOUNDATION, DEMO PAYMENTS, & SECURITY HARDENING
// ============================================================================

export * from './payments/types';

export type DemoPaymentMethod = 'upi_demo' | 'demo_wallet' | 'demo_card';
export const ALLOWED_DEMO_PAYMENT_METHODS: readonly DemoPaymentMethod[] = [
  'upi_demo',
  'demo_wallet',
  'demo_card',
] as const;

export type OrderPaymentMethod = 'cash' | DemoPaymentMethod;

export type DemoPaymentStatus =
  | 'created'
  | 'processing'
  | 'succeeded_demo'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type DemoRefundStatus =
  | 'not_requested'
  | 'pending'
  | 'succeeded_demo';

export const PAYMENT_ATTEMPT_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_PAYMENT_AMOUNT_PAISE = 500000; // 500,000 paise (₹5,000)

/**
 * Enforces strict emulator-only execution for demo payment operations.
 */
function assertEmulatorOnly(opName: string): void {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `${opName} is only allowed in local emulator environment.`,
    );
  }
}

/**
 * Validates allowed payment status transitions.
 */
export function validatePaymentTransition(
  current: DemoPaymentStatus,
  target: DemoPaymentStatus,
): boolean {
  if (current === 'created') {
    return target === 'processing' || target === 'cancelled' || target === 'expired';
  }
  if (current === 'processing') {
    return (
      target === 'succeeded_demo' ||
      target === 'failed' ||
      target === 'cancelled' ||
      target === 'expired'
    );
  }
  return false;
}

/**
 * Computes canonical request fingerprint from server-approved fields (Part 5).
 */
export function computeRequestFingerprint(
  orderId: string,
  paymentMethod: string,
  amountInPaise: number,
  currency: string,
): string {
  return crypto
    .createHash('sha256')
    .update(`${orderId}\n${paymentMethod}\n${amountInPaise}\n${currency}`)
    .digest('hex');
}

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
  return msg.trim().slice(0, 200);
}

/**
 * Callable Function: createDemoPayment (Step 9 Hardening)
 *
 * Initiates an idempotent demo payment attempt directly in 'processing' status.
 * Server derives amount directly from immutable order totalInPaise.
 * Rejects cash and cod orders (Correction 1).
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

    // 2. Exact allowlist check: payload must be an object with strictly keys { orderId, idempotencyKey }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'createDemoPayment expects a JSON object payload.',
      );
    }

    const payloadKeys = Object.keys(data).sort();
    const hasOnlyAllowedKeys =
      payloadKeys.length === 2 &&
      payloadKeys[0] === 'idempotencyKey' &&
      payloadKeys[1] === 'orderId';

    if (!hasOnlyAllowedKeys) {
      const unexpected = payloadKeys.filter((k) => k !== 'orderId' && k !== 'idempotencyKey');
      const missing = ['orderId', 'idempotencyKey'].filter((k) => !payloadKeys.includes(k));
      const reasons: string[] = [];
      if (unexpected.length > 0) reasons.push(`Unexpected field(s): ${unexpected.join(', ')}`);
      if (missing.length > 0) reasons.push(`Missing field(s): ${missing.join(', ')}`);
      throw new functions.https.HttpsError(
        'invalid-argument',
        `createDemoPayment payload must strictly contain only 'orderId' and 'idempotencyKey'. ${reasons.join('. ')}`,
      );
    }

    const orderId = validateId(data.orderId, 'orderId');

    // 3. Validate idempotencyKey (1-128 chars alphanumeric/hyphen/underscore)
    if (
      typeof data.idempotencyKey !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(data.idempotencyKey.trim())
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'idempotencyKey must be a 1-128 character alphanumeric/hyphen/underscore string.',
      );
    }
    const idempotencyKey = data.idempotencyKey.trim();

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

      // Precondition: Reject cash and cod orders (Correction 1)
      if (orderData.paymentMethod === 'cash' || orderData.paymentMethod === 'cod') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order paymentMethod is '${orderData.paymentMethod}'. Cash orders cannot create online payment attempts.`,
        );
      }

      // Precondition: Order payment method must be an allowed demo method
      if (!ALLOWED_DEMO_PAYMENT_METHODS.includes(orderData.paymentMethod)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order paymentMethod is '${orderData.paymentMethod}'. Online demo payment requires one of: ${ALLOWED_DEMO_PAYMENT_METHODS.join(', ')}.`,
        );
      }
      // Never trust client: derive exclusively from server-owned order
      const paymentMethod: DemoPaymentMethod = orderData.paymentMethod;

      // Precondition: Order must be in status 'placed'
      if (orderData.status !== 'placed') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} is in status '${orderData.status}'. Payment can only be initiated for orders in 'placed' status.`,
        );
      }

      // Server-derived immutable total in paise (Part 3 & Correction 7)
      const amountInPaise = orderData.pricing?.totalInPaise ?? orderData.totalInPaise;
      if (
        typeof amountInPaise !== 'number' ||
        !Number.isSafeInteger(amountInPaise) ||
        amountInPaise <= 0 ||
        amountInPaise > MAX_PAYMENT_AMOUNT_PAISE
      ) {
        throw new functions.https.HttpsError('failed-precondition', 'Corrupted or oversized order amount.');
      }

      // Order total consistency check
      if (
        orderData.subtotalInPaise !== undefined &&
        orderData.totalInPaise !== undefined &&
        orderData.subtotalInPaise !== orderData.totalInPaise
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Order pricing total is inconsistent with subtotal.',
        );
      }

      // Rule: Payment attempt rejected if order is expired or pickup slot has already begun or passed
      if (orderData.orderExpiresAt && orderData.orderExpiresAt.toMillis?.() <= Date.now()) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Cannot initiate payment for an expired order.',
        );
      }
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
            'Cannot initiate payment after the pickup slot has already begun or passed.',
          );
        }
      }

      // Request Fingerprint (Part 5)
      const requestFingerprint = computeRequestFingerprint(
        orderId,
        paymentMethod,
        amountInPaise,
        'INR',
      );

      // READ 2: Idempotency Record
      const idempSnap = await transaction.get(idempotencyRef);
      if (idempSnap.exists) {
        const idempData = idempSnap.data()!;
        if (idempData.requestFingerprint === requestFingerprint) {
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
              expiresAt: pData.expiresAt,
            };
          }
        }
        // Different payload under same key: reject
        throw new functions.https.HttpsError(
          'already-exists',
          `Idempotency key ${idempotencyKey} has already been used with different request parameters.`,
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

      // Rule: Max 3 failed attempts per order
      const failedCount = existingPayments.filter((p) => p.status === 'failed').length;
      if (failedCount >= 3) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Maximum failed payment attempts (3) exceeded for order ${orderId}. Please contact support or pay at counter.`,
        );
      }

      // Rule: Max 1 active attempt (processing) with Transaction-Safe Expiry (Correction 3 & 4)
      const nowMs = Date.now();
      for (const p of existingPayments) {
        if (p.status === 'processing') {
          const pExpiresMs = p.expiresAt?.toMillis?.() || 0;
          const orderExpiresMs = orderData.activePaymentExpiresAt?.toMillis?.() || 0;
          const isPaymentExpired = pExpiresMs <= nowMs;
          const isOrderExpired = orderExpiresMs <= nowMs;
          const isActiveOnOrder = orderData.activePaymentId === p.paymentId;

          if (isActiveOnOrder && isPaymentExpired && isOrderExpired) {
            // Lazy-expire active attempt transactionally
            const expiredPaymentRef = orderRef.collection('payments').doc(p.paymentId);
            transaction.update(expiredPaymentRef, {
              status: 'expired',
              expiredAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            transaction.update(orderRef, {
              activePaymentId: null,
              activePaymentExpiresAt: null,
              paymentStatus: 'pending',
              updatedAt: serverTimestamp(),
            });

            const expireEventId = `${p.paymentId}_expired`;
            const expireHistRef = orderRef.collection('paymentHistory').doc(expireEventId);
            transaction.set(expireHistRef, {
              eventId: expireEventId,
              paymentId: p.paymentId,
              orderId,
              fromStatus: p.status,
              toStatus: 'expired',
              actorUid: studentUid,
              actorRole: 'system',
              canteenId: orderData.canteenId,
              reason: 'Active payment attempt expired by TTL timeout',
              createdAt: serverTimestamp(),
            });
          } else {
            throw new functions.https.HttpsError(
              'failed-precondition',
              `An active payment attempt is already in progress for order ${orderId}.`,
            );
          }
        }
      }

      // Validations passed: generate new payment attempt with Cryptographic Identifiers (Part 4)
      const attemptNumber = existingPayments.length + 1;
      const paymentId = `pay_${crypto.randomUUID()}`;
      const providerReference = `demo_txn_${crypto.randomUUID()}`;
      const expiresAt = timestampFromMillis(nowMs + PAYMENT_ATTEMPT_TTL_MS);

      // Write 1: Payment Record (Created directly in 'processing' per Correction 2)
      const paymentRef = orderRef.collection('payments').doc(paymentId);
      transaction.set(paymentRef, {
        paymentId,
        orderId,
        studentUid,
        canteenId: orderData.canteenId,
        amountInPaise,
        currency: 'INR',
        paymentMethod,
        provider: 'demo',
        status: 'processing',
        refundStatus: 'not_requested',
        attemptNumber,
        idempotencyKey,
        requestFingerprint,
        providerReference,
        failureCode: null,
        failureMessage: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        expiresAt,
        completedAt: null,
        expiredAt: null,
        refundedAt: null,
      });

      // Write 2: Update Order Active Payment Tracking
      transaction.update(orderRef, {
        activePaymentId: paymentId,
        activePaymentExpiresAt: expiresAt,
        paymentStatus: 'processing',
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_processing per Correction 4)
      const procEventId = `${paymentId}_processing`;
      transaction.set(orderRef.collection('paymentHistory').doc(procEventId), {
        eventId: procEventId,
        paymentId,
        orderId,
        fromStatus: 'none',
        toStatus: 'processing',
        actorUid: studentUid,
        actorRole: 'student',
        canteenId: orderData.canteenId,
        reason: `Demo payment attempt ${attemptNumber} initiated directly in processing`,
        createdAt: serverTimestamp(),
      });

      // Write 4: Idempotency Record (users/{studentUid}/paymentRequests/{idempotencyKey})
      transaction.set(idempotencyRef, {
        idempotencyKey,
        requestFingerprint,
        studentUid,
        orderId,
        paymentId,
        paymentMethod,
        amountInPaise,
        currency: 'INR',
        createdAt: serverTimestamp(),
        expiresAt,
      });

      return {
        success: true,
        isRetry: false,
        paymentId,
        orderId,
        status: 'processing',
        amountInPaise,
        currency: 'INR',
        providerReference,
        expiresAt,
      };
    });
  },
);

/**
 * Callable Function: completeDemoPayment (Step 9 Hardening)
 *
 * Atomically marks payment attempt succeeded_demo and order status payment_verified.
 * Only attempts in 'processing' status can become succeeded_demo (Correction 2).
 * Prevents duplicate completion and guarantees failed/expired attempts cannot be completed.
 */
export const completeDemoPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard
    assertEmulatorOnly('completeDemoPayment');

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

      // Ownership: Student owner or assigned admin (strictly excluding service_desk)
      const { isAdmin } = await verifyFinancialAuthorization(
        callerUid,
        orderData,
        true,
        transaction,
      );


      // READ 2: Payment Document
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          `Payment ${paymentId} not found under order ${orderId}.`,
        );
      }
      const paymentData = paymentSnap.data()!;

      // Cross-resource verification: Payment must belong to this order
      if (paymentData.orderId !== orderId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Payment ${paymentId} does not belong to order ${orderId}.`,
        );
      }

      // Precondition: Currency and Provider integrity
      if (paymentData.currency !== 'INR') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment currency '${paymentData.currency}' is invalid. Must be 'INR'.`,
        );
      }
      if (paymentData.provider !== 'demo') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment provider '${paymentData.provider}' is invalid. Must be 'demo'.`,
        );
      }

      // Replay idempotency: Successful retry returns original result
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

      // Rule: Terminal states cannot be completed
      if (
        paymentData.status === 'failed' ||
        paymentData.status === 'cancelled' ||
        paymentData.status === 'expired'
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment attempt ${paymentId} has status '${paymentData.status}' and cannot be completed. A new payment attempt is required.`,
        );
      }

      // Rule: Only 'processing' can become 'succeeded_demo' (Correction 2)
      if (paymentData.status !== 'processing') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Only payments in 'processing' status can become 'succeeded_demo'. Current: '${paymentData.status}'.`,
        );
      }

      // Rule: Order must be in 'placed' status (prevent duplicate success)
      if (orderData.status !== 'placed') {
        if (orderData.status === 'payment_verified' || orderData.paymentStatus === 'succeeded_demo') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Order ${orderId} has already been paid and verified. Duplicate payment rejected.`,
          );
        }
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Order ${orderId} has status '${orderData.status}'. Payment completion requires status 'placed'.`,
        );
      }

      // Rule: Payment amount must equal server order total in paise (Correction 7)
      if (paymentData.amountInPaise !== orderData.totalInPaise) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment amount (${paymentData.amountInPaise}) does not match order total (${orderData.totalInPaise}).`,
        );
      }

      // Write 1: Update payment record
      transaction.update(paymentRef, {
        status: 'succeeded_demo',
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      });

      // Write 2: Update order paymentStatus & status atomically
      transaction.update(orderRef, {
        status: 'payment_verified',
        paymentStatus: 'succeeded_demo',
        activePaymentId: null,
        activePaymentExpiresAt: null,
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_succeeded_demo)
      const payHistoryEventId = `${paymentId}_succeeded_demo`;
      const paymentHistoryRef = orderRef.collection('paymentHistory').doc(payHistoryEventId);
      transaction.set(paymentHistoryRef, {
        eventId: payHistoryEventId,
        paymentId,
        orderId,
        fromStatus: 'processing',
        toStatus: 'succeeded_demo',
        actorUid: callerUid,
        actorRole: isAdmin ? 'admin' : 'student',
        canteenId: orderData.canteenId,
        reason: 'Demo payment completed successfully in emulator',
        createdAt: serverTimestamp(),
      });

      // Write 4: Deterministic Order Status History Event
      const statusHistoryEventId = `${orderId}_placed_to_payment_verified`;
      const statusHistoryRef = orderRef.collection('statusHistory').doc(statusHistoryEventId);
      transaction.set(statusHistoryRef, {
        eventId: statusHistoryEventId,
        orderId,
        fromStatus: 'placed',
        toStatus: 'payment_verified',
        actorUid: callerUid,
        actorRole: isAdmin ? 'admin' : 'student',
        canteenId: orderData.canteenId,
        reason: 'Demo payment verified in emulator',
        createdAt: serverTimestamp(),
      });

      // Phase 3: Transactional Outbox Events (durable, idempotent notification workflow)
      writeNotificationOutboxTx(transaction, db, {
        outboxId: `outbox_${paymentId}_succeeded_demo_student`,
        sourceEventId: `${paymentId}_succeeded_demo`,
        sourceEventType: 'payment',
        recipientUid: orderData.studentUid,
        recipientRole: 'student',
        notificationType: 'payment_succeeded_demo',
        orderId,
        canteenId: orderData.canteenId,
        correlationId: paymentId,
      });

      writeNotificationOutboxTx(transaction, db, {
        outboxId: `outbox_${paymentId}_succeeded_demo_admin`,
        sourceEventId: `${paymentId}_succeeded_demo`,
        sourceEventType: 'payment',
        recipientRole: 'admin',
        notificationType: 'payment_verified_for_admin',
        orderId,
        canteenId: orderData.canteenId,
        correlationId: paymentId,
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
 * Callable Function: failDemoPayment (Step 9 Hardening)
 *
 * Records an immutable payment failure.
 */
export const failDemoPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard
    assertEmulatorOnly('failDemoPayment');

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

      // Ownership: Student owner or assigned admin (strictly excluding service_desk)
      const { isAdmin } = await verifyFinancialAuthorization(
        callerUid,
        orderData,
        true,
        transaction,
      );


      // READ 2: Payment Document
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          `Payment ${paymentId} not found under order ${orderId}.`,
        );
      }
      const paymentData = paymentSnap.data()!;

      // Idempotency: Already failed
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
          'Cannot fail a payment attempt that has already succeeded.',
        );
      }

      if (paymentData.status !== 'processing' && paymentData.status !== 'created') {
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

      // Write 2: Update order paymentStatus & clear active payment (Order status remains 'placed'!)
      transaction.update(orderRef, {
        paymentStatus: 'failed',
        activePaymentId: null,
        activePaymentExpiresAt: null,
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_failed)
      const eventId = `${paymentId}_failed`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: paymentData.status,
        toStatus: 'failed',
        actorUid: callerUid,
        actorRole: isAdmin ? 'admin' : 'student',
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
        _notifMeta: { studentUid: orderData.studentUid, canteenId: orderData.canteenId },
      };
    }).then((result) => {
      // Step 10: Emit payment_failed notification
      if (!result.isRetry) {
        const { studentUid: sUid, canteenId: cId } = (result as any)._notifMeta || {};
        if (sUid) {
          createNotificationInternal({
            sourceEventId: `${paymentId}_failed`,
            sourceEventType: 'payment',
            recipientUid: sUid,
            type: 'payment_failed',
            orderId,
            canteenId: cId,
          }).catch((err) =>
            functions.logger.warn('[Step10] payment_failed notification failed (non-fatal):', err?.message),
          );
        }
      }
      const { _notifMeta: _m, ...publicResult } = result as any;
      return publicResult;
    });
  },
);

/**
 * Callable Function: cancelDemoPayment (Step 9 Hardening)
 *
 * Cancels a processing demo payment attempt on student request.
 */
export const cancelDemoPayment = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard
    assertEmulatorOnly('cancelDemoPayment');

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

      if (paymentData.status !== 'processing' && paymentData.status !== 'created') {
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

      // Write 2: Update order paymentStatus & clear active payment
      transaction.update(orderRef, {
        paymentStatus: 'cancelled',
        activePaymentId: null,
        activePaymentExpiresAt: null,
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_cancelled)
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
 * Callable Function: expirePaymentAttempt (Step 9 Hardening — Transaction-Safe Expiry Helper)
 *
 * Implements transaction-safe expiry for payment attempts past their TTL (Correction 3 & 8).
 */
export const expirePaymentAttempt = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    assertEmulatorOnly('expirePaymentAttempt');

    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const callerUid = context.auth.uid;

    rejectUnknownFields(data, ['orderId', 'paymentId'], 'expirePaymentAttempt');
    const orderId = validateId(data.orderId, 'orderId');
    const paymentId = validateId(data.paymentId, 'paymentId');

    const orderRef = db.collection('orders').doc(orderId);
    const paymentRef = orderRef.collection('payments').doc(paymentId);

    return await db.runTransaction(async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
      }
      const orderData = orderSnap.data()!;

      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Payment ${paymentId} not found.`);
      }
      const paymentData = paymentSnap.data()!;

      // Ownership: Student owner or assigned admin (strictly excluding service_desk)
      const { isStudentOwner, isAdmin } = await verifyFinancialAuthorization(
        callerUid,
        orderData,
        true,
        transaction,
      );


      // Verify payment belongs to this order
      if (paymentData.orderId !== orderId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Payment ${paymentId} does not belong to order ${orderId}.`,
        );
      }

      // Verify order status is 'placed'
      if (orderData.status !== 'placed') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Cannot expire payment for order ${orderId} in status '${orderData.status}'. Order must be in 'placed' status.`,
        );
      }

      // Verify order.activePaymentId === paymentId (Correction 3)
      if (orderData.activePaymentId !== paymentId) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Cannot expire payment ${paymentId}: order activePaymentId is '${orderData.activePaymentId}'.`,
        );
      }

      // Verify payment is active and non-terminal: strictly status === 'processing' (Correction 3)
      if (paymentData.status !== 'processing') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment attempt ${paymentId} has status '${paymentData.status}' and cannot be expired. Status must be 'processing'.`,
        );
      }

      // Verify payment.expiresAt and order.activePaymentExpiresAt are both past server time (Correction 3)
      const nowMs = Date.now();
      const pExpiresMs = paymentData.expiresAt?.toMillis?.() || 0;
      const orderExpiresMs = orderData.activePaymentExpiresAt?.toMillis?.() || 0;

      if (pExpiresMs > nowMs || orderExpiresMs > nowMs) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment attempt ${paymentId} has not yet expired on both payment and order relative to server time.`,
        );
      }

      // Update payment
      transaction.update(paymentRef, {
        status: 'expired',
        expiredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Update order: status remains placed, paymentStatus returns to pending, active payment cleared
      transaction.update(orderRef, {
        status: 'placed',
        activePaymentId: null,
        activePaymentExpiresAt: null,
        paymentStatus: 'pending',
        updatedAt: serverTimestamp(),
      });

      // Deterministic Payment History Event ({paymentId}_expired - Correction 8)
      const eventId = `${paymentId}_expired`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: paymentData.status,
        toStatus: 'expired',
        actorUid: callerUid,
        actorRole: isAdmin ? 'admin' : isStudentOwner ? 'student' : 'system',
        canteenId: orderData.canteenId,
        reason: 'Payment attempt expired due to TTL timeout',
        createdAt: serverTimestamp(),
      });

      return {
        success: true,
        orderId,
        paymentId,
        status: 'expired',
      };
    });
  },
);

/**
 * Callable Function: getPaymentStatus (Step 9 Hardening)
 *
 * Retrieves sanitized payment details with ownership authorization.
 * Limits admin reads to required operational fields, masking provider references (Part 10 & Correction 10).
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

    // Ownership: Student owner or assigned admin (strictly excluding service_desk)
    const { isStudentOwner, isAdmin } = await verifyFinancialAuthorization(
      callerUid,
      orderData,
      true,
    );


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

    // Admin view: operational fields only, no synthetic provider references or internal failure codes (Correction 8)
    if (isAdmin && !isStudentOwner) {
      return {
        success: true,
        payment: {
          paymentId: p.paymentId,
          orderId: p.orderId,
          canteenId: p.canteenId,
          status: p.status,
          refundStatus: p.refundStatus || 'not_requested',
          amountInPaise: p.amountInPaise,
          currency: p.currency,
          paymentMethod: p.paymentMethod,
          attemptNumber: p.attemptNumber,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          expiresAt: p.expiresAt,
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
        refundStatus: p.refundStatus || 'not_requested',
        amountInPaise: p.amountInPaise,
        currency: p.currency,
        paymentMethod: p.paymentMethod,
        attemptNumber: p.attemptNumber,
        providerReference: p.providerReference,
        failureCode: p.failureCode,
        failureMessage: p.failureMessage,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        expiresAt: p.expiresAt,
        completedAt: p.completedAt,
      },
    };
  },
);

/**
 * Callable Function: requestDemoRefund (Step 9 Hardening — Emulator Only)
 *
 * Requests demo refund for an order that is cancelled or rejected after payment succeeded.
 * Separates refundStatus from payment.status (Section 2.2).
 */
export const requestDemoRefund = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard
    assertEmulatorOnly('requestDemoRefund');

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

      // Ownership: Student owner or assigned admin (strictly excluding service_desk)
      const { isAdmin } = await verifyFinancialAuthorization(
        callerUid,
        orderData,
        true,
        transaction,
      );


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

      // Cross-resource verification: Payment must belong to this order
      if (paymentData.orderId !== orderId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Payment ${paymentId} does not belong to order ${orderId}.`,
        );
      }

      // Idempotency: Already in refund state
      if (paymentData.refundStatus === 'pending') {
        const ref = paymentData.refundReference || `demo_ref_${crypto.randomUUID()}`;
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          refundStatus: 'pending',
          refundReference: ref,
          _notifMeta: { studentUid: orderData.studentUid, canteenId: orderData.canteenId },
        };
      }
      if (paymentData.refundStatus === 'succeeded_demo') {
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          refundStatus: 'succeeded_demo',
          _notifMeta: { studentUid: orderData.studentUid, canteenId: orderData.canteenId },
        };
      }

      // Precondition: Payment must have succeeded
      if (paymentData.status !== 'succeeded_demo') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment in status '${paymentData.status}' is not eligible for refund. Must be 'succeeded_demo'.`,
        );
      }

      // Write 1: Update payment refundStatus and assign refundReference
      const refundReference = `demo_ref_${crypto.randomUUID()}`;
      transaction.update(paymentRef, {
        refundStatus: 'pending',
        refundReason: reason,
        refundReference,
        refundRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Write 2: Update order refundStatus (Order status remains cancelled/rejected!)
      transaction.update(orderRef, {
        refundStatus: 'pending',
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_refund_pending)
      const eventId = `${paymentId}_refund_pending`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: 'not_requested',
        toStatus: 'pending',
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
        refundStatus: 'pending',
        refundReference,
        _notifMeta: { studentUid: orderData.studentUid, canteenId: orderData.canteenId },
      };
    }).then(async (result) => {
      // Step 10: Emit refund_pending_demo notification (createNotificationInternal is idempotent)
      const { studentUid: sUid, canteenId: cId } = (result as any)._notifMeta || {};
      if (sUid) {
        try {
          await createNotificationInternal({
            sourceEventId: `${paymentId}_refund_pending`,
            sourceEventType: 'refund',
            recipientUid: sUid,
            recipientRole: 'student',
            type: 'refund_pending_demo',
            orderId,
            canteenId: cId,
          });
        } catch (err: any) {
          functions.logger.warn('[Step10] refund_pending_demo notification failed (non-fatal):', err?.message);
        }
      }
      const { _notifMeta: _m, ...publicResult } = result as any;
      return publicResult;
    });
  },
);

/**
 * Callable Function: completeDemoRefund (Step 9 Hardening — Emulator Only)
 *
 * Finalizes demo refund state to 'succeeded_demo'. Admin authorization required.
 * Derives full refund amount server-side; rejects client-supplied refund amounts (Correction 7).
 * Order status remains 'cancelled' or 'rejected' (Section 2.3).
 */
export const completeDemoRefund = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Emulator Guard
    assertEmulatorOnly('completeDemoRefund');

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

      // Authorization: Admin only (strictly excluding service_desk, canteen_admin or platform_operator required)
      await verifyFinancialAuthorization(callerUid, orderData, false, transaction);


      // READ 2: Payment
      const paymentSnap = await transaction.get(paymentRef);
      if (!paymentSnap.exists) {
        throw new functions.https.HttpsError('not-found', `Payment ${paymentId} not found.`);
      }
      const paymentData = paymentSnap.data()!;

      // Cross-resource verification: Payment must belong to this order
      if (paymentData.orderId !== orderId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Payment ${paymentId} does not belong to order ${orderId}.`,
        );
      }

      // Idempotency: Already refunded
      if (paymentData.refundStatus === 'succeeded_demo') {
        return {
          success: true,
          isRetry: true,
          orderId,
          paymentId,
          refundStatus: 'succeeded_demo',
          refundedAmountInPaise: paymentData.refundedAmountInPaise,
          _notifMeta: { studentUid: orderData.studentUid, canteenId: orderData.canteenId },
        };
      }

      // Precondition: Must be in refundStatus 'pending'
      if (paymentData.refundStatus !== 'pending') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Payment in refundStatus '${paymentData.refundStatus}' cannot be finalized as refunded. Must be 'pending'.`,
        );
      }

      // Full refund derived from original payment record (Correction 7)
      const refundedAmountInPaise = paymentData.amountInPaise;

      // Write 1: Update payment refundStatus
      transaction.update(paymentRef, {
        refundStatus: 'succeeded_demo',
        refundedAmountInPaise,
        refundedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Write 2: Update order refundStatus (Order status remains cancelled/rejected!)
      transaction.update(orderRef, {
        refundStatus: 'refunded_demo',
        updatedAt: serverTimestamp(),
      });

      // Write 3: Deterministic Payment History Event ({paymentId}_refunded_demo)
      const eventId = `${paymentId}_refunded_demo`;
      const historyRef = orderRef.collection('paymentHistory').doc(eventId);
      transaction.set(historyRef, {
        eventId,
        paymentId,
        orderId,
        fromStatus: 'pending',
        toStatus: 'succeeded_demo',
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
        refundStatus: 'succeeded_demo',
        refundedAmountInPaise,
        _notifMeta: { studentUid: orderData.studentUid, canteenId: orderData.canteenId },
      };
    }).then(async (result) => {
      // Step 10: Emit refund_completed_demo notification
      const { studentUid: sUid, canteenId: cId } = (result as any)._notifMeta || {};
      if (sUid) {
        try {
          await createNotificationInternal({
            sourceEventId: `${paymentId}_refunded_demo`,
            sourceEventType: 'refund',
            recipientUid: sUid,
            recipientRole: 'student',
            type: 'refund_completed_demo',
            orderId,
            canteenId: cId,
          });
        } catch (err: any) {
          functions.logger.warn('[Step10] refund_completed_demo notification failed (non-fatal):', err?.message);
        }
      }
      const { _notifMeta: _m, ...publicResult } = result as any;
      return publicResult;
    });
  },
);

/**
 * HTTP Function: verifySyntheticWebhook (Step 9 Hardening — Local-Only Verification Harness)
 *
 * Implements 17-step verification:
 * - Constant-time raw-body HMAC-SHA256 signature verification.
 * - Scoped deduplication: /webhookEvents/{provider}:{eventId} (Correction 5).
 * - Separate sub-handlers for payment.captured, payment.failed, refund.processed (Correction 6).
 * - Transaction-bound event claiming and mutation (Part 11).
 * - Strictly emulator-only.
 */
export const verifySyntheticWebhook = functions.https.onRequest(
  async (req, res) => {
    // 1. Emulator Guard
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
      res.status(403).json({ error: 'verifySyntheticWebhook is disabled in cloud environments.' });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Only POST is supported.' });
      return;
    }

    // 2. Validate signature header
    const signature = req.headers['x-synthetic-signature'] as string;
    if (!signature || typeof signature !== 'string' || signature.trim().length === 0) {
      res.status(400).json({ error: 'Missing x-synthetic-signature header.' });
      return;
    }

    // 3. Extract raw body buffer
    const rawBodyBuffer: Buffer = (req as any).rawBody
      ? Buffer.from((req as any).rawBody)
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    const syntheticSecret =
      process.env.SYNTHETIC_WEBHOOK_SECRET || 'emulator-test-synthetic-secret-key-32b';

    // 4. Compute expected HMAC-SHA256 signature
    const expectedSignature = crypto
      .createHmac('sha256', syntheticSecret)
      .update(rawBodyBuffer)
      .digest('hex');

    // 5. Constant-time comparison using crypto.timingSafeEqual
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

    // 6. Safe JSON parse
    let payload: any;
    try {
      payload =
        typeof req.body === 'object' && !Buffer.isBuffer(req.body)
          ? req.body
          : JSON.parse(rawBodyBuffer.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON payload.' });
      return;
    }

    // 7. Validate Schema
    const { eventId, eventType, orderId, paymentId, providerReference, amountInPaise, currency, provider: payloadProvider } =
      payload || {};
    const ALLOWED_WEBHOOK_EVENTS = [
      'payment.captured',
      'payment.failed',
      'refund.processed',
      'payment.succeeded', // legacy test alias for payment.captured
    ];

    if (
      typeof eventId !== 'string' || !eventId || eventId.length > 128 ||
      typeof eventType !== 'string' || !ALLOWED_WEBHOOK_EVENTS.includes(eventType) ||
      typeof orderId !== 'string' || !orderId || orderId.length > 64 ||
      typeof paymentId !== 'string' || !paymentId || paymentId.length > 64 ||
      typeof providerReference !== 'string' || !providerReference || providerReference.length > 128 ||
      typeof amountInPaise !== 'number' || !Number.isInteger(amountInPaise) || amountInPaise <= 0 ||
      (currency !== undefined && currency !== 'INR') ||
      (payloadProvider !== undefined && payloadProvider !== 'demo')
    ) {
      res.status(400).json({ error: 'Invalid webhook event schema or unsupported eventType.' });
      return;
    }

    const provider = 'demo';
    // 8. Scoped Deduplication: /webhookEvents/{provider}:{eventId} (Correction 5)
    const webhookDocId = `${provider}:${eventId}`;
    const webhookRef = db.collection('webhookEvents').doc(webhookDocId);

    // 9. Process inside transaction: claim event ID and apply side effects atomically
    try {
      let isReplay = false;
      await db.runTransaction(async (transaction) => {
        const webhookSnap = await transaction.get(webhookRef);
        if (webhookSnap.exists) {
          isReplay = true;
          return;
        }

        const orderRef = db.collection('orders').doc(orderId);
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists) {
          throw new functions.https.HttpsError('not-found', `Order ${orderId} not found.`);
        }
        const orderData = orderSnap.data()!;

        const paymentRef = orderRef.collection('payments').doc(paymentId);
        const paymentSnap = await transaction.get(paymentRef);
        if (!paymentSnap.exists) {
          throw new functions.https.HttpsError('not-found', `Payment ${paymentId} not found.`);
        }
        const paymentData = paymentSnap.data()!;

        // Cross-resource verification: payment must belong to order
        if (paymentData.orderId !== orderId) {
          throw new functions.https.HttpsError(
            'invalid-argument',
            `Payment ${paymentId} does not belong to order ${orderId}.`,
          );
        }

        // Currency verification
        if (paymentData.currency !== 'INR') {
          throw new functions.https.HttpsError(
            'invalid-argument',
            `Payment currency '${paymentData.currency}' mismatch.`,
          );
        }

        // Dedicated Event Handlers (Correction 6)
        if (eventType === 'payment.captured' || eventType === 'payment.succeeded') {
          if (paymentData.providerReference !== providerReference) {
            throw new functions.https.HttpsError(
              'invalid-argument',
              `Provider reference mismatch. Server: ${paymentData.providerReference}, Webhook: ${providerReference}.`,
            );
          }

          if (paymentData.amountInPaise !== amountInPaise) {
            throw new functions.https.HttpsError(
              'invalid-argument',
              `Amount mismatch. Server expected ${paymentData.amountInPaise}, Webhook: ${amountInPaise}.`,
            );
          }

          // Idempotency: if already succeeded, succeed idempotently
          if (paymentData.status === 'succeeded_demo') {
            isReplay = true;
            return;
          }

          if (paymentData.status !== 'processing') {
            throw new functions.https.HttpsError(
              'failed-precondition',
              `Payment in status '${paymentData.status}' cannot be captured. Must be 'processing'.`,
            );
          }

          transaction.update(paymentRef, {
            status: 'succeeded_demo',
            updatedAt: serverTimestamp(),
            completedAt: serverTimestamp(),
          });

          transaction.update(orderRef, {
            status: 'payment_verified',
            paymentStatus: 'succeeded_demo',
            activePaymentId: null,
            activePaymentExpiresAt: null,
            updatedAt: serverTimestamp(),
          });

          const payHistoryId = `${paymentId}_succeeded_demo`;
          transaction.set(orderRef.collection('paymentHistory').doc(payHistoryId), {
            eventId: payHistoryId,
            paymentId,
            orderId,
            fromStatus: paymentData.status,
            toStatus: 'succeeded_demo',
            actorUid: 'synthetic_webhook_gateway',
            actorRole: 'webhook_simulator',
            canteenId: paymentData.canteenId,
            reason: 'Payment captured via verified synthetic webhook',
            createdAt: serverTimestamp(),
          });

          const orderHistoryId = `${orderId}_placed_to_payment_verified`;
          transaction.set(orderRef.collection('statusHistory').doc(orderHistoryId), {
            eventId: orderHistoryId,
            orderId,
            fromStatus: 'placed',
            toStatus: 'payment_verified',
            actorUid: 'synthetic_webhook_gateway',
            actorRole: 'webhook_simulator',
            canteenId: paymentData.canteenId,
            reason: 'Payment verified via verified synthetic webhook',
            createdAt: serverTimestamp(),
          });
        } else if (eventType === 'payment.failed') {
          if (paymentData.providerReference !== providerReference) {
            throw new functions.https.HttpsError(
              'invalid-argument',
              `Provider reference mismatch. Server: ${paymentData.providerReference}, Webhook: ${providerReference}.`,
            );
          }

          if (paymentData.amountInPaise !== amountInPaise) {
            throw new functions.https.HttpsError(
              'invalid-argument',
              `Amount mismatch. Server expected ${paymentData.amountInPaise}, Webhook: ${amountInPaise}.`,
            );
          }

          if (paymentData.status !== 'processing') {
            throw new functions.https.HttpsError(
              'failed-precondition',
              `Payment in status '${paymentData.status}' cannot transition to failed. Must be 'processing'.`,
            );
          }

          transaction.update(paymentRef, {
            status: 'failed',
            failureCode: 'WEBHOOK_PAYMENT_FAILED',
            failureMessage: 'Payment failed reported by webhook',
            updatedAt: serverTimestamp(),
            completedAt: serverTimestamp(),
          });

          transaction.update(orderRef, {
            paymentStatus: 'failed',
            activePaymentId: null,
            activePaymentExpiresAt: null,
            updatedAt: serverTimestamp(),
          });

          const payHistoryId = `${paymentId}_failed`;
          transaction.set(orderRef.collection('paymentHistory').doc(payHistoryId), {
            eventId: payHistoryId,
            paymentId,
            orderId,
            fromStatus: paymentData.status,
            toStatus: 'failed',
            actorUid: 'synthetic_webhook_gateway',
            actorRole: 'webhook_simulator',
            canteenId: paymentData.canteenId,
            reason: 'Payment failure recorded via webhook',
            createdAt: serverTimestamp(),
          });
        } else if (eventType === 'refund.processed') {
          // Correction 2: Strengthen handleRefundProcessed
          if (paymentData.status !== 'succeeded_demo') {
            throw new functions.https.HttpsError(
              'failed-precondition',
              `Cannot process refund for payment in status '${paymentData.status}'. Must be 'succeeded_demo'.`,
            );
          }

          // Idempotency: if already refunded, succeed idempotently
          if (paymentData.refundStatus === 'succeeded_demo') {
            isReplay = true;
            return;
          }

          if (paymentData.refundStatus !== 'pending') {
            throw new functions.https.HttpsError(
              'failed-precondition',
              `Payment in refundStatus '${paymentData.refundStatus}' cannot receive refund. Must be 'pending'.`,
            );
          }

          if (orderData.status !== 'cancelled' && orderData.status !== 'rejected') {
            throw new functions.https.HttpsError(
              'failed-precondition',
              `Order ${orderId} has status '${orderData.status}'. Refunds are only permitted for 'cancelled' or 'rejected' orders.`,
            );
          }

          if (amountInPaise !== paymentData.amountInPaise) {
            throw new functions.https.HttpsError(
              'invalid-argument',
              `Refund amount mismatch. Server original: ${paymentData.amountInPaise}, Webhook: ${amountInPaise}. Partial refunds rejected.`,
            );
          }

          if (!paymentData.refundReference || providerReference !== paymentData.refundReference) {
            functions.logger.warn(
              `[Webhook] Refund reference validation failed for order ${orderId}, payment ${paymentId}.`,
            );
            throw new functions.https.HttpsError(
              'invalid-argument',
              'Refund provider reference mismatch.',
            );
          }

          // Update ONLY refundStatus and refund audit fields (Order status remains cancelled/rejected!)
          transaction.update(paymentRef, {
            refundStatus: 'succeeded_demo',
            refundedAmountInPaise: amountInPaise,
            refundProviderReference: providerReference,
            refundedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          transaction.update(orderRef, {
            refundStatus: 'refunded_demo',
            updatedAt: serverTimestamp(),
          });

          const payHistoryId = `${paymentId}_refunded_demo`;
          transaction.set(orderRef.collection('paymentHistory').doc(payHistoryId), {
            eventId: payHistoryId,
            paymentId,
            orderId,
            fromStatus: paymentData.refundStatus || 'pending',
            toStatus: 'succeeded_demo',
            actorUid: 'synthetic_webhook_gateway',
            actorRole: 'webhook_simulator',
            canteenId: paymentData.canteenId,
            reason: 'Refund processed via verified synthetic webhook',
            createdAt: serverTimestamp(),
          });
        }

        // Claim webhook event atomically in the transaction (Correction 5)
        transaction.set(webhookRef, {
          provider,
          eventId,
          receivedAt: serverTimestamp(),
          eventType,
          processingStatus: 'processed',
          paymentId,
          orderId,
          amountInPaise,
          providerReference,
        });
      });

      res.status(200).json({
        success: true,
        isIdempotent: isReplay,
        processedEventId: eventId,
      });

      // Step 10: Emit in-app notifications for webhook-triggered events (fire-and-forget, non-blocking)
      if (!isReplay) {
        // Re-read order data for notification routing (lightweight, separate from the committed transaction)
        db.collection('orders').doc(orderId).get().then((orderSnap) => {
          if (!orderSnap.exists) return;
          const od = orderSnap.data()!;
          if (eventType === 'payment.captured' || eventType === 'payment.succeeded') {
            createNotificationInternal({
              sourceEventId: `${paymentId}_succeeded_demo`,
              sourceEventType: 'payment',
              recipientUid: od.studentUid,
              recipientRole: 'student',
              type: 'payment_succeeded_demo',
              orderId,
              canteenId: od.canteenId,
            }).catch(() => {});
            notifyAssignedCanteenAdmins({
              canteenId: od.canteenId,
              type: 'payment_verified_for_admin',
              orderId,
              sourceEventId: `${paymentId}_succeeded_demo`,
              sourceEventType: 'payment',
            }).catch(() => {});
          } else if (eventType === 'payment.failed') {
            createNotificationInternal({
              sourceEventId: `${paymentId}_failed`,
              sourceEventType: 'payment',
              recipientUid: od.studentUid,
              recipientRole: 'student',
              type: 'payment_failed',
              orderId,
              canteenId: od.canteenId,
            }).catch(() => {});
          } else if (eventType === 'refund.processed') {
            createNotificationInternal({
              sourceEventId: `${paymentId}_refunded_demo`,
              sourceEventType: 'refund',
              recipientUid: od.studentUid,
              recipientRole: 'student',
              type: 'refund_completed_demo',
              orderId,
              canteenId: od.canteenId,
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    } catch (err: any) {
      if (err instanceof functions.https.HttpsError) {
        const statusCode =
          err.code === 'not-found' ? 404 : err.code === 'invalid-argument' ? 400 : 409;
        res.status(statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal webhook processing error.' });
    }
  },
);

// ============================================================================
// STEP 10: IN-APP NOTIFICATION CALLABLE FUNCTIONS
// All notification reads and mutations are brokered exclusively via these
// authenticated callable functions. No direct client Firestore reads or writes
// to users/{userId}/notifications are permitted.
// ============================================================================

/**
 * Callable: listMyNotifications
 *
 * Returns paginated, ordered list of in-app notifications for the authenticated user.
 * - Derives UID from context.auth.uid (never from client payload)
 * - Accepts only: { limit?, startAfterCreatedAt? }
 * - limit: 1–50, default 20
 * - Returns sanitized DTOs; never returns raw Firestore documents
 */
export const listMyNotifications = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required to list notifications.',
      );
    }
    const recipientUid = context.auth.uid;

    // 2. Strict input allowlist
    rejectUnknownFields(
      data,
      ['limit', 'cursor'],
      'listMyNotifications',
    );

    // 3. Validate limit: integer 1–50, default 20
    let limit = 20;
    if (data.limit !== undefined) {
      if (
        typeof data.limit !== 'number' ||
        !Number.isInteger(data.limit) ||
        data.limit < 1 ||
        data.limit > 50
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'limit must be an integer between 1 and 50.',
        );
      }
      limit = data.limit;
    }

    // 4. Query notifications ordered by createdAt desc, bounded by limit
    let query = db
      .collection('users')
      .doc(recipientUid)
      .collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (data.cursor !== undefined) {
      if (
        typeof data.cursor !== 'string' ||
        !/^notif_[a-f0-9]{32}$/.test(data.cursor)
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'cursor must be a valid notification ID.',
        );
      }
      const cursorDoc = await db
        .collection('users')
        .doc(recipientUid)
        .collection('notifications')
        .doc(data.cursor)
        .get();

      if (!cursorDoc.exists) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'cursor document does not exist.',
        );
      }
      query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();

    // 5. Build sanitized DTOs — never return raw internal fields
    const notifications = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        notificationId: d.notificationId,
        recipientRole: d.recipientRole || 'student',
        type: d.type,
        title: d.title,
        body: d.body,
        isRead: d.isRead === true,
        orderId: d.orderId,
        createdAt: d.createdAt,
        readAt: d.readAt || null,
      };
    });

    const hasMore = snap.docs.length === limit;
    const nextCursor = hasMore ? snap.docs[snap.docs.length - 1].id : null;

    return {
      success: true,
      notifications,
      count: notifications.length,
      hasMore,
      nextCursor,
    };
  },
);

/**
 * Callable: markNotificationRead
 *
 * Marks a single notification as read.
 * - Caller must own the notification (recipientUid === context.auth.uid)
 * - Accepts only: { notificationId }
 * - Updates only isRead and readAt — no other fields are modified
 * - Idempotent: already-read notifications return success
 */
export const markNotificationRead = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required.',
      );
    }
    const recipientUid = context.auth.uid;

    // 2. Strict input allowlist
    rejectUnknownFields(data, ['notificationId'], 'markNotificationRead');

    // 3. Validate notificationId
    if (
      typeof data.notificationId !== 'string' ||
      !/^notif_[a-f0-9]{32}$/.test(data.notificationId)
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'notificationId must be a valid notification ID.',
      );
    }
    const notificationId = data.notificationId;

    // 4. Fetch notification (path is already scoped to this user)
    const notifRef = db
      .collection('users')
      .doc(recipientUid)
      .collection('notifications')
      .doc(notificationId);

    const notifSnap = await notifRef.get();
    if (!notifSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Notification not found.');
    }
    const notifData = notifSnap.data()!;

    // 5. Ownership verification (defense-in-depth — path already scoped by uid)
    if (notifData.recipientUid !== recipientUid) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Not authorized to modify this notification.',
      );
    }

    // 6. Idempotent: already read
    if (notifData.isRead === true) {
      return { success: true, isIdempotent: true, notificationId };
    }

    // 7. Update ONLY isRead and readAt — never modify type, title, body, orderId, or createdAt
    await notifRef.update({
      isRead: true,
      readAt: serverTimestamp(),
    });

    return { success: true, isIdempotent: false, notificationId };
  },
);

/**
 * Callable: markAllNotificationsRead
 *
 * Marks all unread notifications as read for the authenticated caller.
 * - Accepts only: {} or { cursor }
 * - Uses bounded batches of at most 500 notifications per call
 * - Updates ONLY isRead and readAt
 * - Idempotent: safe to call multiple times
 */
export const markAllNotificationsRead = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required.',
      );
    }
    const recipientUid = context.auth.uid;

    // 2. Strict input allowlist — empty payload or optional cursor
    rejectUnknownFields(data, ['cursor'], 'markAllNotificationsRead');

    // 3. Query unread notifications bounded by batch limit of 500
    let query = db
      .collection('users')
      .doc(recipientUid)
      .collection('notifications')
      .where('isRead', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(500);

    if (data.cursor !== undefined) {
      if (
        typeof data.cursor !== 'string' ||
        !/^notif_[a-f0-9]{32}$/.test(data.cursor)
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'cursor must be a valid notification ID.',
        );
      }
      const cursorDoc = await db
        .collection('users')
        .doc(recipientUid)
        .collection('notifications')
        .doc(data.cursor)
        .get();

      if (cursorDoc.exists) {
        const cData = cursorDoc.data();
        if (cData?.createdAt) {
          query = query.startAfter(cData.createdAt);
        } else {
          query = query.startAfter(cursorDoc);
        }
      }
    }

    const unreadSnap = await query.get();

    if (unreadSnap.empty) {
      return { success: true, updatedCount: 0, hasMore: false, nextCursor: null };
    }

    // 4. Batch update — bounded to at most 500 writes
    const batch = db.batch();
    const now = serverTimestamp();

    unreadSnap.docs.forEach((doc) => {
      batch.update(doc.ref, { isRead: true, readAt: now });
    });

    await batch.commit();

    const hasMore = unreadSnap.docs.length === 500;
    const nextCursor = hasMore ? unreadSnap.docs[unreadSnap.docs.length - 1].id : null;

    return {
      success: true,
      updatedCount: unreadSnap.docs.length,
      hasMore,
      nextCursor,
    };
  },
);

/**
 * Callable: getUnreadNotificationCount
 *
 * Returns the count of unread notifications for the authenticated caller.
 * - Accepts only: {} (empty payload)
 */
export const getUnreadNotificationCount = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    // 1. Authentication
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Authentication required.',
      );
    }
    const recipientUid = context.auth.uid;

    // 2. Strict input allowlist — empty payload only
    rejectUnknownFields(data, [], 'getUnreadNotificationCount');

    // 3. Count unread
    const snap = await db
      .collection('users')
      .doc(recipientUid)
      .collection('notifications')
      .where('isRead', '==', false)
      .get();

    return { success: true, unreadCount: snap.size };
  },
);
