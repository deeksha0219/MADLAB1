import React from "react";
import { View, Text, TouchableOpacity, Image } from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { orderstyles } from "../styles/Studentstyles";

type RootStackParamList = {
  Home: undefined;
  OrderConfirmed: { orderId: string; referenceId: string };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "OrderConfirmed">;
type OrderConfirmedRouteProp = RouteProp<RootStackParamList, "OrderConfirmed">;

const OrderConfirmed = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<OrderConfirmedRouteProp>();

  const orderId = route.params?.orderId || "—";
  const referenceId = route.params?.referenceId || "—";

  return (
    <View style={orderstyles.container}>
      {/* Top Back Arrow */}
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={orderstyles.backArrow}>←</Text>
      </TouchableOpacity>

      <Text style={orderstyles.header}>Order Confirmed</Text>

      {/* Food Images + Check */}
      <View style={orderstyles.imageContainer}>
        <Image
          source={require("../../assets/food.png")}
          style={orderstyles.foodImage}
        />
      </View>

      {/* Text */}
      <Text style={orderstyles.title}>Order Confirmed! 👋</Text>
      <Text style={orderstyles.subtitle}>
        Prepared 20 mins before pickup
      </Text>

      {/* Order ID / Reference ID */}
      <View style={{
        backgroundColor: "#fff",
        borderRadius: 12,
        padding: 16,
        marginTop: 20,
        width: "100%",
        elevation: 2,
      }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={{ color: "gray" }}>Order ID</Text>
          <Text style={{ fontWeight: "bold" }}>{orderId}</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={{ color: "gray" }}>Reference ID</Text>
          <Text style={{ fontWeight: "bold" }}>{referenceId}</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: "gray" }}>Payment</Text>
          <Text style={{ fontWeight: "bold", color: "#D97706" }}>Demo Mode (Simulated)</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={{ width: "100%", marginTop: 24, gap: 12 }}>
        <TouchableOpacity
          style={[orderstyles.button, { backgroundColor: "#10B981" }]}
          onPress={() => (navigation as any).navigate("OrderHistory")}
        >
          <Text style={orderstyles.buttonText}>Track Order Status</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={orderstyles.button}
          onPress={() => navigation.navigate("Home")}
        >
          <Text style={orderstyles.buttonText}>Back To Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default OrderConfirmed;