/**
 * GrabNGo - Native Notification Outbox Worker (Phase 3)
 *
 * Security & Architectural Invariants:
 * 1. Native Firebase emulator-compatible background trigger for /notificationOutbox/{outboxId}.
 * 2. Idempotent: Re-processing an already-delivered outbox event or re-delivering to an existing
 *    notification ID produces zero duplicate notifications and zero state errors.
 * 3. Bounded Retries: Bounded to 5 attempts; permanent failures transition to 'dead_letter'.
 * 4. Zero Business State Mutation: Never alters order, payment, refund, or slot documents.
 * 5. Sanitized Error Codes: Captures enum-based error codes only; zero PII or secrets.
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import {
  createNotificationInternal,
  notifyAssignedCanteenAdmins,
} from './notificationService';
import {
  logOutboxTelemetry,
  NotificationOutboxEntry,
  getFirestoreFieldValue,
  getFirestoreTimestamp,
} from './notificationOutbox';

export const MAX_OUTBOX_ATTEMPTS = 5;

export interface OutboxDeliveryResult {
  readonly success: boolean;
  readonly status: 'delivered' | 'dead_letter' | 'already_delivered' | 'failed' | 'not_found' | 'pending';
  readonly isIdempotent?: boolean;
  readonly errorCategory?: string;
  readonly attemptCount?: number;
}

/**
 * Core delivery processor for an outbox event.
 * Safe for concurrent invocations and retry attempts.
 */
export async function deliverOutboxEvent(
  outboxId: string,
  preloadedData?: Record<string, any>,
): Promise<OutboxDeliveryResult> {
  const startTime = Date.now();
  const db = admin.firestore();
  const outboxRef = db.collection('notificationOutbox').doc(outboxId);

  // Phase 1: Claim and validate in an atomic transaction
  let docData: NotificationOutboxEntry | null = null;
  let shouldProcess = false;
  let claimResult: any = null;

  for (let pollAttempt = 0; pollAttempt < 20; pollAttempt++) {
    claimResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      if (!snap.exists) {
        if (!preloadedData) {
          return { action: 'abort', reason: 'not_found' as const };
        }
      }

      const current = (snap.exists ? snap.data() : preloadedData) as NotificationOutboxEntry;

      // Idempotent early-exits
      if (current.status === 'delivered') {
        return { action: 'done' as const, status: 'already_delivered' as const, isIdempotent: true };
      }
      if (current.status === 'dead_letter') {
        return { action: 'done' as const, status: 'dead_letter' as const, isIdempotent: true };
      }

      // Check bounded attempts
      if (current.attemptCount >= MAX_OUTBOX_ATTEMPTS) {
        tx.update(outboxRef, {
          status: 'dead_letter',
          leaseUntil: null,
          nextRetryAt: null,
          lastErrorCode: 'MAX_RETRIES_EXCEEDED',
          updatedAt: getFirestoreFieldValue().serverTimestamp(),
        });
        return { action: 'dead_letter' as const, reason: 'MAX_RETRIES_EXCEEDED' as const };
      }

      // Lease check: if another worker is actively processing with valid lease, wait/poll
      const nowMs = Date.now();
      const isLeaseExpired =
        current.status === 'processing' &&
        current.leaseUntil &&
        (current.leaseUntil as any).toMillis?.() <= nowMs;

      if (current.status === 'processing' && !isLeaseExpired) {
        return { action: 'skip' as const, reason: 'currently_leased' as const };
      }

      // Validate required fields
      if (
        !current.outboxId ||
        !current.sourceEventId ||
        !current.sourceEventType ||
        !current.recipientRole ||
        !current.notificationType
      ) {
        tx.update(outboxRef, {
          status: 'dead_letter',
          leaseUntil: null,
          nextRetryAt: null,
          lastErrorCode: 'MALFORMED_EVENT_SCHEMA',
          updatedAt: getFirestoreFieldValue().serverTimestamp(),
        });
        return { action: 'dead_letter' as const, reason: 'MALFORMED_EVENT_SCHEMA' as const };
      }

      // Grant 30s atomic lease and set status=processing
      const leaseDurationMs = 30000;
      const leaseUntil = getFirestoreTimestamp().fromMillis(nowMs + leaseDurationMs);

      tx.update(outboxRef, {
        status: 'processing',
        leaseUntil,
        attemptCount: getFirestoreFieldValue().increment(1),
        updatedAt: getFirestoreFieldValue().serverTimestamp(),
      });

      docData = current;
      shouldProcess = true;
      return { action: 'proceed' as const, currentAttempts: (current.attemptCount || 0) + 1 };
    });

    if (claimResult.action === 'skip' && claimResult.reason === 'currently_leased') {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    break;
  }

  if (!shouldProcess || !docData) {
    if (claimResult.action === 'done') {
      const isAlreadyDelivered = claimResult.status === 'already_delivered';
      const resolvedStatus: 'already_delivered' | 'dead_letter' = isAlreadyDelivered ? 'already_delivered' : 'dead_letter';
      logOutboxTelemetry({
        operation: 'outbox_already_processed',
        outboxId,
        status: resolvedStatus,
        durationMs: Date.now() - startTime,
      });
      return { success: isAlreadyDelivered, status: resolvedStatus, isIdempotent: true };
    }
    if (claimResult.action === 'dead_letter') {
      logOutboxTelemetry({
        operation: 'outbox_dead_letter',
        outboxId,
        status: 'dead_letter',
        errorCategory: claimResult.reason,
        durationMs: Date.now() - startTime,
      });
      return { success: false, status: 'dead_letter', errorCategory: claimResult.reason };
    }
    if (claimResult.action === 'skip') {
      return { success: false, status: 'pending', errorCategory: claimResult.reason };
    }
    return { success: false, status: 'not_found' };
  }

  // Phase 2: Deliver notification via authoritative internal service
  const entry: NotificationOutboxEntry = docData;
  const currentAttempts = claimResult.currentAttempts || entry.attemptCount + 1;

  try {
    if (entry.recipientRole === 'student') {
      if (!entry.recipientUid) {
        throw new Error('MISSING_RECIPIENT_UID');
      }
      await createNotificationInternal({
        sourceEventId: entry.sourceEventId,
        sourceEventType: entry.sourceEventType,
        recipientUid: entry.recipientUid,
        type: entry.notificationType as any,
        orderId: entry.orderId,
        canteenId: entry.canteenId,
      });
    } else if (entry.recipientRole === 'admin') {
      if (!entry.canteenId) {
        throw new Error('MISSING_CANTEEN_ID');
      }
      await notifyAssignedCanteenAdmins({
        canteenId: entry.canteenId,
        type: entry.notificationType as any,
        orderId: entry.orderId || '',
        sourceEventId: entry.sourceEventId,
        sourceEventType: entry.sourceEventType,
      });
    } else {
      throw new Error('UNKNOWN_RECIPIENT_ROLE');
    }

    // Phase 3: Mark delivered and clear lease/retry fields
    const now = getFirestoreFieldValue().serverTimestamp();
    await outboxRef.update({
      status: 'delivered',
      leaseUntil: null,
      nextRetryAt: null,
      processedAt: now,
      updatedAt: now,
    });

    logOutboxTelemetry({
      correlationId: entry.correlationId,
      operation: 'outbox_delivered',
      sourceEventType: entry.sourceEventType,
      outboxId,
      status: 'delivered',
      attemptCount: currentAttempts,
      durationMs: Date.now() - startTime,
    });

    return { success: true, status: 'delivered', attemptCount: currentAttempts };
  } catch (err: any) {
    const errorCategory = err?.message?.includes('collision')
      ? 'COLLISION_DETECTED'
      : err?.message?.includes('MISSING_')
      ? 'MISSING_PAYLOAD_FIELD'
      : 'DELIVERY_FAILED';

    const willDeadLetter = currentAttempts >= MAX_OUTBOX_ATTEMPTS;
    const finalStatus: 'dead_letter' | 'pending' = willDeadLetter ? 'dead_letter' : 'pending';

    // Bounded exponential backoff with jitter: min(60s, 1s * 2^attempts + jitter)
    const backoffMs = Math.min(60000, 1000 * Math.pow(2, currentAttempts)) + Math.floor(Math.random() * 500);
    const nextRetryAt = willDeadLetter
      ? null
      : getFirestoreTimestamp().fromMillis(Date.now() + backoffMs);

    await outboxRef.update({
      status: finalStatus,
      leaseUntil: null,
      nextRetryAt,
      lastErrorCode: errorCategory,
      updatedAt: getFirestoreFieldValue().serverTimestamp(),
    });

    logOutboxTelemetry({
      correlationId: entry.correlationId,
      operation: willDeadLetter ? 'outbox_dead_letter' : 'outbox_retry_scheduled',
      sourceEventType: entry.sourceEventType,
      outboxId,
      status: finalStatus,
      attemptCount: currentAttempts,
      errorCategory,
      durationMs: Date.now() - startTime,
    });

    return {
      success: false,
      status: finalStatus,
      errorCategory,
      attemptCount: currentAttempts,
    };
  }
}

/**
 * Sweeps pending and expired-lease outbox entries.
 * Safe for concurrent invocations: transactions and leases guarantee single delivery.
 */
export async function runOutboxSweeper(
  batchSize = 25,
): Promise<{ processed: number; delivered: number; deadLettered: number }> {
  const db = admin.firestore();
  const pendingSnap = await db
    .collection('notificationOutbox')
    .where('status', 'in', ['pending', 'processing'])
    .limit(batchSize)
    .get();

  let processed = 0;
  let delivered = 0;
  let deadLettered = 0;

  for (const doc of pendingSnap.docs) {
    const d = doc.data();
    const nowMs = Date.now();
    const isPendingReady =
      d.status === 'pending' &&
      (!d.nextRetryAt || (d.nextRetryAt as any).toMillis?.() <= nowMs);
    const isLeaseExpired =
      d.status === 'processing' &&
      d.leaseUntil &&
      (d.leaseUntil as any).toMillis?.() <= nowMs;

    if (isPendingReady || isLeaseExpired) {
      processed++;
      const res = await deliverOutboxEvent(doc.id, d);
      if (res.status === 'delivered') delivered++;
      if (res.status === 'dead_letter') deadLettered++;
    }
  }

  return { processed, delivered, deadLettered };
}

/**
 * Native Firebase emulator-compatible background Firestore trigger.
 * Fires on creation of any document in /notificationOutbox/{outboxId}.
 */
export const processNotificationOutbox = functions.firestore
  .document('/notificationOutbox/{outboxId}')
  .onCreate(async (snap, context) => {
    const outboxId = context.params.outboxId;
    try {
      await deliverOutboxEvent(outboxId, snap.data());
    } catch (err: any) {
      functions.logger.warn(`[OutboxTrigger] Unhandled error delivering ${outboxId}:`, err?.message);
    }
  });

/**
 * Scheduled Outbox Sweeper (runs periodically to retry due pending events).
 */
export const scheduledOutboxSweeper = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async () => {
    await runOutboxSweeper();
  });

/**
 * Callable endpoint to trigger outbox sweeping (restricted to platform_operator).
 */
export const sweepNotificationOutbox = functions.https.onCall(
  async (_data: Record<string, any>, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const adminSnap = await admin.firestore().collection('admins').doc(context.auth.uid).get();
    if (!adminSnap.exists || adminSnap.data()?.status !== 'active') {
      throw new functions.https.HttpsError('permission-denied', 'Active platform operator required.');
    }
    const role = adminSnap.data()?.role;
    if (role !== 'platform_operator') {
      throw new functions.https.HttpsError('permission-denied', 'Platform operator authority required.');
    }

    const result = await runOutboxSweeper(50);
    return { success: true, ...result };
  },
);

/**
 * Dead-Letter Inspection & Manual Replay Operation.
 * Restricted to platform operators. Zero secrets, tokens, or PII exposed.
 */
export const replayDeadLetterOutbox = functions.https.onCall(
  async (data: Record<string, any>, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }
    const adminSnap = await admin.firestore().collection('admins').doc(context.auth.uid).get();
    if (!adminSnap.exists || adminSnap.data()?.status !== 'active') {
      throw new functions.https.HttpsError('permission-denied', 'Active platform operator required.');
    }
    const role = adminSnap.data()?.role;
    if (role !== 'platform_operator') {
      throw new functions.https.HttpsError('permission-denied', 'Platform operator authority required.');
    }

    if (!data || typeof data.outboxId !== 'string' || !/^outbox_[a-zA-Z0-9_-]{1,128}$/.test(data.outboxId)) {
      throw new functions.https.HttpsError('invalid-argument', 'outboxId must be a valid outbox ID string.');
    }
    const outboxId = data.outboxId;

    const db = admin.firestore();
    const outboxRef = db.collection('notificationOutbox').doc(outboxId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(outboxRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', `Outbox entry ${outboxId} not found.`);
      }
      const current = snap.data()!;
      if (current.status !== 'dead_letter') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Outbox entry is in status '${current.status}'. Replay is only permitted for 'dead_letter'.`,
        );
      }
      tx.update(outboxRef, {
        status: 'pending',
        attemptCount: 0,
        leaseUntil: null,
        nextRetryAt: null,
        updatedAt: getFirestoreFieldValue().serverTimestamp(),
      });
    });

    const deliveryResult = await deliverOutboxEvent(outboxId);
    return {
      success: deliveryResult.success,
      outboxId,
      status: deliveryResult.status,
      isIdempotent: deliveryResult.isIdempotent ?? false,
    };
  },
);
