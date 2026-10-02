/**
 * GrabNGo - Canonical Notification Outbox (Phase 3)
 *
 * Security & Architectural Invariants:
 * 1. Server-Only Collection: /notificationOutbox/{outboxId} (denied to all clients via firestore.rules).
 * 2. Transactional Coupling: Outbox records are committed in the SAME Firestore transaction
 *    as the source business event (createOrder, completeDemoPayment, transitionOrderStatus).
 * 3. Zero Secrets & PII: No passwords, tokens, HMAC keys, payment credentials, or customer PII.
 * 4. Deterministic Outbox ID: outbox_{sourceEventId}_{recipientRole}_{recipientUid|canteenId}.
 * 5. Bounded Retries: Max 5 attempts before transitioning to 'dead_letter'.
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

export type OutboxStatus = 'pending' | 'processing' | 'delivered' | 'dead_letter';

export interface NotificationOutboxEntry {
  readonly outboxId: string;
  readonly sourceEventId: string;
  readonly sourceEventType: 'order' | 'payment' | 'refund';
  readonly recipientUid?: string;
  readonly recipientRole: 'student' | 'admin';
  readonly notificationType: string;
  readonly orderId?: string;
  readonly canteenId?: string;
  readonly correlationId?: string;
  readonly status: OutboxStatus;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly lastErrorCode?: string;
  readonly leaseUntil?: admin.firestore.Timestamp | null;
  readonly nextRetryAt?: admin.firestore.Timestamp | null;
  readonly createdAt: admin.firestore.FieldValue;
  readonly updatedAt: admin.firestore.FieldValue;
  readonly processedAt?: admin.firestore.FieldValue;
}

export interface TelemetryLogEntry {
  correlationId?: string;
  operation: string;
  sourceEventType?: string;
  outboxId?: string;
  status?: string;
  attemptCount?: number;
  durationMs?: number;
  errorCategory?: string;
  retryCount?: number;
}

/**
 * Non-invasive structured logging.
 * Strips all customer PII, secrets, auth tokens, and raw payloads.
 */
export function logOutboxTelemetry(entry: TelemetryLogEntry): void {
  functions.logger.info('[OutboxTelemetry]', JSON.stringify({
    timestamp: new Date().toISOString(),
    correlationId: entry.correlationId || 'none',
    operation: entry.operation,
    sourceEventType: entry.sourceEventType || 'unknown',
    outboxId: entry.outboxId || 'none',
    status: entry.status || 'unknown',
    attemptCount: entry.attemptCount ?? 0,
    durationMs: entry.durationMs ?? 0,
    errorCategory: entry.errorCategory || 'none',
    retryCount: entry.retryCount ?? 0,
  }));
}

export function getFirestoreFieldValue(): any {
  if ((admin as any).firestore?.FieldValue?.serverTimestamp) {
    return (admin as any).firestore.FieldValue;
  }
  try {
    const { FieldValue } = require('@google-cloud/firestore');
    if (FieldValue?.serverTimestamp) return FieldValue;
  } catch (_) {}
  return (admin as any).firestore.FieldValue;
}

export function getFirestoreTimestamp(): any {
  if ((admin as any).firestore?.Timestamp?.fromMillis) {
    return (admin as any).firestore.Timestamp;
  }
  if ((admin as any).default?.firestore?.Timestamp?.fromMillis) {
    return (admin as any).default.firestore.Timestamp;
  }
  try {
    const { Timestamp } = require('@google-cloud/firestore');
    if (Timestamp?.fromMillis) return Timestamp;
  } catch (_) {}
  return (admin as any).firestore?.Timestamp;
}

/**
 * Writes a notification outbox record transactionally inside an existing Firestore transaction.
 * Guarantees atomicity: if the parent business transaction aborts, zero outbox records commit.
 */
export function writeNotificationOutboxTx(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  input: {
    outboxId: string;
    sourceEventId: string;
    sourceEventType: 'order' | 'payment' | 'refund';
    recipientUid?: string;
    recipientRole: 'student' | 'admin';
    notificationType: string;
    orderId?: string;
    canteenId?: string;
    correlationId?: string;
  },
): void {
  const outboxRef = db.collection('notificationOutbox').doc(input.outboxId);
  const now = getFirestoreFieldValue().serverTimestamp();

  const docPayload: Record<string, any> = {
    outboxId: input.outboxId,
    sourceEventId: input.sourceEventId,
    sourceEventType: input.sourceEventType,
    recipientRole: input.recipientRole,
    notificationType: input.notificationType,
    status: 'pending' as OutboxStatus,
    attemptCount: 0,
    maxAttempts: 5,
    leaseUntil: null,
    nextRetryAt: null,
    createdAt: now,
    updatedAt: now,
  };

  if (input.recipientUid) {
    docPayload.recipientUid = input.recipientUid;
  }
  if (input.orderId) {
    docPayload.orderId = input.orderId;
  }
  if (input.canteenId) {
    docPayload.canteenId = input.canteenId;
  }
  if (input.correlationId) {
    docPayload.correlationId = input.correlationId;
  }

  transaction.set(outboxRef, docPayload);

  logOutboxTelemetry({
    correlationId: input.correlationId,
    operation: 'outbox_created_tx',
    sourceEventType: input.sourceEventType,
    outboxId: input.outboxId,
    status: 'pending',
    attemptCount: 0,
  });
}
