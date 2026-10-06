/**
 * GrabNGo - NotificationBell Component (Step 10)
 *
 * A reusable bell icon with live unread count badge.
 * - Polls unread count via authenticated Cloud Function (no direct Firestore reads)
 * - Strictly in-app notification indicator only
 * - Navigates to NotificationsScreen on press
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
} from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import { getUnreadNotificationCountCallable } from '../services/notificationService';

interface NotificationBellProps {
  /** Color of the bell icon. Defaults to 'black'. */
  color?: string;
  /** Size of the bell icon. Defaults to 28. */
  size?: number;
  /** Poll interval in milliseconds. Defaults to 30 seconds. */
  pollIntervalMs?: number;
}

export default function NotificationBell({
  color = 'black',
  size = 28,
  pollIntervalMs = 30000,
}: NotificationBellProps) {
  const navigation = useNavigation<any>();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchUnreadCount = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const result = await getUnreadNotificationCountCallable();
      setUnreadCount(result.unreadCount ?? 0);
    } catch {
      // Silently fail — bell remains functional without a badge
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  // Initial fetch on mount
  useEffect(() => {
    fetchUnreadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic polling
  useEffect(() => {
    const interval = setInterval(() => {
      fetchUnreadCount();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchUnreadCount, pollIntervalMs]);

  // Re-fetch when screen becomes focused again
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchUnreadCount();
    });
    return unsubscribe;
  }, [navigation, fetchUnreadCount]);

  return (
    <TouchableOpacity
      accessibilityLabel="Notifications"
      accessibilityRole="button"
      onPress={() => navigation.navigate('Notifications')}
      style={styles.container}
      activeOpacity={0.7}
    >
      <MaterialIcon name="notifications-none" size={size} color={color} />
      {unreadCount > 0 && (
        <View style={styles.badge} accessibilityLabel={`${unreadCount} unread notifications`}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {unreadCount > 99 ? '99+' : String(unreadCount)}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    padding: 2,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: '#E53935',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
