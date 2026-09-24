/**
 * GrabNGo - NotificationsScreen (Step 10)
 *
 * Displays in-app notifications for the authenticated user.
 * All data is fetched via Cloud Function callables — no direct Firestore reads.
 *
 * IMPORTANT: This screen implements IN-APP NOTIFICATIONS ONLY.
 * Firebase Cloud Messaging (FCM), push notifications, device tokens,
 * background delivery, and APNs are NOT implemented and are intentionally excluded.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  SafeAreaView,
} from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import {
  InAppNotification,
  listMyNotificationsCallable,
  markNotificationReadCallable,
  markAllNotificationsReadCallable,
} from '../services/notificationService';

const NOTIFICATION_ICONS: Record<string, string> = {
  order_placed: 'receipt',
  payment_succeeded_demo: 'check-circle',
  payment_failed: 'cancel',
  order_accepted: 'thumb-up',
  order_preparing: 'restaurant',
  order_ready_for_pickup: 'notifications-active',
  order_completed: 'celebration',
  order_cancelled: 'block',
  order_rejected: 'do-not-disturb',
  refund_pending_demo: 'account-balance-wallet',
  refund_completed_demo: 'check-circle-outline',
  new_order_for_admin: 'add-shopping-cart',
  payment_verified_for_admin: 'verified',
};

const NOTIFICATION_COLORS: Record<string, string> = {
  order_placed: '#1976D2',
  payment_succeeded_demo: '#388E3C',
  payment_failed: '#D32F2F',
  order_accepted: '#1976D2',
  order_preparing: '#F57C00',
  order_ready_for_pickup: '#7B1FA2',
  order_completed: '#388E3C',
  order_cancelled: '#616161',
  order_rejected: '#D32F2F',
  refund_pending_demo: '#F57C00',
  refund_completed_demo: '#388E3C',
  new_order_for_admin: '#1976D2',
  payment_verified_for_admin: '#388E3C',
};

function formatTimestamp(ts: any): string {
  if (!ts) return '';
  try {
    const date: Date = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch {
    return '';
  }
}

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();

  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState<boolean>(false);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const loadNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await listMyNotificationsCallable({ limit: 20 });
      setNotifications(result.notifications);
      setNextCursor(result.nextCursor || null);
      setHasMore(result.hasMore === true);
    } catch (err: any) {
      setError('Failed to load notifications. Pull down to retry.');
      console.error('[NotificationsScreen] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore || loading || refreshing) return;
    setLoadingMore(true);
    try {
      const result = await listMyNotificationsCallable({ limit: 20, cursor: nextCursor });
      setNotifications((prev) => [...prev, ...result.notifications]);
      setNextCursor(result.nextCursor || null);
      setHasMore(result.hasMore === true);
    } catch (err: any) {
      console.warn('[NotificationsScreen] loadMore error:', err?.message);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, nextCursor, loadingMore, loading, refreshing]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleNotificationPress = useCallback(
    async (notification: InAppNotification) => {
      // Mark as read if not already
      if (!notification.isRead) {
        try {
          await markNotificationReadCallable({ notificationId: notification.notificationId });
          setNotifications((prev) =>
            prev.map((n) =>
              n.notificationId === notification.notificationId ? { ...n, isRead: true } : n,
            ),
          );
        } catch (err: any) {
          console.warn('[NotificationsScreen] markRead error:', err?.message);
        }
      }
      // Navigate to associated order
      if (notification.orderId) {
        navigation.navigate('OrderHistory', { focusOrderId: notification.orderId });
      }
    },
    [navigation],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    setMarkingAll(true);
    try {
      let moreToProcess = true;
      let cursor: string | undefined = undefined;
      while (moreToProcess) {
        const res = await markAllNotificationsReadCallable({ cursor });
        moreToProcess = res.hasMore === true && !!res.nextCursor;
        cursor = res.nextCursor || undefined;
      }
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (err: any) {
      Alert.alert('Error', 'Failed to mark all as read. Please try again.');
      console.error('[NotificationsScreen] markAll error:', err?.message);
    } finally {
      setMarkingAll(false);
    }
  }, [unreadCount]);

  const renderNotification = useCallback(
    ({ item }: { item: InAppNotification }) => {
      const iconName = NOTIFICATION_ICONS[item.type] || 'notifications';
      const iconColor = NOTIFICATION_COLORS[item.type] || '#1976D2';

      return (
        <TouchableOpacity
          style={[styles.notifCard, !item.isRead && styles.notifCardUnread]}
          onPress={() => handleNotificationPress(item)}
          activeOpacity={0.8}
          accessibilityLabel={`${item.title}. ${item.isRead ? 'Read' : 'Unread'}`}
        >
          <View style={[styles.iconWrapper, { backgroundColor: iconColor + '18' }]}>
            <MaterialIcon name={iconName} size={24} color={iconColor} />
          </View>
          <View style={styles.notifContent}>
            <View style={styles.notifHeader}>
              <Text style={styles.notifTitle} numberOfLines={1}>
                {item.title}
              </Text>
              {!item.isRead && <View style={styles.unreadDot} />}
            </View>
            <Text style={styles.notifBody} numberOfLines={2}>
              {item.body}
            </Text>
            <Text style={styles.notifTime}>{formatTimestamp(item.createdAt)}</Text>
          </View>
          <MaterialIcon name="chevron-right" size={20} color="#BDBDBD" />
        </TouchableOpacity>
      );
    },
    [handleNotificationPress],
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <MaterialIcon name="notifications-none" size={64} color="#BDBDBD" />
      <Text style={styles.emptyTitle}>No Notifications</Text>
      <Text style={styles.emptySubtitle}>
        You'll see order updates, payment confirmations, and pickup alerts here.
      </Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyContainer}>
      <MaterialIcon name="error-outline" size={64} color="#E53935" />
      <Text style={styles.emptyTitle}>Could not load</Text>
      <Text style={styles.emptySubtitle}>{error}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityLabel="Go back"
        >
          <MaterialIcon name="arrow-back" size={24} color="#212121" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{unreadCount} unread</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 ? (
          <TouchableOpacity
            onPress={handleMarkAllRead}
            disabled={markingAll}
            style={styles.markAllBtn}
            accessibilityLabel="Mark all notifications as read"
          >
            {markingAll ? (
              <ActivityIndicator size="small" color="#E53935" />
            ) : (
              <Text style={styles.markAllText}>Mark all read</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      {/* In-app only disclaimer */}
      <View style={styles.disclaimer}>
        <MaterialIcon name="info-outline" size={14} color="#757575" />
        <Text style={styles.disclaimerText}>
          🔔 In-App Notifications: Displayed within GrabNGo while using the app. Background push
          delivery is not enabled.
        </Text>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#E53935" />
          <Text style={styles.loadingText}>Loading notifications…</Text>
        </View>
      ) : error ? (
        renderError()
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.notificationId}
          renderItem={renderNotification}
          contentContainerStyle={
            notifications.length === 0 ? styles.flatListEmpty : styles.flatListContent
          }
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadNotifications(true)}
              colors={['#E53935']}
              tintColor="#E53935"
            />
          }
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color="#E53935" />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  backBtn: {
    padding: 4,
    marginRight: 8,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#212121',
  },
  headerBadge: {
    backgroundColor: '#FFEBEE',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  headerBadgeText: {
    fontSize: 12,
    color: '#E53935',
    fontWeight: '600',
  },
  markAllBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 80,
    alignItems: 'flex-end',
  },
  markAllText: {
    fontSize: 13,
    color: '#E53935',
    fontWeight: '600',
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F9FBE7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F4C3',
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    color: '#757575',
    lineHeight: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#757575',
  },
  flatListContent: {
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  flatListEmpty: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#424242',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#757575',
    textAlign: 'center',
    lineHeight: 20,
  },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  notifCardUnread: {
    backgroundColor: '#FFF8F8',
    borderLeftWidth: 3,
    borderLeftColor: '#E53935',
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  notifContent: {
    flex: 1,
    gap: 3,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#212121',
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E53935',
    flexShrink: 0,
  },
  notifBody: {
    fontSize: 13,
    color: '#616161',
    lineHeight: 18,
  },
  notifTime: {
    fontSize: 11,
    color: '#9E9E9E',
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: '#F5F5F5',
    marginLeft: 72,
  },
});
