import React, { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, FlatList, SafeAreaView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { orderHistoryStyles as styles } from "../styles/Studentstyles";
import firestore from "@react-native-firebase/firestore";

const foodImages: any = {
  "Peri Peri Fries": require("../../assets/peri_peri_fries.png"),
  "Lime Soda": require("../../assets/lime.png"),
  "Sandwich": require("../../assets/sandwich.png"),
  "Masala Dosa": require("../../assets/masala_dosa.png"),
  "Gobi Noodles": require("../../assets/gobi.png"),
  "Hyderabadi Chicken Biryani": require("../../assets/chicken_biryani.png"),
  "Chicken Popcorn": require("../../assets/chicken_popcorn.png"),
  "Chicken Manchurian": require("../../assets/chicken_manchurian.png"),
  "Potato Bites": require("../../assets/potato_bites.png"),
  "Boiled Egg": require("../../assets/eggs.png"),
  "Coffee": require("../../assets/coffee.png"),
  "Tea": require("../../assets/tea.png"),
  "Lassi": require("../../assets/lassi.png"),
  "Omelette": require("../../assets/Omelette.png"),
  "Pav Bhaji": require("../../assets/pav_bhaaji.png"),
  "Vada": require("../../assets/Vada.png"),
  "Poori Saagu": require("../../assets/Poori_saagu.png"),
  "Akki Roti": require("../../assets/Akki_rotti.png"),
  "Ragi Roti": require("../../assets/Ragi_rotti.png"),
  "Aloo Bonda": require("../../assets/Aloo_bonda.png"),
  "Chole Bhature": require("../../assets/chole_bhature.png"),
  "Gulab Jamun": require("../../assets/gulab_jamun.png"),
  "Fruit Custard": require("../../assets/fruit_custard.png"),
  "Carrot Halwa": require("../../assets/carrot_halwa.png"),
  "Brownie Sundae": require("../../assets/brownie.png"),
  "Kesar Badam Milkshake": require("../../assets/badam_milk.png"),
  "Butterscotch Milkshake": require("../../assets/butterscotch.png"),
  "Chocolate Milk": require("../../assets/choco_milk.png"),
  "Veg Manchurian": require("../../assets/Veg_manchurian.png"),
  "Chilly 65": require("../../assets/chilly_65.png"),
  "Honey Chilly Potato": require("../../assets/honey_chilli.png"),
  "Veg Puff": require("../../assets/veg_puff.png"),
  "Paneer Puff": require("../../assets/paneer_puff.png"),
  "Egg Puff": require("../../assets/egg_puff.png"),
  "Veg Burger": require("../../assets/veg_burger.png"),
  "Chicken Burger": require("../../assets/chicken_burger.png"),
  "Samosa": require("../../assets/Samosa.png"),
  "Idly": require("../../assets/Idly.png"),
  "Rice Bath": require("../../assets/veg_biryani.png"),
  "Set Dosa": require("../../assets/set_dosa.png"),
  "Mysore Masala Dosa": require("../../assets/mysore.png"),
  "Open Butter Dosa": require("../../assets/open_butter.png"),
  "Plain Dosa": require("../../assets/plain_dosa.png"),
  "Paneer Curry Paratha": require("../../assets/paneer_curry.png"),
  "Brownie": require("../../assets/brownie.png"),
  "Choco Pastry": require("../../assets/choco_pastry.png"),
  "Black Forest": require("../../assets/black_forest.png"),
  "Gobi Manchurian": require("../../assets/gobi_manchuri.png"),
  "All Fried Rice": require("../../assets/chinese.png"),
  "Gobi Rice": require("../../assets/chinese.png"),
};

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  orderId: string;
  referenceId: string;
  canteenId: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  pickupSlot?: {
    slotId: string;
    pickupDate: string;
    pickupStartTime: string;
    pickupEndTime: string;
    timezone: string;
  };
  items: OrderItem[];
  total: number;
  placedAt: any;
}

const formatDate = (val: any): string => {
  if (typeof val === "number" && !isNaN(val)) return new Date(val).toLocaleString();
  if (typeof val?.toDate === "function") return val.toDate().toLocaleString();
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? "Old Order" : d.toLocaleString();
  }
  return "Old Order";
};

import auth from "@react-native-firebase/auth";
import { Alert } from "react-native";
import { setUserCartItem, transitionOrderStatusCallable } from "../services/orderService";

const getStatusColor = (status: string) => {
  switch (status) {
    case "placed":
      return { bg: "#FEF3C7", text: "#92400E" }; // Amber
    case "payment_verified":
      return { bg: "#DBEAFE", text: "#1E40AF" }; // Blue
    case "accepted":
      return { bg: "#E0E7FF", text: "#3730A3" }; // Indigo
    case "preparing":
      return { bg: "#FED7AA", text: "#9A3412" }; // Orange
    case "ready_for_pickup":
      return { bg: "#D1FAE5", text: "#065F46" }; // Emerald
    case "completed":
      return { bg: "#E2E8F0", text: "#334155" }; // Slate
    case "cancelled":
    case "rejected":
      return { bg: "#FEE2E2", text: "#991B1B" }; // Red
    default:
      return { bg: "#F3F4F6", text: "#374151" };
  }
};

export default function OrderHistoryScreen() {
  const navigation = useNavigation<any>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const currentUid = auth().currentUser?.uid;

  useEffect(() => {
    if (!currentUid) {
      setOrders([]);
      return;
    }
    const unsubscribe = firestore()
      .collection("orders")
      .where("studentUid", "==", currentUid)
      .orderBy("createdAt", "desc")
      .onSnapshot(
        (snap) => {
          if (!snap) return;
          const data = snap.docs.map((doc) => {
            const d = doc.data();
            return {
              id: doc.id,
              orderId: d.orderId || doc.id,
              referenceId: d.orderId || doc.id,
              canteenId: d.canteenId || "",
              status: d.status || "placed",
              paymentStatus: d.paymentStatus || "pending",
              paymentMethod: d.paymentMethod || "cash",
              pickupSlot: d.pickupSlot,
              items: (d.itemsSnapshot || []).map((item: any) => ({
                id: item.itemId,
                name: item.itemName,
                price: Math.floor((item.unitPriceInPaise || 0) / 100),
                quantity: item.quantity,
              })),
              total: Math.floor((d.totalInPaise || 0) / 100),
              placedAt: d.createdAt,
            };
          }) as Order[];

          setOrders(data);
        },
        (err) => {
          console.log("Order history error:", err);
        },
      );
    return () => unsubscribe();
  }, [currentUid]);

  const handleCancelOrder = async (orderId: string) => {
    Alert.alert(
      "Cancel Order",
      "Are you sure you want to cancel this order? Your reserved pickup slot will be released.",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: async () => {
            setCancellingId(orderId);
            try {
              await transitionOrderStatusCallable({
                orderId,
                nextStatus: "cancelled",
                reason: "Cancelled by student from order history",
              });
              Alert.alert("Order Cancelled", "Your order has been cancelled successfully.");
            } catch (err: any) {
              Alert.alert("Cancellation Failed", err.message || "Failed to cancel order.");
            } finally {
              setCancellingId(null);
            }
          },
        },
      ],
    );
  };

  const renderOrder = ({ item }: { item: Order }) => {
    const statusTheme = getStatusColor(item.status);
    const canCancel = item.status === "placed" && item.paymentStatus === "pending";

    return (
      <View style={styles.orderCard}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={styles.orderDate}>🕐 {formatDate(item.placedAt)}</Text>
          <View
            style={{
              backgroundColor: statusTheme.bg,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: statusTheme.text, fontWeight: "bold", fontSize: 11 }}>
              {item.status.toUpperCase().replace(/_/g, " ")}
            </Text>
          </View>
        </View>

        {/* Order ID / Reference ID */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: "gray" }}>
            Order ID: <Text style={{ fontWeight: "bold", color: "#333" }}>{item.orderId || "—"}</Text>
          </Text>
          <Text style={{ fontSize: 12, color: "gray" }}>
            Ref: <Text style={{ fontWeight: "bold", color: "#333" }}>{item.referenceId || "—"}</Text>
          </Text>
        </View>

        {/* Pickup slot detail */}
        {item.pickupSlot && (
          <View
            style={{
              backgroundColor: "#F8FAFC",
              padding: 8,
              borderRadius: 6,
              marginBottom: 10,
              borderWidth: 1,
              borderColor: "#E2E8F0",
            }}
          >
            <Text style={{ fontSize: 12, color: "#475569" }}>
              📍 Pickup: <Text style={{ fontWeight: "600" }}>{item.pickupSlot.pickupDate}</Text> (
              {item.pickupSlot.pickupStartTime} - {item.pickupSlot.pickupEndTime} IST)
            </Text>
          </View>
        )}

        {item.items.map((food, index) => (
          <View key={index} style={styles.itemRow}>
            <Image
              source={foodImages[food.name] || require("../../assets/snacks.png")}
              style={styles.itemImage}
            />
            <View style={styles.itemDetails}>
              <View style={styles.itemNameRow}>
                <Text style={styles.itemName}>
                  {food.name} ({food.quantity})
                </Text>
                <Text style={styles.itemPrice}>₹{food.price * food.quantity}</Text>
              </View>
            </View>
          </View>
        ))}

        <View style={styles.bottomRow}>
          <Text style={styles.totalText}>Total: ₹{item.total}</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {canCancel && (
              <TouchableOpacity
                style={{
                  backgroundColor: "#FEE2E2",
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                disabled={cancellingId === item.orderId}
                onPress={() => handleCancelOrder(item.orderId)}
              >
                <Text style={{ color: "#DC2626", fontWeight: "bold", fontSize: 12 }}>
                  {cancellingId === item.orderId ? "Cancelling..." : "Cancel"}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.reorderBtn}
              onPress={async () => {
                if (!currentUid) return;
                try {
                  for (const food of item.items) {
                    await setUserCartItem(currentUid, {
                      itemId: food.id,
                      canteenId: item.canteenId || "CANTEEN_TEST_7",
                      quantity: food.quantity,
                    });
                  }
                  navigation.navigate("Cart");
                } catch (err: any) {
                  Alert.alert("Reorder Failed", err.message || "Failed to add items to cart.");
                }
              }}
            >
              <Text style={styles.reorderIcon}>↻</Text>
              <Text style={styles.reorderText}>Reorder</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order History</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={{ padding: 15 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No orders yet! 🍽️</Text>}
      />
    </SafeAreaView>
  );
}