import React from "react";
import { View, Text, Image, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import FeatherIcon from "react-native-vector-icons/Feather";

export default function ProfileScreen({ navigation, setRole }: any) {
  const handleLogout = () => {
  setRole(null);
};

  const menuItems = [
  { icon: "history", text: "Order History ", screen: "OrderHistory" },
  { icon: "credit-card", text: "Payment Method  ", screen: "Payment" },
  { icon: "settings", text: "Settings  ", screen: "Settings" },
  { icon: "help-outline", text: "Help  ", screen: "Help" },
];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f2f2f2" }}>
      <ScrollView contentContainerStyle={{ padding: 15 }}>

        {/* HEADER */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <MaterialIcon name="arrow-back" size={28} />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: "bold" }}>Profile</Text>
          <MaterialIcon name="shopping-cart" size={28} />
        </View>

        {/* USER INFO */}
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#e0e0e0", padding: 10, borderRadius: 10, marginBottom: 20 }}>
          <Image
            source={require("../../assets/profile.png")}
            style={{ width: 60, height: 60, borderRadius: 30, marginRight: 10 }}
          />
          <View>
            <Text style={{ fontSize: 16, fontWeight: "bold" }}>Anil Kumble</Text>
            <Text style={{ color: "gray" }}>+91 9745032126</Text>
          </View>
        </View>

        {/* MENU ITEMS */}
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => navigation.navigate(item.screen)}
            style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#e0e0e0", padding: 15, borderRadius: 10, marginBottom: 10 }}
          >
            <MaterialIcon name={item.icon} size={24} style={{ marginRight: 15 }} />
            <Text style={{ fontSize: 15 }}>{item.text}</Text>
          </TouchableOpacity>
        ))}

        {/* LOGOUT */}
        <TouchableOpacity
          onPress={handleLogout}
          style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#e0e0e0", padding: 15, borderRadius: 10, marginTop: 10 }}
        >
          <View style={{ backgroundColor: "red", padding: 8, borderRadius: 20, marginRight: 15 }}>
            <FeatherIcon name="log-out" size={18} color="#fff" />
          </View>
          <Text style={{ color: "red", fontSize: 15 }}>Logout</Text>
        </TouchableOpacity>

        
      </ScrollView>
    </SafeAreaView>
  );
}