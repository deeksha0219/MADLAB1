import React, { useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import firestore from "@react-native-firebase/firestore";
import Feather from "react-native-vector-icons/Feather";

type OrderItem = {
  id: string;
  orderId: string;
  referenceId: string;
  customerName: string;
  pickupTime: string;
  items: string[];
  payment: string;
  total: number;
  status: string;
  placedAt: number;
  redeemed?: boolean;
  redeemedAt?: number | null;
};

export default function AdminDashboardScreen({ setRole }: any) {
  const [activeSection, setActiveSection] = useState<"dashboard" | "verify">("dashboard");

  // ---- DASHBOARD STATE ----
  const [todayOrders, setTodayOrders] = useState<OrderItem[]>([]);

  // ---- BILL VERIFICATION STATE ----
  const [searchId, setSearchId] = useState("");

  const [foundOrder, setFoundOrder] = useState<OrderItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

  // Live listener — today's orders (used by both Dashboard stats & Bill lookup fallback)
  useEffect(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const unsubscribe = firestore()
      .collection("orders")
      .where("placedAt", ">=", startOfToday.getTime())
      .onSnapshot(snap => {
        const data = snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as OrderItem[];
        data.sort((a, b) => b.placedAt - a.placedAt);
        setTodayOrders(data);
      }, error => {
        console.log("Listener error:", error);
      });

    return () => unsubscribe();
  }, []);

  // ---- STATS ----
  const totalOrdersToday = todayOrders.length;
  const totalRevenueToday = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const completedOrdersToday = todayOrders.filter(o => o.status === "completed" || o.redeemed).length;


  const getStatusColor = (status: string, redeemed?: boolean) => {
    if (redeemed) return "#9E9E9E";
    switch (status) {
      case "new": return "#2196F3";
      case "preparing": return "#FF9800";
      case "ready": return "#4CAF50";
      case "completed": return "#9E9E9E";
      default: return "#000";
    }
  };

  // ---- SEARCH (Bill Verification) ----
  const handleSearch = () => {
    if (!searchId.trim()) {
      Alert.alert("Error", "Enter an Order ID or Bill Number!");
      return;
    }

    setLoading(true);
    setNotFound(false);
    setFoundOrder(null);

    const query = searchId.trim().toUpperCase();

    const match = todayOrders.find(
      order => order.orderId === query || order.referenceId === query
    );

    if (match) {
      setFoundOrder(match);
      setLoading(false);
    } else {

      firestore()
        .collection("orders")
        .where("orderId", "==", query)
        .get()
        .then(snap => {
          if (!snap.empty) {
            const doc = snap.docs[0];
            setFoundOrder({ id: doc.id, ...doc.data() } as OrderItem);
          } else {
            setNotFound(true);
          }
        })
        .catch(err => {
          console.log("Search error:", err);
          Alert.alert("Error", "Search failed. Check connection.");
        })
        .finally(() => setLoading(false));
    }
  };

  const openOrderInVerify = (order: OrderItem) => {
    setFoundOrder(order);
    setSearchId(order.orderId);
    setNotFound(false);
    setActiveSection("verify");
  };

  // ---- REDEEM (equivalent to "Generate / Print Bill") ----
  const handleRedeem = async () => {
    if (!foundOrder || foundOrder.redeemed || redeeming) return;

    setRedeeming(true);

    try {
      await firestore().collection("orders").doc(foundOrder.id).update({
        redeemed: true,
        redeemedAt: Date.now(),
        status: "completed",
      });

      setFoundOrder({
        ...foundOrder,
        redeemed: true,
        redeemedAt: Date.now(),
        status: "completed",
      });
    } catch (err) {
      console.log("Redeem error:", err);
      Alert.alert("Error", "Could not mark order as redeemed. Try again.");
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f2f2f2" }}>

      {/* HEADER */}
      <View style={{
        backgroundColor: "#E6330A",
        padding: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between"
      }}>

        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>
          📊 Admin Dashboard
        </Text>
        <TouchableOpacity onPress={() => setRole(null)}>
          <Text style={{ color: "#fff", fontSize: 14 }}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* SECTION TABS */}
      <View style={{ flexDirection: "row", backgroundColor: "#fff", elevation: 2 }}>
        <TouchableOpacity
          onPress={() => setActiveSection("dashboard")}
          style={{
            flex: 1, paddingVertical: 14, alignItems: "center",
            borderBottomWidth: 3,
            borderBottomColor: activeSection === "dashboard" ? "#E6330A" : "transparent",
          }}
        >
          <Text style={{
            fontWeight: "bold",
            color: activeSection === "dashboard" ? "#E6330A" : "#888",
          }}>
            Dashboard
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveSection("verify")}
          style={{
            flex: 1, paddingVertical: 14, alignItems: "center",
            borderBottomWidth: 3,
            borderBottomColor: activeSection === "verify" ? "#E6330A" : "transparent",
          }}

        >
          <Text style={{
            fontWeight: "bold",
            color: activeSection === "verify" ? "#E6330A" : "#888",
          }}>
            Bill Verification
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>

        {/* ================= DASHBOARD ================= */}
        {activeSection === "dashboard" && (
          <>
            {/* STAT CARDS */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
              <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14, elevation: 2 }}>
                <Feather name="shopping-bag" size={20} color="#E6330A" />
                <Text style={{ fontSize: 20, fontWeight: "bold", marginTop: 6 }}>{totalOrdersToday}</Text>
                <Text style={{ color: "gray", fontSize: 11 }}>Total Orders Today</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14, elevation: 2 }}>
                <Feather name="dollar-sign" size={20} color="#4CAF50" />
                <Text style={{ fontSize: 20, fontWeight: "bold", marginTop: 6 }}>₹{totalRevenueToday}</Text>
                <Text style={{ color: "gray", fontSize: 11 }}>Revenue Today</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14, elevation: 2 }}>
                <Feather name="check-circle" size={20} color="#9C27B0" />
                <Text style={{ fontSize: 20, fontWeight: "bold", marginTop: 6 }}>{completedOrdersToday}</Text>
                <Text style={{ color: "gray", fontSize: 11 }}>Completed Today</Text>
              </View>

            </View>

            {/* TODAY'S ORDERS */}
            <Text style={{ fontWeight: "bold", fontSize: 16, marginBottom: 10 }}>
              📋 Today's Orders
            </Text>

            {todayOrders.length === 0 && (
              <Text style={{ color: "gray", textAlign: "center", marginTop: 20 }}>
                No orders placed today yet
              </Text>
            )}

            {todayOrders.map(order => (
              <TouchableOpacity
                key={order.id}
                onPress={() => openOrderInVerify(order)}
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 10,
                  elevation: 1,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ fontWeight: "bold" }}>{order.orderId}</Text>
                  <View style={{
                    backgroundColor: getStatusColor(order.status, order.redeemed),
                    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
                  }}>
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "bold" }}>

                      {order.redeemed ? "REDEEMED" : order.status?.toUpperCase()}
                    </Text>
                  </View>
                </View>

                <Text style={{ color: "gray", fontSize: 12 }}>Bill No: {order.referenceId}</Text>
                <Text style={{ fontSize: 13, marginTop: 2 }}>{order.customerName}</Text>
                <Text style={{ color: "gray", fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {order.items?.join(", ")}
                </Text>

                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                  <Text style={{ fontWeight: "bold", color: "#E6330A" }}>₹{order.total}</Text>
                  <View style={{
                    backgroundColor: "#e8f5e9",
                    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
                  }}>
                    <Text style={{ color: "#2e7d32", fontSize: 11, fontWeight: "bold" }}>
                      {order.payment}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ================= BILL VERIFICATION ================= */}
        {activeSection === "verify" && (
          <>
            {/* SEARCH BOX */}
            <View style={{

              backgroundColor: "#fff",
              borderRadius: 12,
              padding: 16,
              elevation: 2,
              marginBottom: 16,
            }}>
              <Text style={{ fontWeight: "bold", fontSize: 15, marginBottom: 10 }}>
                🔍 Enter Bill / Order Number
              </Text>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <TextInput
                  placeholder="e.g. GNG-XXXXXXXX or REF-XXXXXX"
                  placeholderTextColor="#999"
                  style={{
                    flex: 1, borderWidth: 1, borderColor: "#ddd",
                    borderRadius: 8, padding: 10, fontSize: 14,
                  }}
                  value={searchId}
                  onChangeText={text => {
                    setSearchId(text);
                    setFoundOrder(null);
                    setNotFound(false);
                  }}
                  autoCapitalize="characters"
                />
                <TouchableOpacity
                  onPress={handleSearch}
                  disabled={loading}
                  style={{
                    backgroundColor: "#E6330A", borderRadius: 8,
                    paddingHorizontal: 16, justifyContent: "center",

                  }}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: "#fff", fontWeight: "bold" }}>Search</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>

            {/* NOT FOUND */}
            {notFound && (
              <View style={{
                backgroundColor: "#fff", borderRadius: 12, padding: 20,
                alignItems: "center", elevation: 2, marginBottom: 16,
              }}>
                <Text style={{ fontSize: 32 }}>❌</Text>
                <Text style={{ fontWeight: "bold", marginTop: 8 }}>Order Not Found</Text>
                <Text style={{ color: "gray", marginTop: 4 }}>Check the number and try again</Text>
              </View>
            )}

            {/* BILL CARD */}
            {foundOrder && (
              <View style={{
                backgroundColor: "#fff", borderRadius: 12, padding: 16,
                elevation: 3, marginBottom: 16,
              }}>
                <View style={{
                  flexDirection: "row", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 12,
                }}>

                  <Text style={{ fontWeight: "bold", fontSize: 16 }}>🧾 Bill Details</Text>
                  <View style={{
                    backgroundColor: foundOrder.redeemed ? "#4CAF50" : "#FF9800",
                    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
                  }}>
                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>
                      {foundOrder.redeemed ? "PAYMENT DONE" : "PENDING"}
                    </Text>
                  </View>
                </View>

                {foundOrder.redeemed && (
                  <View style={{ backgroundColor: "#e8f5e9", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    <Text style={{ color: "#2e7d32", fontWeight: "bold", fontSize: 13 }}>
                      ✅ This bill is paid successfully
                    </Text>
                    {foundOrder.redeemedAt && (
                      <Text style={{ color: "#2e7d32", fontSize: 12, marginTop: 2 }}>
                        Redeemed at: {new Date(foundOrder.redeemedAt).toLocaleString()}
                      </Text>
                    )}
                  </View>
                )}

                <View style={{ borderTopWidth: 1, borderColor: "#eee", marginBottom: 12 }} />

                {[
                  ["Bill No.", foundOrder.referenceId],
                  ["Order ID", foundOrder.orderId],
                  ["Customer", foundOrder.customerName],
                  ["Pickup Time", `⏰ ${foundOrder.pickupTime}`],
                  ["Payment Method", foundOrder.payment],

                ].map(([label, value]) => (
                  <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={{ color: "gray" }}>{label}</Text>
                    <Text style={{ fontWeight: "bold" }}>{value}</Text>
                  </View>
                ))}

                <View style={{ borderTopWidth: 1, borderColor: "#eee", marginVertical: 12 }} />

                <Text style={{ fontWeight: "bold", marginBottom: 8 }}>Items Ordered:</Text>
                {foundOrder.items.map((item, index) => (
                  <View key={index} style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text style={{ color: "#E6330A", marginRight: 6 }}>•</Text>
                    <Text>{item}</Text>
                  </View>
                ))}

                <View style={{ borderTopWidth: 1, borderColor: "#eee", marginVertical: 12 }} />

                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 16 }}>
                  <Text style={{ fontSize: 16, fontWeight: "bold" }}>Total Amount</Text>
                  <Text style={{ fontSize: 18, fontWeight: "bold", color: "#E6330A" }}>
                    ₹{foundOrder.total}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={handleRedeem}
                  disabled={foundOrder.redeemed || redeeming}
                  style={{
                    backgroundColor: foundOrder.redeemed ? "#ccc" : "#4CAF50",
                    borderRadius: 10, padding: 14, alignItems: "center",

                  }}
                >
                  {redeeming ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 15 }}>
                      {foundOrder.redeemed ? "Already Redeemed" : "✅ Confirm & Redeem Bill"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}