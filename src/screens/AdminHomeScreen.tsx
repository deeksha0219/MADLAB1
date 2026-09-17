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

type NavKey = "dashboard" | "verify" | "orders" | "menu";

export default function AdminHomeScreen({ setRole }: any) {
  const [activeNav, setActiveNav] = useState<NavKey>("dashboard");

  // ---------- SHARED: TODAY'S ORDERS (live) ----------
  const [todayOrders, setTodayOrders] = useState<OrderItem[]>([]);

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

  const getStatusColor = (status: string, redeemed?: boolean) => {
    if (redeemed) return "#9E9E9E";
    switch (status) {
      case "new": return "#2196F3";
      case "preparing": return "#FF9800";
      case "ready": return "#4CAF50";
      case "completed": return "#9E9E9E";
      case "rejected": return "#c0392b";
      default: return "#000";
    }
  };

  // ---------- DASHBOARD STATS ----------
  const totalOrdersToday = todayOrders.length;
  const totalRevenueToday = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const completedOrdersToday = todayOrders.filter(o => o.status === "completed" || o.redeemed).length;
  const avgOrderValue = totalOrdersToday > 0 ? Math.round(totalRevenueToday / totalOrdersToday) : 0;

  // ---------- BILL VERIFICATION ----------
  const [searchId, setSearchId] = useState("");
  const [foundOrder, setFoundOrder] = useState<OrderItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

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
    setActiveNav("verify");
  };

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

  // ---------- ORDERS TAB (accept/reject/prep flow) ----------
  const [orderStatusTab, setOrderStatusTab] = useState("new");

  const updateStatus = async (docId: string, newStatus: string) => {
    try {
      await firestore().collection("orders").doc(docId).update({ status: newStatus });
    } catch (error) {
      console.log("Update error:", error);
    }
  };

  const filteredStatusOrders = todayOrders.filter(o => o.status === orderStatusTab);

  // ---------- MENU ITEMS TAB ----------
  const [menuItems, setMenuItems] = useState<any[]>([]);

  useEffect(() => {
    const unsubscribe = firestore()
      .collection("menu")
      .onSnapshot(
        snap => {
          const data = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
          }));
          setMenuItems(data);
        },
        error => console.log("MENU ERROR:", error)
      );
    return () => unsubscribe();
  }, []);

  const toggleAvailability = async (docId: string, current: boolean) => {
    await firestore().collection("menu").doc(docId).update({
      available: !current,
    });
  };

  const renderMenuItem = (item: any) => (
    <View key={item.id} style={{
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: "#fff",
      padding: 14,
      borderRadius: 10,
      marginBottom: 8,
      elevation: 1,
    }}>
      <View>
        <Text style={{ fontWeight: "bold", fontSize: 14 }}>{item.name}</Text>
        <Text style={{ color: "gray", fontSize: 12 }}>{item.category} • ₹{item.price}</Text>
      </View>
      <TouchableOpacity
        onPress={() => toggleAvailability(item.id, item.available)}
        style={{
          backgroundColor: item.available ? "#4CAF50" : "#ccc",
          paddingVertical: 6,
          paddingHorizontal: 14,
          borderRadius: 20,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 12 }}>
          {item.available ? "Available" : "Unavailable"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // ---------- NAV ITEMS (mirrors sidebar in screenshot) ----------
  const navItems: { key: NavKey; label: string; icon: string }[] = [
    { key: "dashboard", label: "Dashboard", icon: "grid" },
    { key: "verify", label: "Bill Verify", icon: "check-square" },
    { key: "orders", label: "Orders", icon: "clipboard" },
    { key: "menu", label: "Menu", icon: "coffee" },
  ];

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
        <View>
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>
            GrabNGo Admin
          </Text>
          <Text style={{ color: "#ffe5de", fontSize: 12 }}>
            {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric", weekday: "long" })}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setRole(null)}>
          <Text style={{ color: "#fff", fontSize: 14 }}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* NAV TABS (sidebar equivalent) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ backgroundColor: "#fff", elevation: 2 }}
        contentContainerStyle={{ paddingHorizontal: 8 }}
      >
        {navItems.map(nav => (
          <TouchableOpacity
            key={nav.key}
            onPress={() => setActiveNav(nav.key)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderBottomWidth: 3,
              borderBottomColor: activeNav === nav.key ? "#E6330A" : "transparent",
              gap: 6,
            }}
          >
            <Feather
              name={nav.icon}
              size={16}
              color={activeNav === nav.key ? "#E6330A" : "#888"}
            />
            <Text style={{
              fontWeight: "bold",
              fontSize: 13,
              color: activeNav === nav.key ? "#E6330A" : "#888",
            }}>
              {nav.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16 }}>

        {/* ================= DASHBOARD ================= */}
        {activeNav === "dashboard" && (
          <>
            <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 4 }}>Dashboard</Text>
            <Text style={{ color: "gray", marginBottom: 16 }}>Welcome back, Admin 👋</Text>

            {/* STAT CARDS */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
              <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14, elevation: 2 }}>
                <View style={{ backgroundColor: "#ffe5de", padding: 8, borderRadius: 8, alignSelf: "flex-start" }}>
                  <Feather name="shopping-bag" size={18} color="#E6330A" />
                </View>
                <Text style={{ fontSize: 20, fontWeight: "bold", marginTop: 8 }}>{totalOrdersToday}</Text>
                <Text style={{ color: "gray", fontSize: 11 }}>Total Orders Today</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14, elevation: 2 }}>
                <View style={{ backgroundColor: "#e8f5e9", padding: 8, borderRadius: 8, alignSelf: "flex-start" }}>
                  <Feather name="dollar-sign" size={18} color="#4CAF50" />
                </View>
                <Text style={{ fontSize: 20, fontWeight: "bold", marginTop: 8 }}>₹{totalRevenueToday}</Text>
                <Text style={{ color: "gray", fontSize: 11 }}>Total Revenue Today</Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
              <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14, elevation: 2 }}>
                <View style={{ backgroundColor: "#f3e5f5", padding: 8, borderRadius: 8, alignSelf: "flex-start" }}>
                  <Feather name="check-circle" size={18} color="#9C27B0" />
                </View>
                <Text style={{ fontSize: 20, fontWeight: "bold", marginTop: 8 }}>{completedOrdersToday}</Text>
                <Text style={{ color: "gray", fontSize: 11 }}>Completed Orders</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14, elevation: 2 }}>
                <View style={{ backgroundColor: "#e3f2fd", padding: 8, borderRadius: 8, alignSelf: "flex-start" }}>
                  <Feather name="trending-up" size={18} color="#2196F3" />
                </View>
                <Text style={{ fontSize: 20, fontWeight: "bold", marginTop: 8 }}>₹{avgOrderValue}</Text>
                <Text style={{ color: "gray", fontSize: 11 }}>Average Order Value</Text>
              </View>
            </View>

            {/* TODAY'S ORDERS TABLE */}
            <Text style={{ fontWeight: "bold", fontSize: 16, marginBottom: 10 }}>
              Today's Orders
            </Text>

            {todayOrders.length === 0 && (
              <Text style={{ color: "gray", textAlign: "center", marginTop: 20 }}>
                No orders placed today yet
              </Text>
            )}

            {todayOrders.slice(0, 8).map(order => (
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

            {todayOrders.length > 8 && (
              <TouchableOpacity onPress={() => setActiveNav("orders")} style={{ marginTop: 4 }}>
                <Text style={{ color: "#E6330A", fontWeight: "bold" }}>View All Orders →</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ================= BILL VERIFICATION ================= */}
        {activeNav === "verify" && (
          <>
            <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>Bill Verification</Text>

            {/* SEARCH BOX */}
            <View style={{
              backgroundColor: "#fff",
              borderRadius: 12,
              padding: 16,
              elevation: 2,
              marginBottom: 16,
            }}>
              <Text style={{ fontWeight: "bold", fontSize: 15, marginBottom: 10 }}>
                Enter Bill Number
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
                    flexDirection: "row", alignItems: "center", gap: 6,
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="search" size={16} color="#fff" />
                      <Text style={{ color: "#fff", fontWeight: "bold" }}>Search</Text>
                    </>
                  )}
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

            {/* PAYMENT STATUS BANNER */}
            {foundOrder && foundOrder.redeemed && (
              <View style={{
                backgroundColor: "#e8f5e9",
                borderRadius: 12,
                padding: 14,
                marginBottom: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}>
                <Feather name="check-circle" size={22} color="#2e7d32" />
                <View>
                  <Text style={{ color: "#2e7d32", fontWeight: "bold", fontSize: 14 }}>
                    Payment Done
                  </Text>
                  <Text style={{ color: "#2e7d32", fontSize: 12 }}>
                    This bill is paid successfully.
                  </Text>
                </View>
              </View>
            )}

            {/* BILL CARD */}
            {foundOrder && (
              <View style={{
                backgroundColor: "#fff", borderRadius: 12, padding: 16,
                elevation: 3, marginBottom: 16,
              }}>
                <Text style={{ fontWeight: "bold", fontSize: 15, color: "#E6330A", marginBottom: 10 }}>
                  BILL DETAILS
                </Text>

                {[
                  ["Bill No.", foundOrder.referenceId],
                  ["Order ID", foundOrder.orderId],
                  ["Customer", foundOrder.customerName],
                  ["Pickup Time", `⏰ ${foundOrder.pickupTime}`],
                  ["Payment Method", foundOrder.payment],
                ].map(([label, value]) => (
                  <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                    <Text style={{ color: "gray" }}>{label}</Text>
                    <Text style={{ fontWeight: "bold" }}>{value}</Text>
                  </View>
                ))}

                <View style={{ borderTopWidth: 1, borderColor: "#eee", marginVertical: 12 }} />

                <Text style={{ fontWeight: "bold", fontSize: 15, color: "#E6330A", marginBottom: 10 }}>
                  ITEMS ORDERED
                </Text>

                {foundOrder.items.map((item, index) => (
                  <View key={index} style={{
                    flexDirection: "row", justifyContent: "space-between", marginBottom: 6,
                  }}>
                    <Text>• {item}</Text>
                  </View>
                ))}

                <View style={{ borderTopWidth: 1, borderColor: "#eee", marginVertical: 12 }} />

                <View style={{
                  backgroundColor: "#fff3e0",
                  borderRadius: 8,
                  padding: 12,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}>
                  <Text style={{ fontWeight: "bold", color: "#E6330A" }}>TOTAL AMOUNT</Text>
                  <Text style={{ fontSize: 18, fontWeight: "bold", color: "#E6330A" }}>
                    ₹{foundOrder.total}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 16 }}>
                  <Text style={{ fontWeight: "bold" }}>PAYMENT STATUS</Text>
                  <View style={{
                    backgroundColor: foundOrder.redeemed ? "#4CAF50" : "#FF9800",
                    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12,
                  }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "bold" }}>
                      {foundOrder.redeemed ? "PAID" : "PENDING"}
                    </Text>
                  </View>
                </View>

                {foundOrder.redeemed && foundOrder.redeemedAt && (
                  <Text style={{ color: "gray", fontSize: 11, marginBottom: 12 }}>
                    Redeemed at: {new Date(foundOrder.redeemedAt).toLocaleString()}
                  </Text>
                )}

                <TouchableOpacity
                  onPress={handleRedeem}
                  disabled={foundOrder.redeemed || redeeming}
                  style={{
                    backgroundColor: foundOrder.redeemed ? "#ccc" : "#E6330A",
                    borderRadius: 10, padding: 14, alignItems: "center",
                    flexDirection: "row", justifyContent: "center", gap: 8,
                    marginBottom: 10,
                  }}
                >
                  {redeeming ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="printer" size={16} color="#fff" />
                      <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 15 }}>
                        {foundOrder.redeemed ? "Already Redeemed" : "Generate / Print Bill"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* ================= ORDERS (accept/reject/prep flow) ================= */}
        {activeNav === "orders" && (
          <>
            <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 12 }}>Orders</Text>

            {/* STATUS SUB-TABS */}
            <View style={{ flexDirection: "row", marginBottom: 16, gap: 8 }}>
              {["new", "preparing", "ready", "completed"].map(tab => (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setOrderStatusTab(tab)}
                  style={{
                    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20,
                    backgroundColor: orderStatusTab === tab ? "#E6330A" : "#fff",
                  }}
                >
                  <Text style={{
                    color: orderStatusTab === tab ? "#fff" : "#888",
                    fontWeight: "bold", fontSize: 12, textTransform: "capitalize",
                  }}>
                    {tab}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {filteredStatusOrders.length === 0 && (
              <Text style={{ textAlign: "center", marginTop: 30, color: "#888" }}>
                No {orderStatusTab} orders
              </Text>
            )}

            {filteredStatusOrders.map(order => (
              <View key={order.id} style={{
                backgroundColor: "#fff", borderRadius: 12, padding: 14,
                marginBottom: 10, elevation: 1,
              }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontWeight: "bold" }}>Order #{order.orderId}</Text>
                  <Text style={{ color: getStatusColor(order.status), fontWeight: "bold", fontSize: 12 }}>
                    {order.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={{ marginTop: 4 }}>{order.customerName}</Text>
                <Text style={{ color: "gray", fontSize: 12 }}>Pickup: {order.pickupTime}</Text>
                {order.items.map((item, i) => (
                  <Text key={i} style={{ fontSize: 13, color: "#555" }}>{item}</Text>
                ))}
                <Text style={{ color: "gray", fontSize: 12, marginTop: 4 }}>Payment: {order.payment}</Text>
                <Text style={{ fontWeight: "bold", marginTop: 4 }}>Total: ₹{order.total}</Text>

                {order.status === "new" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <TouchableOpacity
                      onPress={() => updateStatus(order.id, "preparing")}
                      style={{ flex: 1, backgroundColor: "#4CAF50", padding: 10, borderRadius: 8, alignItems: "center" }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "bold" }}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => updateStatus(order.id, "rejected")}
                      style={{ flex: 1, backgroundColor: "#c0392b", padding: 10, borderRadius: 8, alignItems: "center" }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "bold" }}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {order.status === "preparing" && (
                  <TouchableOpacity
                    onPress={() => updateStatus(order.id, "ready")}
                    style={{ backgroundColor: "#FF9800", padding: 10, borderRadius: 8, alignItems: "center", marginTop: 10 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "bold" }}>Mark as Ready</Text>
                  </TouchableOpacity>
                )}

                {order.status === "ready" && (
                  <TouchableOpacity
                    onPress={() => updateStatus(order.id, "completed")}
                    style={{ backgroundColor: "#2196F3", padding: 10, borderRadius: 8, alignItems: "center", marginTop: 10 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "bold" }}>Mark as Completed</Text>
                  </TouchableOpacity>
                )}

                {order.status === "completed" && (
                  <View style={{ backgroundColor: "#eee", padding: 8, borderRadius: 8, alignItems: "center", marginTop: 10 }}>
                    <Text style={{ color: "#666", fontWeight: "bold" }}>✅ Completed</Text>
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {/* ================= MENU ITEMS ================= */}
        {activeNav === "menu" && (
          <>
            <Text style={{ fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>Menu Items</Text>

            <Text style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8, color: "#E6330A" }}>
              🍽️ BIG MINGOS
            </Text>
            {menuItems.filter(item => !item.canteen).map(renderMenuItem)}

            <Text style={{ fontSize: 15, fontWeight: "bold", marginTop: 15, marginBottom: 8, color: "#E6330A" }}>
              🏢 M.M Foods (Admin Block)
            </Text>
            {menuItems.filter(item => item.canteen === "MM_ADMIN_BLOCK").map(renderMenuItem)}

            <Text style={{ fontSize: 15, fontWeight: "bold", marginTop: 15, marginBottom: 8, color: "#E6330A" }}>
              📚 M.M Foods (Library)
            </Text>
            {menuItems.filter(item => item.canteen === "MM_LIBRARY").map(renderMenuItem)}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}