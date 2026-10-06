import React, { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import FeatherIcon from "react-native-vector-icons/Feather";
import { signOutUser, getCurrentUser } from "../services/authService";
import { getStudentProfile, StudentProfile } from "../services/profileService";

export default function ProfileScreen({ navigation }: any) {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const currentUser = getCurrentUser();

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      if (!currentUser) {
        setLoading(false);
        return;
      }

      try {
        const data = await getStudentProfile(currentUser.uid);
        if (isMounted) {
          setProfile(data);
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  const handleLogout = async () => {
    Alert.alert("Confirm Logout", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOutUser();
          } catch (err: any) {
            Alert.alert("Error", err.message || "Failed to log out.");
          }
        },
      },
    ]);
  };

  const menuItems = [
    { icon: "history", text: "Order History", screen: "OrderHistory" },
    { icon: "credit-card", text: "Payment Method", screen: "Payment" },
    { icon: "settings", text: "Settings", screen: "Settings" },
    { icon: "help-outline", text: "Help", screen: "Help" },
  ];

  const displayName = profile?.name || "Student User";
  const displayPhone = profile?.phone || currentUser?.phoneNumber || "Phone not set";
  const displayEmail = profile?.collegeId || "RVU Student";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f2f2f2" }}>
      <ScrollView contentContainerStyle={{ padding: 15 }}>
        {/* HEADER */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <MaterialIcon name="arrow-back" size={28} />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: "bold" }}>Profile</Text>
          <TouchableOpacity onPress={() => navigation.navigate("Cart")}>
            <MaterialIcon name="shopping-cart" size={28} />
          </TouchableOpacity>
        </View>

        {/* USER INFO */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "#e0e0e0",
            padding: 14,
            borderRadius: 12,
            marginBottom: 20,
          }}
        >
          <Image
            source={require("../../assets/profile.png")}
            style={{ width: 60, height: 60, borderRadius: 30, marginRight: 14 }}
          />
          <View style={{ flex: 1 }}>
            {loading ? (
              <ActivityIndicator size="small" color="#E0533C" />
            ) : (
              <>
                <Text style={{ fontSize: 16, fontWeight: "bold" }}>{displayName}</Text>
                <Text style={{ color: "#444", fontSize: 13, marginTop: 2 }}>{displayPhone}</Text>
                <Text style={{ color: "#666", fontSize: 12, marginTop: 1 }}>{displayEmail}</Text>
              </>
            )}
          </View>
        </View>

        {/* MENU ITEMS */}
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => item.screen && navigation?.navigate && navigation.navigate(item.screen)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "#e0e0e0",
              padding: 15,
              borderRadius: 10,
              marginBottom: 10,
            }}
          >
            <MaterialIcon name={item.icon} size={24} style={{ marginRight: 15 }} />
            <Text style={{ fontSize: 15 }}>{item.text}</Text>
          </TouchableOpacity>
        ))}

        {/* LOGOUT */}
        <TouchableOpacity
          onPress={handleLogout}
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "#e0e0e0",
            padding: 15,
            borderRadius: 10,
            marginTop: 10,
          }}
        >
          <View style={{ backgroundColor: "#DC2626", padding: 8, borderRadius: 20, marginRight: 15 }}>
            <FeatherIcon name="log-out" size={18} color="#fff" />
          </View>
          <Text style={{ color: "#DC2626", fontSize: 15, fontWeight: "bold" }}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}