/**
 * GrabNGo - Server-Side Push Notification & Token Registry Service (Additive Layer)
 *
 * Security & Architectural Invariants:
 * 1. In-App Notification is Canonical: Push delivery is strictly best-effort and additive.
 *    A failure in push notification delivery NEVER rolls back or alters orders, payments,
 *    refunds, pickup-slot capacity, or in-app notification records.
 * 2. Server-Only Token Registry: /users/{uid}/pushTokens/{tokenId} is denied to direct client access.
 * 3. Context-Derived Identity: Token registration strictly binds to context.auth.uid.
 *    Clients cannot supply target UIDs, roles, or canteen scopes.
 * 4. Zero Secrets in Payloads: Push payloads NEVER contain prices, payment credentials, HMACs,
 *    refund IDs, customer phone numbers, or private PII.
 * 5. Token Protection: Raw tokens are never logged. Document IDs use deterministic SHA-256 hashes.
 * 6. Bounded Active Tokens: Max 5 active devices per user. Oldest tokens pruned on excess.
 * 7. Invalid Token Auto-Pruning: Unregistered/invalid provider tokens are disabled automatically.
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as functions from 'firebase-functions/v1';
import { sanitizeShortOrderId, NotificationType } from './notificationService';
import { getFirestoreFieldValue } from './notificationOutbox';

export const MAX_TOKENS_PER_USER = 5;

export interface PushTokenDoc {
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly tokenCiphertext: string;
  readonly platform: 'android' | 'ios';
  readonly environment: 'local' | 'staging' | 'production';
  readonly appVersion: string;
  readonly enabled: boolean;
  readonly createdAt: any;
  readonly updatedAt: any;
  readonly lastSeenAt: any;
  readonly invalidAt: any | null;
  readonly invalidReason?: string;
}

export interface RegisterPushTokenInput {
  readonly token: string;
  readonly platform: 'android' | 'ios';
  readonly appVersion?: string;
}

export interface UnregisterPushTokenInput {
  readonly tokenId?: string;
  readonly token?: string;
}

export interface PushPreferencesDoc {
  readonly orderUpdates: boolean;
  readonly demoPaymentUpdates: boolean;
  readonly promotionalUpdates: boolean;
  readonly updatedAt: any;
}

export interface SafePushPayload {
  readonly notification: {
    readonly title: string;
    readonly body: string;
  };
  readonly data: {
    readonly notificationId: string;
    readonly eventType: string;
    readonly orderId: string;
    readonly screen: string;
  };
}

/**
 * Computes deterministic 32-character hex ID from token.
 */
export function computePushTokenId(token: string): string {
  const hash = crypto.createHash('sha256').update(token.trim()).digest('hex');
  return `ptok_${hash.slice(0, 32)}`;
}

/**
 * Computes full SHA-256 hex digest for lookup.
 */
export function hashPushToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Derives current server environment reliably without trusting client.
 */
export function resolveServerEnvironment(): 'local' | 'staging' | 'production' {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return 'local';
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG || '';
  if (projectId.includes('mad-lab-a9665') || projectId.includes('staging')) {
    return 'staging';
  }
  return 'production';
}

/**
 * Non-invasive structured logging for push operations.
 * Raw tokens and personal data are strictly excluded.
 */
export function logPushTelemetry(entry: {
  operation: string;
  recipientUid?: string;
  tokenId?: string;
  platform?: string;
  status: string;
  errorCategory?: string;
  durationMs?: number;
}): void {
  functions.logger.info('[PushTelemetry]', JSON.stringify({
    timestamp: new Date().toISOString(),
    operation: entry.operation,
    recipientUidMasked: entry.recipientUid ? `usr_...${entry.recipientUid.slice(-4)}` : 'none',
    tokenId: entry.tokenId || 'none',
    platform: entry.platform || 'unknown',
    status: entry.status,
    errorCategory: entry.errorCategory || 'none',
    durationMs: entry.durationMs ?? 0,
  }));
}

/**
 * Validates push token string format and bounds.
 */
export function validatePushTokenString(token: unknown): string {
  if (typeof token !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Push token must be a string.');
  }
  const trimmed = token.trim();
  if (trimmed.length < 32 || trimmed.length > 4096) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Push token length must be between 32 and 4096 characters.',
    );
  }
  // Enforce valid token characters: alphanumeric, dashes, underscores, colons, dots, slashes
  if (!/^[a-zA-Z0-9_\-:=./]+$/.test(trimmed)) {
    throw new functions.https.HttpsError('invalid-argument', 'Push token contains invalid characters.');
  }
  return trimmed;
}

/**
 * Registers an FCM push token for the authenticated user with multi-device support
 * and bounded active tokens limit (max 5 active tokens per user).
 */
export async function registerPushTokenInternal(
  uid: string,
  input: RegisterPushTokenInput,
): Promise<{ success: boolean; tokenId: string; platform: string; isIdempotent: boolean }> {
  const startTime = Date.now();
  const token = validatePushTokenString(input.token);

  if (input.platform !== 'android' && input.platform !== 'ios') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      "Platform must be either 'android' or 'ios'.",
    );
  }

  const appVersion = typeof input.appVersion === 'string' && input.appVersion.length <= 32
    ? input.appVersion.trim()
    : '1.0.0';

  const tokenId = computePushTokenId(token);
  const tokenHash = hashPushToken(token);
  const environment = resolveServerEnvironment();
  const db = admin.firestore();
  const userTokensCol = db.collection('users').doc(uid).collection('pushTokens');
  const tokenDocRef = userTokensCol.doc(tokenId);

  const now = getFirestoreFieldValue().serverTimestamp();

  // Run transaction to enforce bounded active tokens per user
  const result = await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(tokenDocRef);

    if (existingSnap.exists) {
      const d = existingSnap.data() as PushTokenDoc;
      if (d.enabled && d.platform === input.platform && d.appVersion === appVersion) {
        // Idempotent refresh
        tx.update(tokenDocRef, {
          lastSeenAt: now,
          updatedAt: now,
        });
        return { isIdempotent: true };
      }
      // Re-enable or update existing token doc
      tx.update(tokenDocRef, {
        enabled: true,
        platform: input.platform,
        appVersion,
        invalidAt: null,
        invalidReason: null,
        lastSeenAt: now,
        updatedAt: now,
      });
      return { isIdempotent: false };
    }

    // New token registration: check count of active tokens
    const activeTokensSnap = await tx.get(userTokensCol.where('enabled', '==', true));
    if (activeTokensSnap.size >= MAX_TOKENS_PER_USER) {
      // Find oldest token by lastSeenAt and disable it
      let oldestDoc: FirebaseFirestore.DocumentSnapshot | null = null;
      let oldestTime = Infinity;

      for (const doc of activeTokensSnap.docs) {
        const docData = doc.data();
        const timeMs = docData.lastSeenAt?.toMillis?.() || 0;
        if (timeMs < oldestTime) {
          oldestTime = timeMs;
          oldestDoc = doc;
        }
      }

      if (oldestDoc) {
        tx.update(oldestDoc.ref, {
          enabled: false,
          invalidAt: now,
          invalidReason: 'PRUNED_MAX_TOKENS_EXCEEDED',
          updatedAt: now,
        });
      }
    }

    // Insert new token doc
    const newDoc: Record<string, any> = {
      tokenId,
      tokenHash,
      tokenCiphertext: token, // Stored securely in server-only collection
      platform: input.platform,
      environment,
      appVersion,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      invalidAt: null,
    };

    tx.set(tokenDocRef, newDoc);
    return { isIdempotent: false };
  });

  logPushTelemetry({
    operation: 'register_token',
    recipientUid: uid,
    tokenId,
    platform: input.platform,
    status: 'success',
    durationMs: Date.now() - startTime,
  });

  return {
    success: true,
    tokenId,
    platform: input.platform,
    isIdempotent: result.isIdempotent,
  };
}

/**
 * Disables a push token on logout or rotation for the authenticated caller.
 */
export async function unregisterPushTokenInternal(
  uid: string,
  input: UnregisterPushTokenInput,
): Promise<{ success: boolean; tokenId: string; isIdempotent: boolean }> {
  const startTime = Date.now();
  let targetTokenId: string;

  if (typeof input.tokenId === 'string' && /^ptok_[a-f0-9]{32}$/.test(input.tokenId)) {
    targetTokenId = input.tokenId;
  } else if (typeof input.token === 'string') {
    targetTokenId = computePushTokenId(validatePushTokenString(input.token));
  } else {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Either a valid tokenId or token string is required.',
    );
  }

  const db = admin.firestore();
  const tokenDocRef = db.collection('users').doc(uid).collection('pushTokens').doc(targetTokenId);
  const snap = await tokenDocRef.get();

  if (!snap.exists) {
    return { success: true, tokenId: targetTokenId, isIdempotent: true };
  }

  const data = snap.data();
  if (data?.enabled === false) {
    return { success: true, tokenId: targetTokenId, isIdempotent: true };
  }

  const now = getFirestoreFieldValue().serverTimestamp();
  await tokenDocRef.update({
    enabled: false,
    invalidAt: now,
    invalidReason: 'LOGOUT_UNREGISTER',
    updatedAt: now,
  });

  logPushTelemetry({
    operation: 'unregister_token',
    recipientUid: uid,
    tokenId: targetTokenId,
    status: 'success',
    durationMs: Date.now() - startTime,
  });

  return { success: true, tokenId: targetTokenId, isIdempotent: false };
}

/**
 * Disables an invalid or unregistered token identified by FCM error response.
 */
export async function disableInvalidPushToken(
  uid: string,
  tokenId: string,
  reason: string,
): Promise<void> {
  try {
    const db = admin.firestore();
    const tokenRef = db.collection('users').doc(uid).collection('pushTokens').doc(tokenId);
    const now = getFirestoreFieldValue().serverTimestamp();
    await tokenRef.update({
      enabled: false,
      invalidAt: now,
      invalidReason: reason,
      updatedAt: now,
    });
    logPushTelemetry({
      operation: 'disable_invalid_token',
      recipientUid: uid,
      tokenId,
      status: 'disabled',
      errorCategory: reason,
    });
  } catch (err: any) {
    functions.logger.warn(`[PushService] Failed to disable token ${tokenId}:`, err?.message);
  }
}

/**
 * Builds safe, sanitized FCM notification and data payload.
 * Absolutely zero secrets, pricing, customer PII, or internal references.
 */
export function buildSafePushPayload(
  notification: {
    notificationId: string;
    type: NotificationType | string;
    orderId?: string | null;
  },
): SafePushPayload {
  const sid = sanitizeShortOrderId(notification.orderId);

  let title = 'GrabNGo Notification';
  let body = `Update on order ${sid}. Open app for details.`;

  switch (notification.type) {
    case 'order_placed':
      title = '🧾 Order Placed';
      body = `Order ${sid} placed. Awaiting canteen confirmation.`;
      break;
    case 'payment_succeeded_demo':
      title = '✅ Payment Successful (Demo)';
      body = `Demo payment for order ${sid} verified. (Simulated payment; no real money transferred).`;
      break;
    case 'payment_failed':
      title = '❌ Payment Failed';
      body = `Demo payment attempt for order ${sid} failed. Please retry payment.`;
      break;
    case 'order_accepted':
      title = '👍 Order Accepted';
      body = `Order ${sid} has been accepted by the canteen.`;
      break;
    case 'order_preparing':
      title = '🍳 Order Being Prepared';
      body = `Order ${sid} is being prepared by the canteen.`;
      break;
    case 'order_ready_for_pickup':
      title = '🔔 Ready for Pickup!';
      body = `Your order ${sid} is ready. Please collect from the canteen.`;
      break;
    case 'order_completed':
      title = '🎉 Order Completed';
      body = `Order ${sid} has been completed. Enjoy your meal!`;
      break;
    case 'order_cancelled':
      title = '🚫 Order Cancelled';
      body = `Order ${sid} was cancelled. Check app for details.`;
      break;
    case 'order_rejected':
      title = '⛔ Order Rejected';
      body = `Order ${sid} was rejected by the canteen.`;
      break;
    case 'refund_pending_demo':
      title = '💰 Refund Initiated (Demo)';
      body = `Demo refund for order ${sid} initiated. Processing in progress.`;
      break;
    case 'refund_completed_demo':
      title = '✅ Refund Completed (Demo)';
      body = `Demo refund for order ${sid} completed. (Simulated refund).`;
      break;
    case 'new_order_for_admin':
      title = '🛎️ New Order Received';
      body = `A new order ${sid} has been received for your canteen.`;
      break;
    case 'payment_verified_for_admin':
      title = '✅ Payment Verified (Demo)';
      body = `Demo payment for order ${sid} verified. Order ready for acceptance.`;
      break;
  }

  return {
    notification: {
      title,
      body,
    },
    data: {
      notificationId: notification.notificationId,
      eventType: String(notification.type),
      orderId: sid,
      screen: 'notifications',
    },
  };
}

/**
 * Attempts delivery of a safe push notification to all active devices of a recipient.
 * Isolated execution: Failure NEVER causes an error in caller or alters business transactions.
 */
export async function deliverPushNotificationForRecipient(
  recipientUid: string,
  notification: {
    notificationId: string;
    type: NotificationType | string;
    orderId?: string | null;
  },
): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  status: 'sent' | 'skipped' | 'failed' | 'not_configured';
  errorCategory?: string;
}> {
  const startTime = Date.now();
  const db = admin.firestore();

  try {
    // 1. Check user preferences if present
    const prefSnap = await db.collection('users').doc(recipientUid).collection('preferences').doc('push').get();
    if (prefSnap.exists) {
      const prefs = prefSnap.data();
      if (prefs?.orderUpdates === false && String(notification.type).startsWith('order_')) {
        return { attempted: 0, succeeded: 0, failed: 0, status: 'skipped', errorCategory: 'USER_OPTED_OUT' };
      }
      if (prefs?.demoPaymentUpdates === false && String(notification.type).includes('payment_')) {
        return { attempted: 0, succeeded: 0, failed: 0, status: 'skipped', errorCategory: 'USER_OPTED_OUT' };
      }
    }

    // 2. Query enabled tokens for recipient
    const tokensSnap = await db
      .collection('users')
      .doc(recipientUid)
      .collection('pushTokens')
      .where('enabled', '==', true)
      .limit(MAX_TOKENS_PER_USER)
      .get();

    if (tokensSnap.empty) {
      return { attempted: 0, succeeded: 0, failed: 0, status: 'skipped', errorCategory: 'NO_ACTIVE_TOKENS' };
    }

    const payload = buildSafePushPayload(notification);
    let succeeded = 0;
    let failed = 0;

    for (const doc of tokensSnap.docs) {
      const tokenDoc = doc.data() as PushTokenDoc;
      const rawToken = tokenDoc.tokenCiphertext;

      if (!rawToken) {
        continue;
      }

      // 3. Dispatch via Firebase Admin Messaging
      try {
        if (process.env.FUNCTIONS_EMULATOR === 'true' && !process.env.TEST_REAL_FCM) {
          // Emulator environment without Google Cloud live credentials
          // Test hook: allows test suites to inject mock responses via global or env
          const mockMode = (global as any).__MOCK_FCM_RESPONSE__;
          if (mockMode === 'invalid_token') {
            await disableInvalidPushToken(recipientUid, tokenDoc.tokenId, 'MOCK_TOKEN_UNREGISTERED');
            failed++;
          } else if (mockMode === 'transient_error') {
            failed++;
          } else {
            // Simulated local success
            succeeded++;
            logPushTelemetry({
              operation: 'push_delivered_simulated',
              recipientUid,
              tokenId: tokenDoc.tokenId,
              platform: tokenDoc.platform,
              status: 'simulated_success',
              durationMs: Date.now() - startTime,
            });
          }
        } else {
          // Live staging or production FCM delivery
          const message: admin.messaging.Message = {
            token: rawToken,
            notification: payload.notification,
            data: payload.data,
            android: {
              priority: 'high',
              notification: {
                channelId: 'grabngo_orders',
                icon: 'ic_notification',
                color: '#DF401C',
              },
            },
            apns: {
              payload: {
                aps: {
                  alert: payload.notification,
                  badge: 1,
                  sound: 'default',
                },
              },
            },
          };

          await admin.messaging().send(message);
          succeeded++;
        }
      } catch (fcmErr: any) {
        failed++;
        const errorCode = fcmErr?.code || fcmErr?.message || 'UNKNOWN_FCM_ERROR';
        // Auto-prune unregistered / invalid tokens
        if (
          errorCode.includes('registration-token-not-registered') ||
          errorCode.includes('invalid-registration-token') ||
          errorCode.includes('invalid-argument')
        ) {
          await disableInvalidPushToken(recipientUid, tokenDoc.tokenId, errorCode);
        }

        logPushTelemetry({
          operation: 'push_failed',
          recipientUid,
          tokenId: tokenDoc.tokenId,
          platform: tokenDoc.platform,
          status: 'failed',
          errorCategory: errorCode,
          durationMs: Date.now() - startTime,
        });
      }
    }

    const finalStatus: 'sent' | 'failed' | 'skipped' =
      succeeded > 0 ? 'sent' : failed > 0 ? 'failed' : 'skipped';

    return {
      attempted: tokensSnap.size,
      succeeded,
      failed,
      status: finalStatus,
    };
  } catch (err: any) {
    // Non-interference invariant: push failure NEVER propagates to disrupt in-app delivery
    functions.logger.warn(
      `[PushService] Non-fatal push delivery error for user ${recipientUid}:`,
      err?.message,
    );
    return {
      attempted: 0,
      succeeded: 0,
      failed: 1,
      status: 'failed',
      errorCategory: err?.message || 'PUSH_DISPATCH_EXCEPTION',
    };
  }
}

/**
 * Gets push notification preferences for caller.
 */
export async function getPushPreferencesInternal(uid: string): Promise<PushPreferencesDoc> {
  const db = admin.firestore();
  const snap = await db.collection('users').doc(uid).collection('preferences').doc('push').get();
  if (snap.exists) {
    return snap.data() as PushPreferencesDoc;
  }
  return {
    orderUpdates: true,
    demoPaymentUpdates: true,
    promotionalUpdates: false,
    updatedAt: null,
  };
}

/**
 * Updates push notification preferences for caller.
 */
export async function setPushPreferencesInternal(
  uid: string,
  prefs: { orderUpdates?: boolean; demoPaymentUpdates?: boolean; promotionalUpdates?: boolean },
): Promise<PushPreferencesDoc> {
  const db = admin.firestore();
  const ref = db.collection('users').doc(uid).collection('preferences').doc('push');
  const now = getFirestoreFieldValue().serverTimestamp();

  const current = await getPushPreferencesInternal(uid);
  const updated: PushPreferencesDoc = {
    orderUpdates: typeof prefs.orderUpdates === 'boolean' ? prefs.orderUpdates : current.orderUpdates,
    demoPaymentUpdates: typeof prefs.demoPaymentUpdates === 'boolean' ? prefs.demoPaymentUpdates : current.demoPaymentUpdates,
    promotionalUpdates: typeof prefs.promotionalUpdates === 'boolean' ? prefs.promotionalUpdates : current.promotionalUpdates,
    updatedAt: now,
  };

  await ref.set(updated, { merge: true });
  return updated;
}
