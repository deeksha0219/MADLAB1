/**
 * GrabNGo - Server-Side In-App Notification Service (Step 10)
 *
 * Security & Architectural Invariants:
 * 1. ZERO client writes: all notification records are written exclusively by trusted server code.
 * 2. Deterministic notification IDs computed from source event data — no random UUIDs for deduplication.
 * 3. Title and body are derived from server-owned templates only. Client-supplied copy is never accepted.
 * 4. Idempotent: re-delivering the same source event yields the same notification ID without overwriting.
 * 5. Conflicting payload on same ID fails closed — no silent overwrite.
 * 6. Admin fan-out is isolated to admins who are active and explicitly assigned to the affected canteen.
 * 7. Notification creation does NOT alter order, payment, refund, or capacity state.
 * 8. Strictly in-app only — no Firebase Cloud Messaging, push tokens, or external providers.
 *
 * Notification ID scheme:
 *   notif_{SHA256(sourceEventId + '_' + recipientUid + '_' + type).slice(0, 32)}
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

// ------------------------------------------------------------------
// Canonical Notification Types
// ------------------------------------------------------------------

export type StudentNotificationType =
  | 'order_placed'
  | 'payment_succeeded_demo'
  | 'payment_failed'
  | 'order_accepted'
  | 'order_preparing'
  | 'order_ready_for_pickup'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_rejected'
  | 'refund_pending_demo'
  | 'refund_completed_demo';

export type AdminNotificationType =
  | 'new_order_for_admin'
  | 'payment_verified_for_admin';

export type NotificationType = StudentNotificationType | AdminNotificationType;

// ------------------------------------------------------------------
// Input / Output Interfaces
// ------------------------------------------------------------------

export interface CreateNotificationInput {
  /** Unique ID for the source event (e.g., orderId_placed, paymentId_succeeded). Used for deduplication. */
  readonly sourceEventId: string;
  /** Firestore collection name identifying the kind of source event (e.g., 'order', 'payment', 'refund'). */
  readonly sourceEventType: 'order' | 'payment' | 'refund';
  readonly recipientUid: string;
  readonly recipientRole?: 'student' | 'admin';
  readonly type: NotificationType;
  /** Order ID for correlation (short display ID derived server-side). */
  readonly orderId?: string;
  /** Optional canteen ID for admin routing context. */
  readonly canteenId?: string;
}

export interface CreateNotificationResult {
  readonly notificationId: string;
  readonly isIdempotent: boolean;
}

// ------------------------------------------------------------------
// Server-Owned Message Templates
// Returns sanitized title + body. Short order ID = bounded alphanumeric last 6 chars.
// ------------------------------------------------------------------

export function sanitizeShortOrderId(orderId?: string | null): string {
  if (!orderId || typeof orderId !== 'string') {
    return '#UNKNOWN';
  }
  // Strip control characters, HTML tags, newlines, and symbols outside alphanumeric, hyphen, underscore
  const sanitized = orderId.replace(/[^a-zA-Z0-9_-]/g, '').trim();
  if (!sanitized) {
    return '#UNKNOWN';
  }
  // Bounded to last 6 characters uppercase
  const shortPart = sanitized.slice(-6).toUpperCase();
  return '#' + shortPart;
}

export function buildTemplate(
  type: NotificationType,
  orderId?: string | null,
): { title: string; body: string } {
  const sid = sanitizeShortOrderId(orderId);

  const templates: Record<NotificationType, { title: string; body: string }> = {
    // Student notifications
    order_placed: {
      title: '🧾 Order Placed',
      body: `Your order ${sid} has been placed successfully. Awaiting canteen confirmation.`,
    },
    payment_succeeded_demo: {
      title: '✅ Payment Successful (Demo)',
      body: `Demo payment for order ${sid} was successful. (Simulated payment; no real money was transferred).`,
    },
    payment_failed: {
      title: '❌ Payment Failed',
      body: `Demo payment for order ${sid} failed. Please try placing a new payment.`,
    },
    order_accepted: {
      title: '👍 Order Accepted',
      body: `Order ${sid} has been accepted by the canteen and is being prepared.`,
    },
    order_preparing: {
      title: '🍳 Order Being Prepared',
      body: `Your order ${sid} is now being prepared. It'll be ready for pickup soon!`,
    },
    order_ready_for_pickup: {
      title: '🔔 Ready for Pickup!',
      body: `Your order ${sid} is ready. Please collect it from the canteen.`,
    },
    order_completed: {
      title: '🎉 Order Completed',
      body: `Order ${sid} has been marked as completed. Enjoy your meal!`,
    },
    order_cancelled: {
      title: '🚫 Order Cancelled',
      body: `Order ${sid} has been cancelled. Please contact the canteen if this was unexpected.`,
    },
    order_rejected: {
      title: '⛔ Order Rejected',
      body: `Order ${sid} has been rejected by the canteen. You may place a new order.`,
    },
    refund_pending_demo: {
      title: '💰 Refund Initiated (Demo)',
      body: `A demo refund has been initiated for order ${sid}. Processing in progress.`,
    },
    refund_completed_demo: {
      title: '✅ Refund Completed (Demo)',
      body: `Demo refund for order ${sid} has been processed. Amount will be returned to your demo account.`,
    },
    // Admin notifications
    new_order_for_admin: {
      title: '🛎️ New Order Received',
      body: `A new order ${sid} has been placed at your canteen. Please review and accept.`,
    },
    payment_verified_for_admin: {
      title: '✅ Payment Verified (Demo)',
      body: `Demo payment for order ${sid} has been verified. The order is ready for acceptance. (Simulated payment).`,
    },
  };

  return templates[type] ?? {
    title: 'Notification',
    body: `Update on order ${sid}.`,
  };
}

// ------------------------------------------------------------------
// Core: createNotificationInternal
// Must be called from within a server-side function only. Can optionally
// share an existing Firestore transaction for atomicity.
// ------------------------------------------------------------------

export async function createNotificationInternal(
  input: CreateNotificationInput,
  transaction?: FirebaseFirestore.Transaction,
): Promise<CreateNotificationResult> {
  const db = admin.firestore();

  // 1. Derive role if not explicitly provided
  const recipientRole: 'student' | 'admin' =
    input.recipientRole ??
    (input.type === 'new_order_for_admin' || input.type === 'payment_verified_for_admin'
      ? 'admin'
      : 'student');

  // 2. Compute deterministic notification ID
  const hashInput = `${input.sourceEventId}_${input.recipientUid}_${input.type}`;
  const notificationId =
    'notif_' +
    crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 32);

  // 3. Build server-owned template
  const { title, body } = buildTemplate(input.type, input.orderId);

  // 4. Canonical notification document
  const notifRef = db
    .collection('users')
    .doc(input.recipientUid)
    .collection('notifications')
    .doc(notificationId);

function serverTimestamp(): admin.firestore.FieldValue {
  try {
    const { FieldValue } = require('firebase-admin/firestore');
    if (FieldValue?.serverTimestamp) return FieldValue.serverTimestamp();
  } catch {}
  try {
    const { FieldValue } = require('@google-cloud/firestore');
    if (FieldValue?.serverTimestamp) return FieldValue.serverTimestamp();
  } catch {}
  return admin.firestore.FieldValue.serverTimestamp();
}

  const docPayload: Record<string, any> = {
    notificationId,
    recipientUid: input.recipientUid,
    recipientRole,
    type: input.type,
    title,
    body,
    isRead: false,
    sourceEventId: input.sourceEventId,
    sourceEventType: input.sourceEventType,
    createdAt: serverTimestamp(),
  };
  if (input.orderId) {
    docPayload.orderId = input.orderId;
  }
  if (input.canteenId) {
    docPayload.canteenId = input.canteenId;
  }

  if (transaction) {
    // --- Within a transaction ---
    const existing = await transaction.get(notifRef);

    if (existing.exists) {
      const d = existing.data()!;
      // Idempotent: same type and same source event → return existing
      if (d.type === input.type && d.sourceEventId === input.sourceEventId) {
        return { notificationId, isIdempotent: true };
      }
      // Conflicting payload: fail closed — do NOT overwrite
      throw new Error(
        `[notificationService] Notification ID collision detected: ` +
          `existing type='${d.type}' vs new type='${input.type}' for id=${notificationId}. ` +
          `Failing closed without overwrite.`,
      );
    }

    transaction.set(notifRef, docPayload);

    return { notificationId, isIdempotent: false };
  } else {
    // --- Without a transaction: use a dedicated write ---
    const result = await db.runTransaction(async (tx) => {
      const existing = await tx.get(notifRef);

      if (existing.exists) {
        const d = existing.data()!;
        if (d.type === input.type && d.sourceEventId === input.sourceEventId) {
          return { notificationId, isIdempotent: true };
        }
        throw new Error(
          `[notificationService] Notification ID collision detected: ` +
            `existing type='${d.type}' vs new type='${input.type}' for id=${notificationId}. ` +
            `Failing closed without overwrite.`,
        );
      }

      tx.set(notifRef, docPayload);

      return { notificationId, isIdempotent: false };
    });

    return result;
  }
}

// ------------------------------------------------------------------
// Admin fan-out: notifyAssignedCanteenAdmins
// Queries all active admins assigned to canteenId and emits a
// per-admin notification. Isolated: only assigned active admins receive it.
// ------------------------------------------------------------------

export async function notifyAssignedCanteenAdmins(params: {
  canteenId: string;
  type: AdminNotificationType;
  orderId: string;
  sourceEventId: string;
  sourceEventType: 'order' | 'payment' | 'refund';
  transaction?: FirebaseFirestore.Transaction;
}): Promise<void> {
  const db = admin.firestore();

  // Query active admins assigned to this canteen
  const adminsQuery = db
    .collection('admins')
    .where('status', '==', 'active')
    .where('canteenIds', 'array-contains', params.canteenId);

  const adminsSnap = await adminsQuery.get();

  if (adminsSnap.empty) {
    // No active admins assigned — nothing to notify. Not an error.
    return;
  }

  // Create one notification per active admin
  const promises = adminsSnap.docs.map((adminDoc) => {
    const adminUid = adminDoc.id;
    return createNotificationInternal(
      {
        sourceEventId: `${params.sourceEventId}_admin_${adminUid}`,
        sourceEventType: params.sourceEventType,
        recipientUid: adminUid,
        type: params.type,
        orderId: params.orderId,
        canteenId: params.canteenId,
      },
      params.transaction,
    );
  });

  await Promise.all(promises);
}
