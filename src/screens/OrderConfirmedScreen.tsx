import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { orderstyles } from "../styles/Studentstyles";

type RootStackParamList = {
  Home: undefined;
  OrderConfirmed: undefined;
};

type NavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "OrderConfirmed"
>;

const OrderConfirmed = () => {
  const navigation = useNavigation<NavigationProp>();

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
          source={require("../../assets/food.png")} // add your food collage image
          style={orderstyles.foodImage}
        />

        <View style={orderstyles.checkCircle}>
          <Text style={orderstyles.checkMark}>✓</Text>
        </View>
      </View>

      {/* Text */}
      <Text style={orderstyles.title}>Order Confirmed! 👋</Text>
      <Text style={orderstyles.subtitle}>
        Prepared 20 mins before pickup
      </Text>

      {/* Button */}
      <TouchableOpacity
        style={orderstyles.button}
        onPress={() => navigation.navigate("Home")}
      >
        <Text style={orderstyles.buttonText}>Back To Home</Text>
      </TouchableOpacity>
    </View>
  );
};
export default OrderConfirmed;