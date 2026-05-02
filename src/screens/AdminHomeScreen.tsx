import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import React, { useState, useEffect } from "react";
import { Homestyles } from "../styles/Adminstyles";
import firestore from "@react-native-firebase/firestore";

type OrderItem = {
  id: string;
  orderId: string;
  customerName: string;
  pickupTime: string;
  items: string[];
  payment: string;
  total: number;
  status: string;
};

export default function AdminHomeScreen({ navigation, setRole }: any) {
  const [activeTab, setActiveTab] = useState("new");
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuItems, setMenuItems] = useState<any[]>([]);

  const handleBack = () => {
    setRole(null);
  };

  const updateStatus = async (docId: string, newStatus: string) => {
    try {
      await firestore().collection("orders").doc(docId).update({ status: newStatus });
    } catch (error) {
      console.log("Update error:", error);
    }
  };

  const toggleAvailability = async (docId: string, current: boolean) => {
    await firestore().collection("menu").doc(docId).update({
      available: !current,
    });
  };



  // FETCH ORDERS
  useEffect(() => {
    if (activeTab === "menu") return;
    setLoading(true);
    const unsubscribe = firestore()
      .collection("orders")
      .where("status", "==", activeTab)
      .onSnapshot(
        (snap) => {
          const data = snap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as OrderItem[];
          setOrders(data);
          setLoading(false);
        },
        (error) => {
          console.log("Firestore error:", error);
          setLoading(false);
        }
      );
    return () => unsubscribe();
  }, [activeTab]);

  // FETCH MENU ITEMS
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
        error => {
          console.log("MENU ERROR:", error);
        }
      );
    return () => unsubscribe();
  }, []);

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

  return (
    <View style={Homestyles.container}>

      {/* Header */}
      <View style={Homestyles.header}>
        <TouchableOpacity style={Homestyles.backBtn} onPress={handleBack}>
          <Text style={Homestyles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={Homestyles.headerText}>FOOD ORDERS</Text>
      </View>

      {/* Tabs */}
      <View style={Homestyles.tabs}>
        <TouchableOpacity onPress={() => setActiveTab("new")}>
          <Text style={activeTab === "new" ? Homestyles.activeTab : Homestyles.tab}>New</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveTab("preparing")}>
          <Text style={activeTab === "preparing" ? Homestyles.activeTab : Homestyles.tab}>Preparing</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveTab("ready")}>
          <Text style={activeTab === "ready" ? Homestyles.activeTab : Homestyles.tab}>Ready</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveTab("completed")}>
          <Text style={activeTab === "completed" ? Homestyles.activeTab : Homestyles.tab}>Completed</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveTab("menu")}>
          <Text style={activeTab === "menu" ? Homestyles.activeTab : Homestyles.tab}>Menu</Text>
        </TouchableOpacity>
      </View>

      <ScrollView>

        {loading && <ActivityIndicator size="large" color="#E6330A" style={{ marginTop: 30 }} />}

        {!loading && activeTab !== "menu" && orders.length === 0 && (
          <Text style={{ textAlign: "center", marginTop: 40, color: "#888" }}>
            No {activeTab} orders
          </Text>
        )}

        {/* NEW ORDERS */}
        {!loading && activeTab === "new" && orders.map((order) => (
          <View style={Homestyles.card} key={order.id}>
            <View style={Homestyles.rowBetween}>
              <Text>Order #{order.orderId}  </Text>
              <Text style={Homestyles.badge}>New</Text>
            </View>
            <View style={Homestyles.rowBetween}>
              <Text style={Homestyles.name}>{order.customerName}</Text>
              <Text>Pickup:  {order.pickupTime}  </Text>
            </View>
            {order.items.map((item, index) => <Text key={index}>{item}</Text>)}
            <Text style={Homestyles.payment}>Payment: {order.payment}</Text>
            <View style={Homestyles.rowBetween}>
              <Text></Text>
              <Text>Total : Rs {order.total}  </Text>
            </View>
            <View style={Homestyles.buttonRow}>
              <TouchableOpacity style={Homestyles.acceptBtn} onPress={() => updateStatus(order.id, "preparing")}>
                <Text style={Homestyles.btnText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={Homestyles.rejectBtn} onPress={() => updateStatus(order.id, "rejected")}>
                <Text style={Homestyles.btnText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* PREPARING ORDERS */}
        {!loading && activeTab === "preparing" && orders.map((order) => (
          <View style={Homestyles.card} key={order.id}>
            <View style={Homestyles.rowBetween}>
              <Text>Order #{order.orderId}  </Text>
              <View style={Homestyles.badgeOrange}>
                <Text style={Homestyles.badgeText}>Accepted</Text>
              </View>
            </View>
            <View style={Homestyles.rowBetween}>
              <Text style={Homestyles.name}>{order.customerName}</Text>
              <Text>Pickup: {order.pickupTime}  </Text>
            </View>
            {order.items.map((item, index) => <Text key={index}>{item}</Text>)}
            <Text style={Homestyles.payment}>Payment: {order.payment}</Text>
            <View style={Homestyles.rowBetween}>
              <Text></Text>
              <Text>Total : Rs {order.total}  </Text>
            </View>
            <TouchableOpacity style={Homestyles.readyBtn} onPress={() => updateStatus(order.id, "ready")}>
              <Text style={Homestyles.readyText}>Mark as Ready</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* READY ORDERS */}
        {!loading && activeTab === "ready" && orders.map((order) => (
          <View style={Homestyles.card} key={order.id}>
            <View style={Homestyles.rowBetween}>
              <Text>Order #{order.orderId} </Text>
              <Text style={Homestyles.readyBadge}>Ready</Text>
            </View>
            <View style={Homestyles.rowBetween}>
              <Text style={Homestyles.name}>{order.customerName}</Text>
              <Text>Pickup: {order.pickupTime}  </Text>
            </View>
            {order.items.map((item, index) => <Text key={index}>{item}</Text>)}
            <Text style={Homestyles.payment}>Payment: {order.payment}</Text>
            <View style={Homestyles.rowBetween}>
              <Text></Text>
              <Text>Total : Rs {order.total}  </Text>
            </View>
            <TouchableOpacity style={Homestyles.completeBtn} onPress={() => updateStatus(order.id, "completed")}>
              <Text style={Homestyles.btnText}>Mark as Completed</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* COMPLETED ORDERS */}
        {!loading && activeTab === "completed" && orders.map((order) => (
          <View style={Homestyles.card} key={order.id}>
            <View style={Homestyles.rowBetween}>
              <Text>Order #{order.orderId} </Text>
            </View>
            <Text style={Homestyles.name}>{order.customerName}</Text>
            {order.items.map((item, index) => <Text key={index}>{item}</Text>)}
            <Text style={Homestyles.payment}>Payment: {order.payment}</Text>
            <View style={Homestyles.rowBetween}>
              <Text></Text>
              <Text>Total : Rs {order.total}  </Text>
            </View>
            <View style={Homestyles.completedBox}>
              <Text style={Homestyles.completedText}>Completed</Text>
            </View>
          </View>
        ))}

        {/* MENU MANAGEMENT */}
        {activeTab === "menu" && (
          <View style={{ padding: 10 }}>

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

          </View>
        )}

      </ScrollView>
    </View>
  );
}