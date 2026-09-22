/**
 * GrabNGo - Order, Cart, and Pickup Slot Service (Step 7)
 *
 * Security & Architectural Constraints:
 * 1. User-scoped cart writes enforce strict field allowlists and integer quantities.
 * 2. Order creation is brokered exclusively via the 'createOrder' Cloud Function.
 * 3. Client prices, totals, or statuses are never authoritative.
 * 4. All monetary arithmetic uses integer paise.
 */

import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';

export interface UserCartItem {
  readonly itemId: string;
  readonly canteenId: string;
  readonly quantity: number;
  readonly updatedAt?: any;
}

export interface PickupSlot {
  readonly slotId: string;
  readonly canteenId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly timezone: string;
  readonly isOpen: boolean;
  readonly capacity: number;
  readonly reservedCount: number;
}

export interface OrderItemSnapshot {
  readonly itemId: string;
  readonly itemName: string;
  readonly categoryId: string;
  readonly unitPriceInPaise: number;
  readonly quantity: number;
  readonly lineTotalInPaise: number;
}

export type OrderStatus =
  | 'placed'
  | 'payment_verified'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'completed'
  | 'cancelled'
  | 'rejected';

export type PaymentStatus =
  | 'pending'
  | 'demo_verified'
  | 'failed'
  | 'cancelled';

export interface OrderStatusHistoryEvent {
  readonly eventId: string;
  readonly orderId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly actorUid: string;
  readonly actorRole: string;
  readonly canteenId: string;
  readonly reason: string;
  readonly createdAt: any;
}

export interface OrderDocument {
  readonly id: string;
  readonly orderId: string;
  readonly studentUid: string;
  readonly canteenId: string;
  readonly pickupSlotId?: string;
  readonly pickupSlot: {
    readonly slotId: string;
    readonly pickupDate: string;
    readonly pickupStartTime: string;
    readonly pickupEndTime: string;
    readonly timezone: string;
  };
  readonly itemsSnapshot: OrderItemSnapshot[];
  readonly subtotalInPaise: number;
  readonly totalInPaise: number;
  readonly currency: string;
  readonly status: OrderStatus | string;
  readonly paymentStatus: PaymentStatus | string;
  readonly paymentMethod: string;
  readonly idempotencyKey: string;
  readonly createdAt: any;
  readonly updatedAt: any;
}

export interface CreateOrderInput {
  readonly canteenId: string;
  readonly items: Array<{ itemId: string; quantity: number }>;
  readonly pickupSlotId: string;
  readonly paymentMethod: 'cash' | 'upi_demo';
  readonly idempotencyKey: string;
}

export interface CreateOrderResult {
  readonly success: boolean;
  readonly isRetry: boolean;
  readonly orderId: string;
  readonly status: string;
  readonly paymentStatus: string;
  readonly totalInPaise: number;
  readonly subtotalInPaise: number;
  readonly pickupSlot: {
    readonly slotId: string;
    readonly pickupDate: string;
    readonly pickupStartTime: string;
    readonly pickupEndTime: string;
    readonly timezone: string;
  };
  readonly itemsSnapshot: OrderItemSnapshot[];
}

/**
 * Fetches user-scoped cart items for the authenticated student.
 */
export async function getUserCart(userId: string): Promise<UserCartItem[]> {
  if (!userId) return [];
  const snapshot = await firestore()
    .collection('users')
    .doc(userId)
    .collection('cart')
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      itemId: doc.id,
      canteenId: data.canteenId || '',
      quantity: typeof data.quantity === 'number' ? data.quantity : 1,
      updatedAt: data.updatedAt,
    };
  });
}

/**
 * Adds or updates an item in the user-scoped cart following strict field allowlists.
 */
export async function setUserCartItem(
  userId: string,
  item: { itemId: string; canteenId: string; quantity: number },
): Promise<void> {
  if (!userId || !item.itemId || item.quantity < 1 || item.quantity > 99) {
    throw new Error('Invalid cart item payload.');
  }

  const docRef = firestore()
    .collection('users')
    .doc(userId)
    .collection('cart')
    .doc(item.itemId);

  const existing = await docRef.get();
  const exists = typeof (existing as any).exists === 'function' ? (existing as any).exists() : Boolean((existing as any).exists);
  if (exists) {
    await docRef.update({
      quantity: item.quantity,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
  } else {
    await docRef.set({
      itemId: item.itemId,
      canteenId: item.canteenId,
      quantity: item.quantity,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
  }
}

/**
 * Deletes an item from the user-scoped cart.
 */
export async function removeUserCartItem(userId: string, itemId: string): Promise<void> {
  if (!userId || !itemId) return;
  await firestore()
    .collection('users')
    .doc(userId)
    .collection('cart')
    .doc(itemId)
    .delete();
}

/**
 * Clears the user-scoped cart.
 */
export async function clearUserCart(userId: string): Promise<void> {
  if (!userId) return;
  const snapshot = await firestore()
    .collection('users')
    .doc(userId)
    .collection('cart')
    .get();

  if (snapshot.empty) return;
  const batch = firestore().batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

/**
 * Fetches active open pickup slots for a specific canteen.
 */
export async function getAvailablePickupSlots(canteenId: string): Promise<PickupSlot[]> {
  if (!canteenId) return [];
  const snapshot = await firestore()
    .collection('canteens')
    .doc(canteenId)
    .collection('pickupSlots')
    .where('isOpen', '==', true)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        slotId: doc.id,
        canteenId,
        date: data.date || '',
        startTime: data.startTime || '',
        endTime: data.endTime || '',
        timezone: data.timezone || 'Asia/Kolkata',
        isOpen: data.isOpen === true,
        capacity: typeof data.capacity === 'number' ? data.capacity : 30,
        reservedCount: typeof data.reservedCount === 'number' ? data.reservedCount : 0,
      };
    })
    .filter((slot) => slot.reservedCount < slot.capacity);
}

/**
 * Calls the trusted 'createOrder' Cloud Function to perform server-side order calculation,
 * pickup slot capacity reservation, idempotency recording, and cart clearing.
 */
export async function createOrderCallable(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  try {
    const callable = functions().httpsCallable('createOrder');
    const response = await callable(input);
    return response.data as CreateOrderResult;
  } catch (err: any) {
    console.error('[orderService] createOrderCallable error:', err);
    throw err;
  }
}

/**
 * Calls trusted 'transitionOrderStatus' Cloud Function (Step 8).
 */
export async function transitionOrderStatusCallable(input: {
  orderId: string;
  nextStatus: OrderStatus;
  reason?: string;
}): Promise<{
  success: boolean;
  isIdempotent: boolean;
  orderId: string;
  fromStatus?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}> {
  try {
    const callable = functions().httpsCallable('transitionOrderStatus');
    const response = await callable(input);
    return response.data as {
      success: boolean;
      isIdempotent: boolean;
      orderId: string;
      fromStatus?: string;
      status: OrderStatus;
      paymentStatus: PaymentStatus;
    };
  } catch (err: any) {
    console.error('[orderService] transitionOrderStatusCallable error:', err);
    throw err;
  }
}

/**
 * Calls 'verifyDemoPayment' Cloud Function (Step 8 — Emulator-Only Demo Behavior).
 */
export async function verifyDemoPaymentCallable(input: {
  orderId: string;
}): Promise<{
  success: boolean;
  orderId: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}> {
  try {
    const callable = functions().httpsCallable('verifyDemoPayment');
    const response = await callable(input);
    return response.data as {
      success: boolean;
      orderId: string;
      status: OrderStatus;
      paymentStatus: PaymentStatus;
    };
  } catch (err: any) {
    console.error('[orderService] verifyDemoPaymentCallable error:', err);
    throw err;
  }
}

/**
 * Calls 'getAdminOrderQueue' Cloud Function (Step 8).
 */
export async function getAdminOrderQueueCallable(input: {
  canteenId: string;
  status?: OrderStatus;
  limit?: number;
  startAfterOrderId?: string;
}): Promise<{
  success: boolean;
  canteenId: string;
  count: number;
  orders: any[];
}> {
  try {
    const callable = functions().httpsCallable('getAdminOrderQueue');
    const response = await callable(input);
    return response.data as {
      success: boolean;
      canteenId: string;
      count: number;
      orders: any[];
    };
  } catch (err: any) {
    console.error('[orderService] getAdminOrderQueueCallable error:', err);
    throw err;
  }
}

/**
 * Calls 'searchAdminOrder' Cloud Function (Step 8).
 */
export async function searchAdminOrderCallable(input: {
  canteenId: string;
  queryOrderId: string;
}): Promise<{
  success: boolean;
  order: any;
}> {
  try {
    const callable = functions().httpsCallable('searchAdminOrder');
    const response = await callable(input);
    return response.data as {
      success: boolean;
      order: any;
    };
  } catch (err: any) {
    console.error('[orderService] searchAdminOrderCallable error:', err);
    throw err;
  }
}

/**
 * Fetches status history subcollection for an order.
 */
export async function getOrderStatusHistory(
  orderId: string,
): Promise<OrderStatusHistoryEvent[]> {
  if (!orderId) return [];
  try {
    const snapshot = await firestore()
      .collection('orders')
      .doc(orderId)
      .collection('statusHistory')
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        eventId: doc.id,
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
    console.error('[orderService] getOrderStatusHistory error:', err);
    return [];
  }
}

/**
 * Fetches order history for the authenticated student using safe indexed query.
 */
export async function getStudentOrderHistory(studentUid: string): Promise<OrderDocument[]> {
  if (!studentUid) return [];
  const snapshot = await firestore()
    .collection('orders')
    .where('studentUid', '==', studentUid)
    .orderBy('createdAt', 'desc')
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      orderId: data.orderId || doc.id,
      studentUid: data.studentUid,
      canteenId: data.canteenId,
      pickupSlotId: data.pickupSlotId,
      pickupSlot: data.pickupSlot,
      itemsSnapshot: data.itemsSnapshot || [],
      subtotalInPaise: data.subtotalInPaise || 0,
      totalInPaise: data.totalInPaise || 0,
      currency: data.currency || 'INR',
      status: data.status || 'placed',
      paymentStatus: data.paymentStatus || 'pending',
      paymentMethod: data.paymentMethod || 'cash',
      idempotencyKey: data.idempotencyKey || '',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
}
