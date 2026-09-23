/**
 * GrabNGo - Payment Integration Foundation & Demo Payment Service (Step 9)
 *
 * Security & Architectural Constraints:
 * 1. Live payment integration (real Razorpay, UPI intent, card processors) is strictly deferred.
 * 2. All payment records are server-owned and immutable from client direct writes.
 * 3. Monetary values are strictly calculated in integer paise.
 * 4. Demo simulations (complete, fail, cancel, refund) are emulator-only.
 * 5. Uses generic demo labels: UPI Demo, Demo Wallet Payment, Demo Online Payment.
 */

import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';

export type DemoPaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded_demo'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refund_pending'
  | 'refunded_demo';

export interface PaymentRecord {
  readonly paymentId: string;
  readonly orderId: string;
  readonly studentUid?: string;
  readonly canteenId: string;
  readonly amountInPaise: number;
  readonly currency: 'INR';
  readonly paymentMethod: 'upi_demo';
  readonly provider: 'demo';
  readonly status: DemoPaymentStatus;
  readonly attemptNumber: number;
  readonly idempotencyKey?: string;
  readonly providerReference?: string;
  readonly failureCode?: string | null;
  readonly failureMessage?: string | null;
  readonly createdAt: any;
  readonly updatedAt: any;
  readonly completedAt?: any;
}

export interface PaymentHistoryEntry {
  readonly eventId: string;
  readonly paymentId: string;
  readonly orderId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly actorUid: string;
  readonly actorRole: string;
  readonly canteenId: string;
  readonly reason: string;
  readonly createdAt: any;
}

export interface CreateDemoPaymentInput {
  readonly orderId: string;
  readonly idempotencyKey: string;
}

export interface CreateDemoPaymentResult {
  readonly success: boolean;
  readonly isRetry: boolean;
  readonly paymentId: string;
  readonly orderId: string;
  readonly status: DemoPaymentStatus;
  readonly amountInPaise: number;
  readonly currency: 'INR';
  readonly providerReference: string;
}

export interface CompleteDemoPaymentResult {
  readonly success: boolean;
  readonly isRetry: boolean;
  readonly orderId: string;
  readonly paymentId: string;
  readonly status: 'succeeded_demo';
  readonly orderStatus: 'payment_verified';
}

/**
 * Initiates an idempotent demo payment attempt via trusted Cloud Function.
 */
export async function createDemoPaymentCallable(
  input: CreateDemoPaymentInput,
): Promise<CreateDemoPaymentResult> {
  try {
    const callable = functions().httpsCallable('createDemoPayment');
    const response = await callable(input);
    return response.data as CreateDemoPaymentResult;
  } catch (err: any) {
    console.error('[paymentService] createDemoPaymentCallable error:', err);
    throw err;
  }
}

/**
 * Completes a demo payment attempt (emulator only).
 */
export async function completeDemoPaymentCallable(input: {
  orderId: string;
  paymentId: string;
}): Promise<CompleteDemoPaymentResult> {
  try {
    const callable = functions().httpsCallable('completeDemoPayment');
    const response = await callable(input);
    return response.data as CompleteDemoPaymentResult;
  } catch (err: any) {
    console.error('[paymentService] completeDemoPaymentCallable error:', err);
    throw err;
  }
}

/**
 * Marks a demo payment attempt as failed with sanitized reason (emulator only).
 */
export async function failDemoPaymentCallable(input: {
  orderId: string;
  paymentId: string;
  failureCode?: string;
  failureMessage?: string;
}): Promise<any> {
  try {
    const callable = functions().httpsCallable('failDemoPayment');
    const response = await callable(input);
    return response.data;
  } catch (err: any) {
    console.error('[paymentService] failDemoPaymentCallable error:', err);
    throw err;
  }
}

/**
 * Cancels a demo payment attempt (emulator only).
 */
export async function cancelDemoPaymentCallable(input: {
  orderId: string;
  paymentId: string;
  reason?: string;
}): Promise<any> {
  try {
    const callable = functions().httpsCallable('cancelDemoPayment');
    const response = await callable(input);
    return response.data;
  } catch (err: any) {
    console.error('[paymentService] cancelDemoPaymentCallable error:', err);
    throw err;
  }
}

/**
 * Fetches sanitized payment details with ownership authorization.
 */
export async function getPaymentStatusCallable(input: {
  orderId: string;
  paymentId: string;
}): Promise<{ success: boolean; payment: PaymentRecord }> {
  try {
    const callable = functions().httpsCallable('getPaymentStatus');
    const response = await callable(input);
    return response.data as { success: boolean; payment: PaymentRecord };
  } catch (err: any) {
    console.error('[paymentService] getPaymentStatusCallable error:', err);
    throw err;
  }
}

/**
 * Requests demo refund for a cancelled/rejected order (emulator only).
 */
export async function requestDemoRefundCallable(input: {
  orderId: string;
  paymentId: string;
  reason?: string;
}): Promise<any> {
  try {
    const callable = functions().httpsCallable('requestDemoRefund');
    const response = await callable(input);
    return response.data;
  } catch (err: any) {
    console.error('[paymentService] requestDemoRefundCallable error:', err);
    throw err;
  }
}

/**
 * Finalizes demo refund state to refunded_demo (emulator only).
 */
export async function completeDemoRefundCallable(input: {
  orderId: string;
  paymentId: string;
}): Promise<any> {
  try {
    const callable = functions().httpsCallable('completeDemoRefund');
    const response = await callable(input);
    return response.data;
  } catch (err: any) {
    console.error('[paymentService] completeDemoRefundCallable error:', err);
    throw err;
  }
}

/**
 * Fetches payments subcollection for an order.
 */
export async function getOrderPayments(orderId: string): Promise<PaymentRecord[]> {
  if (!orderId) return [];
  try {
    const snapshot = await firestore()
      .collection('orders')
      .doc(orderId)
      .collection('payments')
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        paymentId: doc.id,
        orderId: d.orderId || orderId,
        canteenId: d.canteenId || '',
        amountInPaise: d.amountInPaise || 0,
        currency: d.currency || 'INR',
        paymentMethod: d.paymentMethod || 'upi_demo',
        provider: d.provider || 'demo',
        status: d.status || 'pending',
        attemptNumber: d.attemptNumber || 1,
        providerReference: d.providerReference || '',
        failureCode: d.failureCode || null,
        failureMessage: d.failureMessage || null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        completedAt: d.completedAt || null,
      };
    });
  } catch (err) {
    console.error('[paymentService] getOrderPayments error:', err);
    return [];
  }
}

/**
 * Fetches payment history events for an order.
 */
export async function getOrderPaymentHistory(orderId: string): Promise<PaymentHistoryEntry[]> {
  if (!orderId) return [];
  try {
    const snapshot = await firestore()
      .collection('orders')
      .doc(orderId)
      .collection('paymentHistory')
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        eventId: doc.id,
        paymentId: d.paymentId || '',
        orderId: d.orderId || orderId,
        fromStatus: d.fromStatus || '',
        toStatus: d.toStatus || '',
        actorUid: d.actorUid || '',
        actorRole: d.actorRole || '',
        canteenId: d.canteenId || '',
        reason: d.reason || '',
        createdAt: d.createdAt,
      };
    });
  } catch (err) {
    console.error('[paymentService] getOrderPaymentHistory error:', err);
    return [];
  }
}
