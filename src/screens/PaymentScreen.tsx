import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Image, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import firestore from "@react-native-firebase/firestore";

export default function PaymentScreen({ navigation, route }: any) {
  const [selected, setSelected] = useState<string | null>(null);
  const total = route.params?.total || 0;
  const pickupTime = route.params?.pickupTime || "Not selected";

  const upiMethods = [
    { id: "phonepe", label: "PhonePe ", icon: require("../../assets/phonepe.png") },
    { id: "googlepay", label: "Google Pay ", icon: require("../../assets/gpay.png") },
    { id: "paytm", label: "Paytm ", icon: require("../../assets/paytm.png") },
  ];

  const cashMethods = [
    { id: "cash", label: "Pay at Counter ", emoji: "💵" },
    { id: "scan", label: "Scan the QR Code ", emoji: "📱" },
  ];

  const getPaymentLabel = () => {
    if (selected === "cash") return "Pay at Counter";
    return "Paid Online";
  };

  const placeOrder = async () => {
  try {
    const cartSnap = await firestore().collection("cart").get();
    const cartItems = cartSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as any[];

    const itemsArray = cartItems.map(
      (item: any) => `${item.name} (${item.quantity})`
    );

    const orderId = Math.floor(100 + Math.random() * 900).toString();

    // Save to orders (for admin)
    await firestore().collection("orders").add({
      orderId,
      customerName: "Student",
      pickupTime,
      items: itemsArray,
      payment: getPaymentLabel(),
      total,
      status: "new",
      placedAt: Date.now() // ✅ fixed
    });

    // Save to orderHistory (for student)
    await firestore().collection("orderHistory").add({
      items: cartItems,
      total,
      placedAt: firestore.FieldValue.serverTimestamp(), // ✅ fixed
    });

    // Clear cart
    const batch = firestore().batch();
    cartSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    navigation.navigate("OrderConfirmed");
  } catch (error) {
    console.log("Order error:", error);
    Alert.alert("Error", "Failed to place order. Try again.");
  }
};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f2f2f2" }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 15, gap: 10 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontSize: 22 }}>←</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: "bold" }}>Total Bill : ₹{total}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 15 }}>

        <View style={{ backgroundColor: "#fff", padding: 15, borderRadius: 12, marginBottom: 15, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: "gray" }}>Pickup Time</Text>
          <Text style={{ fontWeight: "bold" }}>⏰ {pickupTime}</Text>
        </View>

        <Text style={{ color: "gray", fontSize: 13, marginBottom: 10 }}>Pay By Any UPI App</Text>

        {upiMethods.map((method) => (
          <TouchableOpacity
            key={method.id}
            onPress={() => setSelected(method.id)}
            style={{
              flexDirection: "row", alignItems: "center",
              backgroundColor: selected === method.id ? "#ffe5de" : "#fff",
              padding: 15, borderRadius: 12, marginBottom: 10,
              borderWidth: selected === method.id ? 2 : 0,
              borderColor: "#DF401C", elevation: 1,
            }}
          >
            <Image source={method.icon} style={{ width: 36, height: 36, marginRight: 15, resizeMode: "contain" }} />
            <Text style={{ fontSize: 16 }}>{method.label}</Text>
          </TouchableOpacity>
        ))}

        <Text style={{ color: "gray", fontSize: 13, marginTop: 10, marginBottom: 10 }}>CASH</Text>

        {cashMethods.map((method) => (
          <TouchableOpacity
            key={method.id}
            onPress={() => setSelected(method.id)}
            style={{
              flexDirection: "row", alignItems: "center",
              backgroundColor: selected === method.id ? "#ffe5de" : "#fff",
              padding: 15, borderRadius: 12, marginBottom: 10,
              borderWidth: selected === method.id ? 2 : 0,
              borderColor: "#DF401C", elevation: 1,
            }}
          >
            <Text style={{ fontSize: 24, marginRight: 15 }}>{method.emoji}</Text>
            <Text style={{ fontSize: 16 }}>{method.label}</Text>
          </TouchableOpacity>
        ))}

      </ScrollView>

      <View style={{ padding: 15 }}>
        <TouchableOpacity
          onPress={placeOrder}
          disabled={!selected}
          style={{ backgroundColor: selected ? "#DF401C" : "#ccc", padding: 18, borderRadius: 14, alignItems: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 16 }}>Order My Food</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}