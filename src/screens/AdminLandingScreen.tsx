/**
 * GrabNGo Step 11 — Protected Service Desk & Admin Operations Console
 *
 * Touch-Screen Kiosk & Monitor Interface for Canteen Operators.
 *
 * Security & Architectural Constraints:
 * 1. Server-authoritative role & canteen isolation (canteen_admin & service_desk).
 * 2. Integrated virtual touch-screen keyboard with visible ON / OFF toggle control.
 * 3. Exact order lookup and bounded queue retrieval; cross-canteen queries return generic not-found.
 * 4. Transactional status transitions with confirmation modals for destructive operations.
 * 5. Operational notes and immutable audit history subcollection inspection.
 * 6. Display-only payment and refund states; zero client/operator payment mutation.
 * 7. Clean session state: logout clears search query, selected order details, and keyboard state.
 * 8. Touch targets optimized for kiosks and monitors (minimum 48pt).
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
  OperationalOrder,
  listOperationalOrdersCallable,
  searchOperationalOrdersCallable,
  getOperationalOrderDetailsCallable,
  createOperationalNoteCallable,
  transitionOperationalOrderStatusCallable,
} from '../services/orderService';
import NotificationBell from '../components/NotificationBell';
import TouchKeyboard from '../components/TouchKeyboard';

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
  { label: 'Rejected', value: 'rejected' },
];

export default function AdminLandingScreen({ adminProfile }: Props) {
  const canteens = adminProfile.canteenIds || [];
  const [selectedCanteen, setSelectedCanteen] = useState<string>(canteens[0] || '');
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | undefined>(undefined);
  const [orders, setOrders] = useState<OperationalOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchedOrder, setSearchedOrder] = useState<OperationalOrder | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // In-Screen Keyboard State (Defaults to ON for touch kiosk/monitor interface)
  const [isKeyboardEnabled, setIsKeyboardEnabled] = useState<boolean>(true);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState<boolean>(false);

  // Order Details Modal State
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<OperationalOrder | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);

  // Operational Note Modal State
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [targetOrderIdForNote, setTargetOrderIdForNote] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

  // Confirmation Modal State (Reject / Cancel)
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [actionTargetOrderId, setActionTargetOrderId] = useState<string | null>(null);
  const [actionTargetStatus, setActionTargetStatus] = useState<OrderStatus | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [isActionPending, setIsActionPending] = useState(false);

  // Fetch queue from server-authorized listOperationalOrders callable
  const fetchQueue = useCallback(async () => {
    if (!selectedCanteen) return;
    setIsLoading(true);
    try {
      const result = await listOperationalOrdersCallable({
        canteenId: selectedCanteen,
        status: selectedStatus,
        limit: 50,
      });
      setOrders(result.orders || []);
    } catch (err: any) {
      console.error('Failed to fetch operational order queue:', err);
      Alert.alert('Queue Error', err?.message || 'Could not load orders');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCanteen, selectedStatus]);

  useEffect(() => {
    setSearchedOrder(null);
    fetchQueue();
  }, [fetchQueue]);

  // Search by order ID or reference
  const handleSearch = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchedOrder(null);
      return;
    }
    setIsSearching(true);
    setIsKeyboardVisible(false);
    try {
      const result = await searchOperationalOrdersCallable({
        canteenId: selectedCanteen,
        query: trimmed,
      });
      if (result.found && result.order) {
        setSearchedOrder(result.order);
      } else {
        Alert.alert('Search Result', 'Order not found in this canteen.');
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

  // Keyboard handlers
  const handleVirtualKeyPress = (char: string) => {
    if (searchQuery.length < 64) {
      setSearchQuery((prev) => prev + char);
    }
  };

  const handleVirtualBackspace = () => {
    setSearchQuery((prev) => prev.slice(0, -1));
  };

  const handleVirtualClear = () => {
    setSearchQuery('');
  };

  const handleToggleKeyboard = () => {
    setIsKeyboardEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setIsKeyboardVisible(false);
      }
      return next;
    });
  };

  // View full operational order details (notes + audit events)
  const handleOpenOrderDetails = async (orderId: string) => {
    setIsLoadingDetails(true);
    setDetailsModalVisible(true);
    try {
      const res = await getOperationalOrderDetailsCallable({ orderId });
      setSelectedOrderDetails(res.order);
    } catch (err: any) {
      Alert.alert('Details Error', err?.message || 'Could not load order details');
      setDetailsModalVisible(false);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Transition order status with server-side state machine
  const executeStatusTransition = async (orderId: string, targetStatus: OrderStatus, reason?: string) => {
    setIsActionPending(true);
    try {
      const res = await transitionOperationalOrderStatusCallable({
        orderId,
        targetStatus,
        reason,
      });
      Alert.alert('Status Updated', `Order #${orderId.slice(0, 8)} is now ${res.status.toUpperCase()}`);
      if (searchedOrder && searchedOrder.orderId === orderId) {
        setSearchedOrder({ ...searchedOrder, status: res.status, paymentStatus: res.paymentStatus });
      }
      if (selectedOrderDetails && selectedOrderDetails.orderId === orderId) {
        setSelectedOrderDetails({ ...selectedOrderDetails, status: res.status, paymentStatus: res.paymentStatus });
      }
      fetchQueue();
    } catch (err: any) {
      Alert.alert('Transition Error', err?.message || 'Failed to update order status');
    } finally {
      setIsActionPending(false);
      setConfirmModalVisible(false);
    }
  };

  // Prompt confirmation for destructive operations (Reject / Cancel)
  const handlePromptDestructiveAction = (orderId: string, status: OrderStatus) => {
    setActionTargetOrderId(orderId);
    setActionTargetStatus(status);
    setActionReason(status === 'rejected' ? 'Kitchen out of stock' : 'Operational exception cancellation');
    setConfirmModalVisible(true);
  };

  const handleConfirmDestructiveAction = async () => {
    if (!actionTargetOrderId || !actionTargetStatus) return;
    await executeStatusTransition(actionTargetOrderId, actionTargetStatus, actionReason);
    setActionTargetOrderId(null);
    setActionTargetStatus(null);
  };

  // Add operational note
  const handleOpenNoteModal = (orderId: string) => {
    setTargetOrderIdForNote(orderId);
    setNoteBody('');
    setNoteModalVisible(true);
  };

  const handleSubmitNote = async () => {
    if (!targetOrderIdForNote || !noteBody.trim()) return;
    setIsSubmittingNote(true);
    try {
      await createOperationalNoteCallable({
        orderId: targetOrderIdForNote,
        body: noteBody.trim(),
      });
      Alert.alert('Note Added', 'Operational note saved successfully.');
      setNoteModalVisible(false);
      setNoteBody('');
      if (selectedOrderDetails && selectedOrderDetails.orderId === targetOrderIdForNote) {
        handleOpenOrderDetails(targetOrderIdForNote);
      }
    } catch (err: any) {
      Alert.alert('Note Error', err?.message || 'Failed to create note');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  // Safe Logout: Clears all sensitive screen state
  const handleSignOut = async () => {
    try {
      setSearchQuery('');
      setSearchedOrder(null);
      setSelectedOrderDetails(null);
      setIsKeyboardVisible(false);
      setDetailsModalVisible(false);
      setNoteModalVisible(false);
      setConfirmModalVisible(false);
      await signOutUser();
    } catch (error) {
      console.error('Error signing out operator:', error);
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

  const getPaymentStatusNotice = (paymentStatus?: string, refundStatus?: string) => {
    if (refundStatus === 'pending') return 'Demo refund pending.';
    if (refundStatus === 'succeeded_demo') return 'Demo refund completed — no real money was transferred.';
    if (paymentStatus === 'succeeded_demo') return 'Demo payment verified — no real money was processed.';
    if (paymentStatus === 'failed') return 'Payment failed.';
    if (paymentStatus === 'expired') return 'Payment attempt expired — payment can be retried if the order is still eligible.';
    return `Payment status: ${paymentStatus || 'pending'}`;
  };

  const renderOrderCard = (order: OperationalOrder) => {
    const orderId = order.orderId;
    const status = order.status || 'placed';
    const paymentStatus = order.paymentStatus || 'pending';
    const totalRupees = ((order.totalInPaise || 0) / 100).toFixed(2);
    const slot = order.pickupSlot;

    return (
      <View key={orderId} testID={`order-card-${orderId}`} style={styles.orderCard}>
        {/* Header row */}
        <View style={styles.orderCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderIdText}>Order #{order.shortOrderReference || orderId.slice(0, 8)}</Text>
            <Text style={styles.maskedCustomerText}>Customer: {order.maskedCustomer}</Text>
          </View>
          <View style={styles.badgeContainer}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(status) }]}>
              <Text style={styles.statusBadgeText}>{status.replace('_', ' ').toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* Payment notice banner */}
        <View style={styles.paymentNoticeBanner}>
          <Text style={styles.paymentNoticeText}>
            ℹ️ {getPaymentStatusNotice(paymentStatus, order.refundStatus)}
          </Text>
        </View>

        {/* Slot details */}
        {slot && (
          <View style={styles.slotRow}>
            <Text style={styles.slotText}>
              📅 Slot: {slot.pickupDate} ({slot.pickupStartTime || slot.startTime} - {slot.pickupEndTime || slot.endTime})
            </Text>
          </View>
        )}

        {/* Summary row */}
        <View style={styles.cardFooter}>
          <Text style={styles.totalText}>Total: ₹{totalRupees} ({order.itemCount || 1} items)</Text>
          <TouchableOpacity
            testID={`view-details-${orderId}`}
            accessibilityLabel={`View details for order ${orderId}`}
            accessibilityRole="button"
            style={styles.btnDetails}
            onPress={() => handleOpenOrderDetails(orderId)}
          >
            <Text style={styles.btnDetailsText}>View Details / Notes</Text>
          </TouchableOpacity>
        </View>

        {/* Status Transition Action Buttons */}
        <View style={styles.actionRow}>
          {status === 'placed' && (
            <TouchableOpacity
              testID={`btn-accept-${orderId}`}
              accessibilityLabel="Accept order"
              accessibilityRole="button"
              style={[styles.btnAction, { backgroundColor: '#6366F1' }]}
              disabled={isActionPending}
              onPress={() => executeStatusTransition(orderId, 'accepted')}
            >
              <Text style={styles.btnActionText}>Accept</Text>
            </TouchableOpacity>
          )}

          {status === 'payment_verified' && (
            <TouchableOpacity
              testID={`btn-accept-${orderId}`}
              accessibilityLabel="Accept order"
              accessibilityRole="button"
              style={[styles.btnAction, { backgroundColor: '#6366F1' }]}
              disabled={isActionPending}
              onPress={() => executeStatusTransition(orderId, 'accepted')}
            >
              <Text style={styles.btnActionText}>Accept Order</Text>
            </TouchableOpacity>
          )}

          {status === 'accepted' && (
            <TouchableOpacity
              testID={`btn-preparing-${orderId}`}
              accessibilityLabel="Start preparing order"
              accessibilityRole="button"
              style={[styles.btnAction, { backgroundColor: '#8B5CF6' }]}
              disabled={isActionPending}
              onPress={() => executeStatusTransition(orderId, 'preparing')}
            >
              <Text style={styles.btnActionText}>Start Preparing</Text>
            </TouchableOpacity>
          )}

          {status === 'preparing' && (
            <TouchableOpacity
              testID={`btn-ready-${orderId}`}
              accessibilityLabel="Mark order ready for pickup"
              accessibilityRole="button"
              style={[styles.btnAction, { backgroundColor: '#10B981' }]}
              disabled={isActionPending}
              onPress={() => executeStatusTransition(orderId, 'ready_for_pickup')}
            >
              <Text style={styles.btnActionText}>Mark Ready</Text>
            </TouchableOpacity>
          )}

          {status === 'ready_for_pickup' && (
            <TouchableOpacity
              testID={`btn-complete-${orderId}`}
              accessibilityLabel="Complete order pickup"
              accessibilityRole="button"
              style={[styles.btnAction, { backgroundColor: '#059669' }]}
              disabled={isActionPending}
              onPress={() => executeStatusTransition(orderId, 'completed')}
            >
              <Text style={styles.btnActionText}>Complete Pickup</Text>
            </TouchableOpacity>
          )}

          {/* Destructive Reject / Cancel actions */}
          {!['completed', 'cancelled', 'rejected'].includes(status) && (
            <TouchableOpacity
              testID={`btn-reject-${orderId}`}
              accessibilityLabel="Reject order"
              accessibilityRole="button"
              style={[styles.btnAction, { backgroundColor: '#EF4444' }]}
              disabled={isActionPending}
              onPress={() => handlePromptDestructiveAction(orderId, 'rejected')}
            >
              <Text style={styles.btnActionText}>Reject</Text>
            </TouchableOpacity>
          )}

          {/* Add quick operational note button */}
          <TouchableOpacity
            testID={`btn-add-note-${orderId}`}
            accessibilityLabel="Add operational note"
            accessibilityRole="button"
            style={[styles.btnAction, { backgroundColor: '#475569' }]}
            onPress={() => handleOpenNoteModal(orderId)}
          >
            <Text style={styles.btnActionText}>+ Note</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Kiosk / Monitor Top Bar */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Service Desk Console</Text>
            <Text style={styles.sessionText}>
              Operator: {adminProfile.uid} ({adminProfile.role === 'service_desk' ? 'Service Desk' : 'Canteen Admin'})
            </Text>
          </View>
          <View style={styles.headerActions}>
            <NotificationBell color="#fff" size={28} />

            {/* In-Screen Keyboard Enable/Disable Toggle */}
            <TouchableOpacity
              testID="toggle-keyboard-btn"
              accessibilityLabel={`In-screen keyboard toggle, currently ${isKeyboardEnabled ? 'ON' : 'OFF'}`}
              accessibilityRole="button"
              activeOpacity={0.8}
              onPress={handleToggleKeyboard}
              style={[
                styles.keyboardToggleBtn,
                isKeyboardEnabled ? styles.keyboardToggleOn : styles.keyboardToggleOff,
              ]}
            >
              <Text style={styles.keyboardToggleText}>
                ⌨️ Virtual Keyboard: {isKeyboardEnabled ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="btn-sign-out"
              accessibilityLabel="Sign out of service desk"
              accessibilityRole="button"
              style={styles.signOutBtn}
              onPress={handleSignOut}
            >
              <Text style={styles.signOutBtnText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Canteen Switcher */}
      {canteens.length > 1 ? (
        <View style={styles.canteenSelectorRow}>
          <Text style={styles.filterLabel}>Canteen:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
            {canteens.map((cId) => (
              <TouchableOpacity
                key={cId}
                testID={`canteen-pill-${cId}`}
                accessibilityLabel={`Select canteen ${cId}`}
                accessibilityRole="button"
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
          <Text style={styles.singleCanteenText}>Assigned Canteen: {selectedCanteen || 'None'}</Text>
        </View>
      )}

      {/* Search Input Bar with Virtual Keyboard Launcher */}
      <View style={styles.searchBarContainer}>
        <TextInput
          testID="search-order-input"
          accessibilityLabel="Search order by ID or reference"
          style={styles.searchInput}
          placeholder="Search by Order ID or Reference..."
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={() => {
            if (isKeyboardEnabled) {
              setIsKeyboardVisible(true);
            }
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={64}
        />

        {isKeyboardEnabled && (
          <TouchableOpacity
            testID="open-keyboard-btn"
            accessibilityLabel="Open in-screen keyboard"
            accessibilityRole="button"
            style={styles.openKeyboardBtn}
            onPress={() => setIsKeyboardVisible((prev) => !prev)}
          >
            <Text style={styles.openKeyboardBtnText}>⌨️</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          testID="btn-search-order"
          accessibilityLabel="Submit order search"
          accessibilityRole="button"
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
          <TouchableOpacity
            testID="btn-clear-search"
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            style={styles.clearSearchBtn}
            onPress={handleClearSearch}
          >
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
              testID={`status-filter-${tab.value || 'all'}`}
              accessibilityLabel={`Filter by ${tab.label}`}
              accessibilityRole="button"
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
            <Text style={styles.searchResultBannerText}>Search Match Found</Text>
          </View>
          {renderOrderCard(searchedOrder)}
        </ScrollView>
      ) : isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading incoming orders...</Text>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No orders found for this filter.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.orderId}
          renderItem={({ item }) => renderOrderCard(item)}
          contentContainerStyle={styles.listContainer}
        />
      )}

      {/* In-Screen Virtual Keyboard */}
      <TouchKeyboard
        visible={isKeyboardEnabled && isKeyboardVisible}
        onKeyPress={handleVirtualKeyPress}
        onBackspace={handleVirtualBackspace}
        onClear={handleVirtualClear}
        onSubmit={handleSearch}
        onClose={() => setIsKeyboardVisible(false)}
        isDisabled={isSearching}
        maxLength={64}
        currentLength={searchQuery.length}
      />

      {/* Order Detail Modal */}
      <Modal
        visible={detailsModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setDetailsModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Order Details & Audit History</Text>
            <TouchableOpacity
              testID="close-details-modal"
              accessibilityLabel="Close order details modal"
              accessibilityRole="button"
              style={styles.modalCloseBtn}
              onPress={() => setDetailsModalVisible(false)}
            >
              <Text style={styles.modalCloseBtnText}>✕ Close</Text>
            </TouchableOpacity>
          </View>

          {isLoadingDetails || !selectedOrderDetails ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={styles.loadingText}>Fetching order details...</Text>
            </View>
          ) : (
            <ScrollView style={styles.modalBody}>
              <Text style={styles.detailHeaderId}>
                Order #{selectedOrderDetails.shortOrderReference || selectedOrderDetails.orderId}
              </Text>
              <Text style={styles.detailRow}>
                Customer: <Text style={styles.detailBold}>{selectedOrderDetails.maskedCustomer}</Text>
              </Text>
              <Text style={styles.detailRow}>
                Status: <Text style={styles.detailBold}>{selectedOrderDetails.status.toUpperCase()}</Text>
              </Text>
              <Text style={styles.detailRow}>
                Total: <Text style={styles.detailBold}>₹{((selectedOrderDetails.totalInPaise || 0) / 100).toFixed(2)}</Text>
              </Text>

              <View style={styles.detailNoticeBox}>
                <Text style={styles.detailNoticeText}>
                  {getPaymentStatusNotice(selectedOrderDetails.paymentStatus, selectedOrderDetails.refundStatus)}
                </Text>
              </View>

              {/* Items Snapshot */}
              <Text style={styles.sectionHeader}>Ordered Items</Text>
              {Array.isArray(selectedOrderDetails.itemsSnapshot) && selectedOrderDetails.itemsSnapshot.map((it, idx) => (
                <View key={idx} style={styles.detailItemRow}>
                  <Text style={styles.detailItemName}>• {it.itemName} x{it.quantity}</Text>
                  <Text style={styles.detailItemPrice}>₹{((it.lineTotalInPaise || 0) / 100).toFixed(2)}</Text>
                </View>
              ))}

              {/* Operational Notes Section */}
              <View style={styles.notesSectionHeader}>
                <Text style={styles.sectionHeader}>Operational Notes</Text>
                <TouchableOpacity
                  testID="btn-open-add-note"
                  accessibilityLabel="Add a new operational note"
                  accessibilityRole="button"
                  style={styles.btnAddNoteSmall}
                  onPress={() => handleOpenNoteModal(selectedOrderDetails.orderId)}
                >
                  <Text style={styles.btnAddNoteSmallText}>+ Add Note</Text>
                </TouchableOpacity>
              </View>

              {(!selectedOrderDetails.operationalNotes || selectedOrderDetails.operationalNotes.length === 0) ? (
                <Text style={styles.emptySubText}>No operational notes recorded yet.</Text>
              ) : (
                selectedOrderDetails.operationalNotes.map((note) => (
                  <View key={note.noteId} style={styles.noteCard}>
                    <Text style={styles.noteAuthor}>
                      By: {note.authorRole === 'service_desk' ? 'Service Desk' : 'Canteen Admin'} ({note.authorUid.slice(0, 8)}...)
                    </Text>
                    <Text style={styles.noteBody}>{note.body}</Text>
                  </View>
                ))
              )}

              {/* Audit History Section */}
              <Text style={styles.sectionHeader}>Immutable Audit History</Text>
              {(!selectedOrderDetails.auditHistory || selectedOrderDetails.auditHistory.length === 0) ? (
                <Text style={styles.emptySubText}>No audit history available.</Text>
              ) : (
                selectedOrderDetails.auditHistory.map((ev) => (
                  <View key={ev.eventId} style={styles.auditCard}>
                    <Text style={styles.auditEventTitle}>
                      {ev.eventType} ({ev.fromStatus || 'none'} ➔ {ev.toStatus || 'none'})
                    </Text>
                    <Text style={styles.auditActor}>
                      Actor: {ev.actorRole} ({ev.actorUid.slice(0, 8)}...)
                    </Text>
                    {ev.reason ? <Text style={styles.auditReason}>Reason: {ev.reason}</Text> : null}
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Add Operational Note Modal */}
      <Modal
        visible={noteModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setNoteModalVisible(false)}
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Add Operational Note</Text>
            <Text style={styles.dialogSubtitle}>
              Notes are immutable operational records (max 1000 characters).
            </Text>
            <TextInput
              testID="note-body-input"
              accessibilityLabel="Operational note text"
              style={styles.dialogTextInput}
              placeholder="Enter operational note or exception reason..."
              placeholderTextColor="#94A3B8"
              value={noteBody}
              onChangeText={setNoteBody}
              multiline
              maxLength={1000}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                testID="btn-cancel-note"
                accessibilityLabel="Cancel adding note"
                accessibilityRole="button"
                style={styles.dialogCancelBtn}
                onPress={() => setNoteModalVisible(false)}
                disabled={isSubmittingNote}
              >
                <Text style={styles.dialogCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="btn-submit-note"
                accessibilityLabel="Save operational note"
                accessibilityRole="button"
                style={styles.dialogSubmitBtn}
                onPress={handleSubmitNote}
                disabled={isSubmittingNote || !noteBody.trim()}
              >
                {isSubmittingNote ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.dialogSubmitBtnText}>Save Note</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Destructive Action Confirmation Modal */}
      <Modal
        visible={confirmModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setConfirmModalVisible(false)}
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitleDestructive}>
              Confirm Order {actionTargetStatus === 'rejected' ? 'Rejection' : 'Cancellation'}
            </Text>
            <Text style={styles.dialogSubtitle}>
              This action cannot be undone. Please specify the operational reason.
            </Text>
            <TextInput
              testID="destructive-reason-input"
              accessibilityLabel="Reason for rejection or cancellation"
              style={styles.dialogTextInput}
              placeholder="Reason for cancellation/rejection..."
              placeholderTextColor="#94A3B8"
              value={actionReason}
              onChangeText={setActionReason}
              maxLength={200}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                testID="btn-cancel-destructive"
                accessibilityLabel="Cancel action"
                accessibilityRole="button"
                style={styles.dialogCancelBtn}
                onPress={() => setConfirmModalVisible(false)}
                disabled={isActionPending}
              >
                <Text style={styles.dialogCancelBtnText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="btn-confirm-destructive"
                accessibilityLabel="Confirm destructive action"
                accessibilityRole="button"
                style={[styles.dialogSubmitBtn, { backgroundColor: '#EF4444' }]}
                onPress={handleConfirmDestructiveAction}
                disabled={isActionPending}
              >
                {isActionPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.dialogSubmitBtnText}>Confirm {actionTargetStatus?.toUpperCase()}</Text>
                )}
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
    backgroundColor: '#0F172A', // Slate 900
  },
  header: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  sessionText: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  keyboardToggleBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardToggleOn: {
    backgroundColor: '#059669', // Emerald
  },
  keyboardToggleOff: {
    backgroundColor: '#475569', // Slate
  },
  keyboardToggleText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  signOutBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signOutBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  canteenSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1E293B',
  },
  filterLabel: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 10,
  },
  canteenPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#334155',
    marginRight: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  canteenPillActive: {
    backgroundColor: '#DF401C',
  },
  canteenPillText: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 14,
  },
  canteenPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  singleCanteenBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1E293B',
  },
  singleCanteenText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '600',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    color: '#F8FAFC',
    fontSize: 15,
  },
  openKeyboardBtn: {
    minHeight: 48,
    minWidth: 48,
    backgroundColor: '#334155',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  openKeyboardBtnText: {
    fontSize: 20,
  },
  searchButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    backgroundColor: '#DF401C',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  clearSearchBtn: {
    minHeight: 48,
    minWidth: 40,
    backgroundColor: '#475569',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearSearchText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  filterTabsRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    marginRight: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  filterTabActive: {
    backgroundColor: '#2563EB',
  },
  filterTabText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  filterTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  orderCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  orderIdText: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
  },
  maskedCustomerText: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  badgeContainer: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  paymentNoticeBanner: {
    backgroundColor: '#0F172A',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 6,
  },
  paymentNoticeText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  slotRow: {
    marginVertical: 4,
  },
  slotText: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  totalText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  btnDetails: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#334155',
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnDetailsText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  btnAction: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 10,
    fontSize: 14,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '600',
  },
  ordersScroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  searchResultBanner: {
    backgroundColor: '#065F46',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  searchResultBannerText: {
    color: '#A7F3D0',
    fontSize: 13,
    fontWeight: '700',
  },
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  modalCloseBtn: {
    padding: 8,
    backgroundColor: '#334155',
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  modalCloseBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  modalBody: {
    padding: 16,
  },
  detailHeaderId: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 10,
  },
  detailRow: {
    fontSize: 15,
    color: '#94A3B8',
    marginBottom: 4,
  },
  detailBold: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  detailNoticeBox: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 12,
    marginVertical: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#38BDF8',
  },
  detailNoticeText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F8FAFC',
    marginTop: 16,
    marginBottom: 8,
  },
  detailItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailItemName: {
    color: '#CBD5E1',
    fontSize: 14,
  },
  detailItemPrice: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 14,
  },
  notesSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  btnAddNoteSmall: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#2563EB',
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnAddNoteSmallText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  emptySubText: {
    color: '#64748B',
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  noteCard: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#8B5CF6',
  },
  noteAuthor: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  noteBody: {
    color: '#F8FAFC',
    fontSize: 14,
  },
  auditCard: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#10B981',
  },
  auditEventTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  auditActor: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  auditReason: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
    fontStyle: 'italic',
  },
  // Dialog Backdrops
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 6,
  },
  dialogTitleDestructive: {
    fontSize: 18,
    fontWeight: '800',
    color: '#EF4444',
    marginBottom: 6,
  },
  dialogSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 14,
  },
  dialogTextInput: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#F8FAFC',
    padding: 12,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  dialogCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#475569',
    minHeight: 48,
    justifyContent: 'center',
  },
  dialogCancelBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  dialogSubmitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    minHeight: 48,
    justifyContent: 'center',
  },
  dialogSubmitBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
