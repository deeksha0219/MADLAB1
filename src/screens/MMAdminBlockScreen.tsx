import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import FeatherIcon from "react-native-vector-icons/Feather";
import { home } from "../styles/Studentstyles";
import { useNavigation } from "@react-navigation/native";
import firestore from "@react-native-firebase/firestore";

import auth from "@react-native-firebase/auth";
import { setUserCartItem, removeUserCartItem } from "../services/orderService";

export default function MMAdminBlockScreen() {
  const navigation = useNavigation<any>();

  const [isEnabled, setIsEnabled] = useState(true);
  const [selectedCanteen, setSelectedCanteen] = useState("M.M Foods (Admin Block)");
  const [showDropdown, setShowDropdown] = useState(false);
  const [quantities, setQuantities] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    const currentUid = auth().currentUser?.uid;
    if (!currentUid) {
      setQuantities({});
      return;
    }
    const unsubscribe = firestore()
      .collection("users")
      .doc(currentUid)
      .collection("cart")
      .onSnapshot(snap => {
        const qtys: any = {};
        snap.docs.forEach(doc => {
          const data = doc.data();
          qtys[doc.id] = data.quantity;
          if (data.name) qtys[data.name] = data.quantity;
        });
        setQuantities(qtys);
      });
    return () => unsubscribe();
  }, []);

  const increaseQty = async (name: string, _price?: number) => {
    try {
      const currentUid = auth().currentUser?.uid;
      if (!currentUid) return;
      const itemId = `mm_admin_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const current = quantities[itemId] || quantities[name] || 0;
      if (current >= 99) return;
      await setUserCartItem(currentUid, {
        itemId,
        canteenId: "MM_ADMIN_BLOCK",
        quantity: current + 1,
      });
    } catch (err) {
      console.log("Error:", err);
    }
  };

  const decreaseQty = async (name: string) => {
    try {
      const currentUid = auth().currentUser?.uid;
      if (!currentUid) return;
      const itemId = `mm_admin_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const current = quantities[itemId] || quantities[name] || 0;
      if (current <= 1) {
        await removeUserCartItem(currentUid, itemId);
      } else {
        await setUserCartItem(currentUid, {
          itemId,
          canteenId: "MM_ADMIN_BLOCK",
          quantity: current - 1,
        });
      }
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <View style={home.container}>

          {/* HEADER */}
          <View style={home.header}>
            <View style={{ alignItems: "center" }}>
              <Text style={home.location}>LOCATION</Text>
              <TouchableOpacity
                onPress={() => setShowDropdown(true)}
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <Text style={home.place}>{selectedCanteen}</Text>
                <MaterialIcon name="keyboard-arrow-down" size={24} color="black" />
              </TouchableOpacity>
            </View>
            <Image source={require("../../assets/logo_text.png")} style={home.logoCenter} />
            <FeatherIcon name="bell" size={30} color="black" />
          </View>

          {/* MODAL */}
          <Modal visible={showDropdown} transparent animationType="fade">
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setShowDropdown(false)}
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.20)",
                justifyContent: "flex-start",
                paddingTop: 90,
                alignItems: "center",
              }}
            >
              <View style={{
                width: "72%",
                backgroundColor: "#fff",
                borderRadius: 18,
                paddingVertical: 8,
                elevation: 8,
              }}>
                {["BIG MINGOS", "M.M Foods (Library)", "M.M Foods (Admin Block)"].map((item, index) => (
                  <TouchableOpacity
                    key={item}
                    onPress={() => {
                      setSelectedCanteen(item);
                      setShowDropdown(false);
                      if (item === "BIG MINGOS") navigation.navigate("Home");
                      if (item === "M.M Foods (Library)") navigation.navigate("MMLibrary");
                      if (item === "M.M Foods (Admin Block)") navigation.navigate("MMAdminBlock");
                    }}
                    style={{
                      paddingVertical: 16,
                      paddingHorizontal: 18,
                      borderBottomWidth: index !== 2 ? 1 : 0,
                      borderBottomColor: "#f1f1f1",
                    }}
                  >
                    <Text style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: selectedCanteen === item ? "#E53935" : "#222",
                    }}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

          {/* SEARCH */}
          <View style={home.searchRow}>
            <View style={home.searchBox}>
              <MaterialIcon name="search" size={24} color="black" />
              <TextInput placeholder="Search" style={{ flex: 1 }} />
              <MaterialIcon name="mic" size={24} color="black" />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 10 }}>
              <Text style={{ marginRight: 6, fontWeight: "bold", color: isEnabled ? "green" : "red" }}>
                {isEnabled ? "VEG" : "NON-VEG"}
              </Text>
              <Switch
                value={isEnabled}
                onValueChange={(value) => setIsEnabled(value)}
                trackColor={{ false: "red", true: "green" }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* CATEGORIES */}
          <View style={home.grid}>
            {[
              { label: "SNACKS", img: require("../../assets/snacks.png"), cat: "SNACKS" },
              { label: "SOUTH INDIAN", img: require("../../assets/south.png"), cat: "SOUTH" },
              { label: "NORTH INDIAN", img: require("../../assets/north.png"), cat: "NORTH" },
              { label: "DESSERTS", img: require("../../assets/desserts.png"), cat: "DESSERTS" },
              { label: "BEVERAGES", img: require("../../assets/beverages.png"), cat: "BEVERAGES" },
              { label: "CHINESE", img: require("../../assets/chinese.png"), cat: "CHINESE" },
            ].map((c) => (
              <TouchableOpacity
                key={c.cat}
                style={home.category}
                onPress={() => navigation.navigate("MMAdminCategory", { category: c.cat })}
              >
                <Image source={c.img} style={home.catImage} />
                <Text style={home.catText}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* FOOD LIST */}
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={home.section}>MOST POPULAR 🤤</Text>

            {isEnabled && (
              <>
                {/* Masala Dosa */}
                <View style={home.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={home.title}>Masala Dosa</Text>
                    <Text style={home.desc}>Fresh dosa with chutney</Text>
                    <View style={home.priceRow}>
                      <TouchableOpacity style={home.qtyBtn} onPress={() => decreaseQty("Masala Dosa")}>
                        <Text>-</Text>
                      </TouchableOpacity>
                      <Text style={home.price}>₹60 ({quantities["Masala Dosa"] || 0})</Text>
                      <TouchableOpacity style={home.qtyBtn} onPress={() => increaseQty("Masala Dosa", 60)}>
                        <Text>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={home.foodBox}>
                    <Image source={require("../../assets/masala_dosa.png")} style={home.foodImg} />
                  </View>
                </View>

                {/* Gobi Noodles */}
                <View style={home.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={home.title}>Gobi Noodles</Text>
                    <Text style={home.desc}>Spicy noodles with cauliflower</Text>
                    <View style={home.priceRow}>
                      <TouchableOpacity style={home.qtyBtn} onPress={() => decreaseQty("Gobi Noodles")}>
                        <Text>-</Text>
                      </TouchableOpacity>
                      <Text style={home.price}>₹70 ({quantities["Gobi Noodles"] || 0})</Text>
                      <TouchableOpacity style={home.qtyBtn} onPress={() => increaseQty("Gobi Noodles", 70)}>
                        <Text>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={home.foodBox}>
                    <Image source={require("../../assets/gobi.png")} style={home.foodImg} />
                  </View>
                </View>

                {/* Gobi Rice */}
                <View style={home.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={home.title}>Gobi Rice</Text>
                    <Text style={home.desc}>Spicy cauliflower rice</Text>
                    <View style={home.priceRow}>
                      <TouchableOpacity style={home.qtyBtn} onPress={() => decreaseQty("Gobi Rice")}>
                        <Text>-</Text>
                      </TouchableOpacity>
                      <Text style={home.price}>₹80 ({quantities["Gobi Rice"] || 0})</Text>
                      <TouchableOpacity style={home.qtyBtn} onPress={() => increaseQty("Gobi Rice", 80)}>
                        <Text>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={home.foodBox}>
                    <Image source={require("../../assets/chinese.png")} style={home.foodImg} />
                  </View>
                </View>

                {/* Peri Peri Fries */}
                <View style={home.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={home.title}>Peri Peri Fries</Text>
                    <Text style={home.desc}>Spicy fries with peri peri masala</Text>
                    <View style={home.priceRow}>
                      <TouchableOpacity style={home.qtyBtn} onPress={() => decreaseQty("Peri Peri Fries")}>
                        <Text>-</Text>
                      </TouchableOpacity>
                      <Text style={home.price}>₹100 ({quantities["Peri Peri Fries"] || 0})</Text>
                      <TouchableOpacity style={home.qtyBtn} onPress={() => increaseQty("Peri Peri Fries", 100)}>
                        <Text>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={home.foodBox}>
                    <Image source={require("../../assets/peri_peri_fries.png")} style={home.foodImg} />
                  </View>
                </View>
              </>
            )}

            {!isEnabled && (
              /* Chicken Burger */
              <View style={home.card}>
                <View style={{ flex: 1 }}>
                  <Text style={home.title}>Chicken Burger</Text>
                  <Text style={home.desc}>Juicy chicken burger</Text>
                  <View style={home.priceRow}>
                    <TouchableOpacity style={home.qtyBtn} onPress={() => decreaseQty("Chicken Burger")}>
                      <Text>-</Text>
                    </TouchableOpacity>
                    <Text style={home.price}>₹90 ({quantities["Chicken Burger"] || 0})</Text>
                    <TouchableOpacity style={home.qtyBtn} onPress={() => increaseQty("Chicken Burger", 90)}>
                      <Text>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={home.foodBox}>
                  <Image source={require("../../assets/chicken_burger.png")} style={home.foodImg} />
                </View>
              </View>
            )}
          </ScrollView>

          {/* BOTTOM NAV */}
          <View style={{ flexDirection: "row", justifyContent: "space-around", marginTop: 10 }}>
            <TouchableOpacity onPress={() => navigation.navigate("MMAdminBlock")}>
              <MaterialIcon name="home" size={30} color="black" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate("Cart")}>
              <MaterialIcon name="shopping-cart" size={30} color="black" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate("OrderHistory")}>
              <MaterialIcon name="history" size={30} color="black" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate("Profile")}>
              <MaterialIcon name="person" size={30} color="black" />
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </SafeAreaView>
  );
}