/**
 * GrabNGo - Client-Side In-App Notification Service (Step 10)
 *
 * Security & Architectural Constraints:
 * 1. ALL notification reads and mutations go through authenticated Cloud Function callables.
 * 2. Direct Firestore reads/writes to users/{userId}/notifications are STRICTLY PROHIBITED.
 * 3. This service is strictly in-app only — no FCM, no push tokens, no background delivery.
 */

import functions from '@react-native-firebase/functions';

// ------------------------------------------------------------------
// Canonical Types (mirrors notificationService.ts on server)
// ------------------------------------------------------------------

export type NotificationType =
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
  | 'refund_completed_demo'
  | 'new_order_for_admin'
  | 'payment_verified_for_admin';

export interface InAppNotification {
  readonly notificationId: string;
  readonly recipientRole?: 'student' | 'admin';
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly isRead: boolean;
  readonly orderId: string;
  readonly createdAt: any;
  readonly readAt: any | null;
}

// ------------------------------------------------------------------
// Callable Wrappers
// ------------------------------------------------------------------

/**
 * Fetches a paginated list of in-app notifications for the authenticated user.
 * Derives UID from Firebase Auth — never requires client to supply UID.
 */
export async function listMyNotificationsCallable(input?: {
  limit?: number;
  cursor?: string;
}): Promise<{
  success: boolean;
  notifications: InAppNotification[];
  count: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}> {
  try {
    const callable = functions().httpsCallable('listMyNotifications');
    const response = await callable(input || {});
    return response.data as {
      success: boolean;
      notifications: InAppNotification[];
      count: number;
      hasMore?: boolean;
      nextCursor?: string | null;
    };
  } catch (err: any) {
    console.error('[notificationService] listMyNotificationsCallable error:', err);
    throw err;
  }
}

/**
 * Marks a single notification as read (idempotent).
 */
export async function markNotificationReadCallable(input: {
  notificationId: string;
}): Promise<{ success: boolean; isIdempotent: boolean; notificationId: string }> {
  try {
    const callable = functions().httpsCallable('markNotificationRead');
    const response = await callable(input);
    return response.data as { success: boolean; isIdempotent: boolean; notificationId: string };
  } catch (err: any) {
    console.error('[notificationService] markNotificationReadCallable error:', err);
    throw err;
  }
}

/**
 * Marks all unread notifications as read (idempotent, bounded batches of 500).
 */
export async function markAllNotificationsReadCallable(input?: {
  cursor?: string;
}): Promise<{
  success: boolean;
  updatedCount: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}> {
  try {
    const callable = functions().httpsCallable('markAllNotificationsRead');
    const response = await callable(input || {});
    return response.data as {
      success: boolean;
      updatedCount: number;
      hasMore?: boolean;
      nextCursor?: string | null;
    };
  } catch (err: any) {
    console.error('[notificationService] markAllNotificationsReadCallable error:', err);
    throw err;
  }
}

/**
 * Returns the count of unread in-app notifications for the authenticated user.
 */
export async function getUnreadNotificationCountCallable(): Promise<{
  success: boolean;
  unreadCount: number;
}> {
  try {
    const callable = functions().httpsCallable('getUnreadNotificationCount');
    const response = await callable({});
    return response.data as { success: boolean; unreadCount: number };
  } catch (err: any) {
    console.error('[notificationService] getUnreadNotificationCountCallable error:', err);
    throw err;
  }
}
