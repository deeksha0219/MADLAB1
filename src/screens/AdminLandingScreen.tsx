/**
 * GrabNGo - Protected Admin Operations & Order Queue Console (Step 8)
 *
 * Security & Isolation Constraints:
 * 1. Admin operations are isolated to canteens assigned in `admins/{uid}.canteenIds`.
 * 2. Raw customer UIDs are masked server-side to protect student privacy.
 * 3. Status transitions are executed exclusively via transactional Cloud Functions.
 * 4. Exact order search strictly isolates cross-canteen queries (returns NOT_FOUND).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { AdminProfile } from '../services/adminService';
import { signOutUser } from '../services/authService';
import {
  OrderStatus,
  getAdminOrderQueueCallable,
  searchAdminOrderCallable,
  transitionOrderStatusCallable,
  verifyDemoPaymentCallable,
} from '../services/orderService';

type Props = {
  adminProfile: AdminProfile;
  navigation: any;
};

const STATUS_FILTERS: Array<{ label: string; value?: OrderStatus }> = [
  { label: 'All', value: undefined },
  { label: 'Placed', value: 'placed' },
  { label: 'Payment Verified', value: 'payment_verified' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Preparing', value: 'preparing' },
  { label: 'Ready', value: 'ready_for_pickup' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function AdminLandingScreen({ adminProfile }: Props) {
  const canteens = adminProfile.canteenIds || [];
  const [selectedCanteen, setSelectedCanteen] = useState<string>(canteens[0] || '');
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | undefined>(undefined);
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchedOrder, setSearchedOrder] = useState<any | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Reject Modal state
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [orderToReject, setOrderToReject] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('Out of stock or kitchen closed');
  const [isActionPending, setIsActionPending] = useState(false);

  const fetchQueue = useCallback(async () => {
    if (!selectedCanteen) return;
    setIsLoading(true);
    try {
      const result = await getAdminOrderQueueCallable({
        canteenId: selectedCanteen,
        status: selectedStatus,
        limit: 50,
      });
      setOrders(result.orders || []);
    } catch (err: any) {
      console.error('Failed to fetch admin order queue:', err);
      Alert.alert('Queue Error', err?.message || 'Could not load orders');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCanteen, selectedStatus]);

  useEffect(() => {
    setSearchedOrder(null);
    fetchQueue();
  }, [fetchQueue]);

  const handleSearch = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchedOrder(null);
      return;
    }
    setIsSearching(true);
    try {
      const result = await searchAdminOrderCallable({
        canteenId: selectedCanteen,
        queryOrderId: trimmed,
      });
      if (result.order) {
        setSearchedOrder(result.order);
      } else {
        Alert.alert('Search Result', 'Order not found in this canteen queue.');
        setSearchedOrder(null);
      }
    } catch (err: any) {
      Alert.alert('Search Error', err?.message || 'Order lookup failed.');
      setSearchedOrder(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchedOrder(null);
    fetchQueue();
  };

  const handleTransition = async (orderId: string, nextStatus: OrderStatus, reason?: string) => {
    setIsActionPending(true);
    try {
      const res = await transitionOrderStatusCallable({
        orderId,
        nextStatus,
        reason,
      });
      Alert.alert('Status Updated', `Order is now ${res.status.toUpperCase()}`);
      if (searchedOrder && (searchedOrder.id === orderId || searchedOrder.orderId === orderId)) {
        setSearchedOrder({ ...searchedOrder, status: res.status, paymentStatus: res.paymentStatus });
      }
      fetchQueue();
    } catch (err: any) {
      Alert.alert('Transition Error', err?.message || 'Failed to update order status');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleDemoPaymentVerify = async (orderId: string) => {
    setIsActionPending(true);
    try {
      const res = await verifyDemoPaymentCallable({ orderId });
      Alert.alert('Demo Payment', `Payment verified! Order is now ${res.status.toUpperCase()}`);
      if (searchedOrder && (searchedOrder.id === orderId || searchedOrder.orderId === orderId)) {
        setSearchedOrder({ ...searchedOrder, status: res.status, paymentStatus: res.paymentStatus });
      }
      fetchQueue();
    } catch (err: any) {
      Alert.alert('Demo Verify Error', err?.message || 'Demo payment verification failed');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleOpenRejectModal = (orderId: string) => {
    setOrderToReject(orderId);
    setRejectReason('Kitchen item unavailable');
    setRejectModalVisible(true);
  };

  const handleConfirmReject = async () => {
    if (!orderToReject) return;
    setRejectModalVisible(false);
    await handleTransition(orderToReject, 'rejected', rejectReason);
    setOrderToReject(null);
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
    } catch (error) {
      console.error('Error signing out admin:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'placed':
        return '#F59E0B'; // Amber
      case 'payment_verified':
        return '#3B82F6'; // Blue
      case 'accepted':
        return '#6366F1'; // Indigo
      case 'preparing':
        return '#8B5CF6'; // Purple
      case 'ready_for_pickup':
        return '#10B981'; // Emerald
      case 'completed':
        return '#059669'; // Green
      case 'cancelled':
      case 'rejected':
        return '#EF4444'; // Red
      default:
        return '#6B7280';
    }
  };

  const renderOrderCard = (order: any) => {
    const orderId = order.orderId || order.id;
    const status = order.status || 'placed';
    const paymentStatus = order.paymentStatus || 'pending';
    const paymentMethod = order.paymentMethod || 'cash';
    const maskedCustomer = order.customerIdMasked || (order.studentUid ? `student_...${order.studentUid.slice(-4)}` : 'student_anonymized');
    const totalRupees = ((order.totalInPaise || 0) / 100).toFixed(2);
    const slot = order.pickupSlot;

    return (
      <View key={orderId} style={styles.orderCard}>
        {/* Header row */}
        <View style={styles.orderCardHeader}>
          <View>
            <Text style={styles.orderIdText}>Order #{orderId.slice(0, 10)}...</Text>
            <Text style={styles.maskedCustomerText}>Customer: {maskedCustomer}</Text>
          </View>
          <View style={styles.badgeContainer}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(status) }]}>
              <Text style={styles.statusBadgeText}>{status.replace('_', ' ').toUpperCase()}</Text>
            </View>
            <View style={styles.payBadge}>
              <Text style={styles.payBadgeText}>{paymentMethod.toUpperCase()} ({paymentStatus})</Text>
            </View>
          </View>
        </View>

        {/* Slot details */}
        {slot && (
          <View style={styles.slotRow}>
            <Text style={styles.slotText}>
              📅 Slot: {slot.pickupDate} ({slot.pickupStartTime} - {slot.pickupEndTime})
            </Text>
          </View>
        )}

        {/* Items summary */}
        <View style={styles.itemsSummary}>
          {Array.isArray(order.itemsSnapshot) ? (
            order.itemsSnapshot.map((item: any, idx: number) => (
              <Text key={idx} style={styles.itemLine}>
                • {item.itemName} x{item.quantity} (₹{((item.lineTotalInPaise || 0) / 100).toFixed(2)})
              </Text>
            ))
          ) : (
            <Text style={styles.itemLine}>Items summary unavailable</Text>
          )}
        </View>

        {/* Price & Action Row */}
        <View style={styles.cardFooter}>
          <Text style={styles.totalText}>Total: ₹{totalRupees}</Text>

          <View style={styles.actionButtonGroup}>
            {/* Cash placed -> Accept */}
            {status === 'placed' && paymentMethod === 'cash' && (
              <TouchableOpacity
                style={[styles.btnAction, { backgroundColor: '#6366F1' }]}
                disabled={isActionPending}
                onPress={() => handleTransition(orderId, 'accepted')}
              >
                <Text style={styles.btnActionText}>Accept Cash Order</Text>
              </TouchableOpacity>
            )}

            {/* Online placed -> Demo Payment Verification (emulator only) */}
            {status === 'placed' && paymentMethod === 'upi_demo' && (
              <TouchableOpacity
                style={[styles.btnAction, { backgroundColor: '#3B82F6' }]}
                disabled={isActionPending}
                onPress={() => handleDemoPaymentVerify(orderId)}
              >
                <Text style={styles.btnActionText}>Verify Demo Pay</Text>
              </TouchableOpacity>
            )}

            {/* Payment Verified -> Accept */}
            {status === 'payment_verified' && (
              <TouchableOpacity
                style={[styles.btnAction, { backgroundColor: '#6366F1' }]}
                disabled={isActionPending}
                onPress={() => handleTransition(orderId, 'accepted')}
              >
                <Text style={styles.btnActionText}>Accept Order</Text>
              </TouchableOpacity>
            )}

            {/* Accepted -> Preparing */}
            {status === 'accepted' && (
              <TouchableOpacity
                style={[styles.btnAction, { backgroundColor: '#8B5CF6' }]}
                disabled={isActionPending}
                onPress={() => handleTransition(orderId, 'preparing')}
              >
                <Text style={styles.btnActionText}>Start Preparing</Text>
              </TouchableOpacity>
            )}

            {/* Preparing -> Ready */}
            {status === 'preparing' && (
              <TouchableOpacity
                style={[styles.btnAction, { backgroundColor: '#10B981' }]}
                disabled={isActionPending}
                onPress={() => handleTransition(orderId, 'ready_for_pickup')}
              >
                <Text style={styles.btnActionText}>Mark Ready</Text>
              </TouchableOpacity>
            )}

            {/* Ready -> Completed */}
            {status === 'ready_for_pickup' && (
              <TouchableOpacity
                style={[styles.btnAction, { backgroundColor: '#059669' }]}
                disabled={isActionPending}
                onPress={() => handleTransition(orderId, 'completed')}
              >
                <Text style={styles.btnActionText}>Complete Pickup</Text>
              </TouchableOpacity>
            )}

            {/* Non-terminal reject button */}
            {!['completed', 'cancelled', 'rejected'].includes(status) && (
              <TouchableOpacity
                style={[styles.btnAction, { backgroundColor: '#EF4444' }]}
                disabled={isActionPending}
                onPress={() => handleOpenRejectModal(orderId)}
              >
                <Text style={styles.btnActionText}>Reject</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Admin Console</Text>
          <TouchableOpacity style={styles.signOutSmall} onPress={handleSignOut}>
            <Text style={styles.signOutSmallText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>Protected Canteen Order Operations</Text>
      </View>

      {/* Canteen Switcher */}
      {canteens.length > 1 ? (
        <View style={styles.canteenSelectorRow}>
          <Text style={styles.filterLabel}>Canteen:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
            {canteens.map((cId) => (
              <TouchableOpacity
                key={cId}
                style={[
                  styles.canteenPill,
                  selectedCanteen === cId && styles.canteenPillActive,
                ]}
                onPress={() => setSelectedCanteen(cId)}
              >
                <Text
                  style={[
                    styles.canteenPillText,
                    selectedCanteen === cId && styles.canteenPillTextActive,
                  ]}
                >
                  {cId}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.singleCanteenBanner}>
          <Text style={styles.singleCanteenText}>Canteen: {selectedCanteen || 'None'}</Text>
        </View>
      )}

      {/* Search Bar */}
      <View style={styles.searchBarContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Exact Order ID Search..."
          placeholderTextColor="#64748B"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={styles.searchButton}
          onPress={handleSearch}
          disabled={isSearching}
        >
          {isSearching ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.searchButtonText}>Search</Text>
          )}
        </TouchableOpacity>
        {(searchQuery.length > 0 || searchedOrder) && (
          <TouchableOpacity style={styles.clearSearchBtn} onPress={handleClearSearch}>
            <Text style={styles.clearSearchText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Status Filter Tabs */}
      <View style={styles.filterTabsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {STATUS_FILTERS.map((tab, idx) => (
            <TouchableOpacity
              key={idx}
              style={[
                styles.filterTab,
                selectedStatus === tab.value && styles.filterTabActive,
              ]}
              onPress={() => setSelectedStatus(tab.value)}
            >
              <Text
                style={[
                  styles.filterTabText,
                  selectedStatus === tab.value && styles.filterTabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Orders List / Search Result */}
      {searchedOrder ? (
        <ScrollView style={styles.ordersScroll}>
          <View style={styles.searchResultBanner}>
            <Text style={styles.searchResultBannerText}>Search Result (Single Match)</Text>
          </View>
          {renderOrderCard(searchedOrder)}
        </ScrollView>
      ) : isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading queue for {selectedCanteen}...</Text>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No orders found matching filter.</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={fetchQueue}>
            <Text style={styles.refreshBtnText}>Refresh Queue</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.orderId || item.id}
          renderItem={({ item }) => renderOrderCard(item)}
          contentContainerStyle={styles.listContent}
          refreshing={isLoading}
          onRefresh={fetchQueue}
        />
      )}

      {/* Reject Reason Modal */}
      <Modal visible={rejectModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Reject Order</Text>
            <Text style={styles.modalSub}>
              Enter operational cancellation reason (will be logged to audit history):
            </Text>
            <TextInput
              style={styles.modalInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="e.g., Item out of stock"
              placeholderTextColor="#94A3B8"
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#64748B' }]}
                onPress={() => setRejectModalVisible(false)}
              >
                <Text style={styles.modalBtnText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#EF4444' }]}
                onPress={handleConfirmReject}
              >
                <Text style={styles.modalBtnText}>Confirm Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  signOutSmall: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  signOutSmallText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  canteenSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  canteenPill: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  canteenPillActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#60A5FA',
  },
  canteenPillText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  canteenPillTextActive: {
    color: '#FFF',
  },
  singleCanteenBanner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#1E293B',
  },
  singleCanteenText: {
    color: '#38BDF8',
    fontWeight: 'bold',
    fontSize: 13,
  },
  searchBarContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1E293B',
    color: '#FFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#334155',
  },
  searchButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  clearSearchBtn: {
    padding: 8,
  },
  clearSearchText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: 'bold',
  },
  filterTabsRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  filterTab: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  filterTabActive: {
    backgroundColor: '#38BDF8',
  },
  filterTabText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterTabTextActive: {
    color: '#0F172A',
    fontWeight: 'bold',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  ordersScroll: {
    padding: 16,
  },
  searchResultBanner: {
    backgroundColor: '#0284C7',
    padding: 8,
    borderRadius: 8,
    marginBottom: 12,
  },
  searchResultBannerText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 12,
    textAlign: 'center',
  },
  orderCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  orderIdText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 14,
  },
  maskedCustomerText: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  badgeContainer: {
    alignItems: 'flex-end',
    gap: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  payBadge: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  payBadgeText: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: 'bold',
  },
  slotRow: {
    backgroundColor: '#0F172A',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  slotText: {
    color: '#38BDF8',
    fontSize: 12,
  },
  itemsSummary: {
    marginBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 8,
  },
  itemLine: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 15,
  },
  actionButtonGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  btnAction: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnActionText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 10,
    fontSize: 13,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    marginBottom: 12,
  },
  refreshBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    backgroundColor: '#1E293B',
    width: '100%',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  modalSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: '#0F172A',
    color: '#FFF',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  modalBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
