import React, { useState, useEffect } from "react";
import {
  View, Text, Image, TouchableOpacity, ScrollView, Alert
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import { categoryStyles as styles } from "../styles/Studentstyles";
import firestore from "@react-native-firebase/firestore";

import auth from "@react-native-firebase/auth";
import { setUserCartItem, removeUserCartItem } from "../services/orderService";

export default function MMLibraryCategoryScreen({ route, navigation }: any) {
  const { category } = route.params;
  const [unavailableItems, setUnavailableItems] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    const unsubscribe = firestore()
      .collection("canteens")
      .doc("MM_LIBRARY")
      .collection("items")
      .where("isAvailable", "==", false)
      .onSnapshot(snap => {
        const unavailable: string[] = [];
        snap.docs.forEach(doc => {
          const data = doc.data();
          unavailable.push(doc.id);
          if (data.name) unavailable.push(data.name);
        });
        setUnavailableItems(unavailable);
      });
    return () => unsubscribe();
  }, []);

  // Sync cart quantities live from user-scoped cart
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
        const qtys: { [key: string]: number } = {};
        snap.docs.forEach(doc => {
          const data = doc.data();
          qtys[doc.id] = data.quantity;
          if (data.name) qtys[data.name] = data.quantity;
        });
        setQuantities(qtys);
      });
    return () => unsubscribe();
  }, []);

  const increaseQty = async (item: any) => {
    try {
      const currentUid = auth().currentUser?.uid;
      if (!currentUid) {
        Alert.alert("Error", "Please sign in to add items.");
        return;
      }
      const itemId = item.id || `mm_lib_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const current = quantities[itemId] || quantities[item.name] || 0;
      if (current >= 99) return;
      await setUserCartItem(currentUid, {
        itemId,
        canteenId: "MM_LIBRARY",
        quantity: current + 1,
      });
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const decreaseQty = async (item: any) => {
    try {
      const currentUid = auth().currentUser?.uid;
      if (!currentUid) return;
      const itemId = item.id || `mm_lib_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const current = quantities[itemId] || quantities[item.name] || 0;
      if (current <= 1) {
        await removeUserCartItem(currentUid, itemId);
      } else {
        await setUserCartItem(currentUid, {
          itemId,
          canteenId: "MM_LIBRARY",
          quantity: current - 1,
        });
      }
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const menu: any = {
    SNACKS: [
      { name: "Veg Puff", price: 20, desc: "Fresh crispy puff with tasty filling", image: require("../../assets/veg_puff.png") },
      { name: "Paneer Puff", price: 30, desc: "Flaky puff stuffed with paneer masala", image: require("../../assets/paneer_puff.png") },
      { name: "Egg Puff", price: 30, desc: "Hot puff with spicy egg filling", image: require("../../assets/egg_puff.png") },
      { name: "Veg Burger", price: 50, desc: "Burger with crispy veg patty", image: require("../../assets/veg_burger.png") },
      { name: "Chicken Burger", price: 80, desc: "Juicy chicken burger", image: require("../../assets/chicken_burger.png") },
      { name: "Samosa", price: 20, desc: "Classic crispy samosa", image: require("../../assets/Samosa.png") },
    ],
    SOUTH: [
      { name: "Idly", price: 15, desc: "Soft steamed idly", image: require("../../assets/Idly.png") },
      { name: "Vada", price: 25, desc: "Crispy vada", image: require("../../assets/Vada.png") },
      { name: "Rice Bath", price: 60, desc: "Spicy rice bath", image: require("../../assets/veg_biryani.png") },
      { name: "Masala Dosa", price: 60, desc: "Crispy dosa with masala", image: require("../../assets/masala_dosa.png") },
      { name: "Set Dosa", price: 60, desc: "Soft fluffy dosa set", image: require("../../assets/set_dosa.png") },
      { name: "Mysore Masala Dosa", price: 80, desc: "Spicy mysore masala dosa", image: require("../../assets/mysore.png") },
      { name: "Open Butter Dosa", price: 80, desc: "Butter rich dosa", image: require("../../assets/open_butter.png") },
      { name: "Plain Dosa", price: 50, desc: "Simple crispy plain dosa", image: require("../../assets/plain_dosa.png") },
    ],
    NORTH: [
      { name: "Paneer Curry Paratha", price: 80, desc: "Paneer curry served with paratha", image: require("../../assets/paneer_curry.png") },
    ],
    DESSERTS: [
      { name: "Brownie", price: 70, desc: "Soft chocolate brownie", image: require("../../assets/brownie.png") },
      { name: "Choco Pastry", price: 70, desc: "Chocolate pastry slice", image: require("../../assets/choco_pastry.png") },
      { name: "Black Forest", price: 70, desc: "Classic black forest cake", image: require("../../assets/black_forest.png") },
    ],
    BEVERAGES: [
      { name: "Tea", price: 15, desc: "Hot tea", image: require("../../assets/tea.png") },
      { name: "Coffee", price: 15, desc: "Fresh coffee", image: require("../../assets/coffee.png") },
    ],
    CHINESE: [
      { name: "Gobi Manchurian", price: 100, desc: "Spicy gobi manchurian", image: require("../../assets/gobi_manchuri.png") },
      { name: "All Fried Rice", price: 80, desc: "Mixed fried rice", image: require("../../assets/chinese.png") },
      { name: "Gobi Noodles", price: 70, desc: "Hot veg noodles", image: require("../../assets/gobi.png") },
    ],
  };

  const items = menu[category] || [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <MaterialIcon name="arrow-back" size={28} color="black" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{category}</Text>
          <MaterialIcon name="search" size={26} color="black" />
        </View>

        {/* LIST */}
        {items.map((item: any, index: number) => {
          const itemId = item.id || `mm_lib_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          const isUnavailable = unavailableItems.includes(itemId) || unavailableItems.includes(item.name);
          const qty = quantities[itemId] || quantities[item.name] || 0;

          return (
            <View
              key={index}
              style={[styles.card, isUnavailable && { opacity: 0.4 }]}
            >
              <Image source={item.image} style={styles.image} />

              <View style={styles.row}>
                <Text style={styles.title}>{item.name}</Text>
                <Text style={styles.price}>₹{item.price}</Text>
              </View>

              <Text style={styles.desc}>{item.desc}</Text>

              {isUnavailable && (
                <Text style={{ color: "red", fontWeight: "bold", marginBottom: 6 }}>
                  Currently Unavailable
                </Text>
              )}

              {/* stepper replaces button once item is in cart */}
              {!isUnavailable && qty > 0 ? (
                <View style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#DF401C",
                  borderRadius: 8,
                  paddingVertical: 8,
                }}>
                  <TouchableOpacity
                    onPress={() => decreaseQty(item)}
                    style={{ paddingHorizontal: 18 }}
                  >
                    <Text style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>-</Text>
                  </TouchableOpacity>
                  <Text style={{ color: "#fff", fontSize: 16, fontWeight: "bold" }}>{qty}</Text>
                  <TouchableOpacity
                    onPress={() => increaseQty(item)}
                    style={{ paddingHorizontal: 18 }}
                  >
                    <Text style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>+</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.button, isUnavailable && { backgroundColor: "#ccc" }]}
                  disabled={isUnavailable}
                  onPress={() => increaseQty(item)}
                >
                  <Text style={styles.buttonText}>
                    {isUnavailable ? "Unavailable" : "Add To Tummy"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

      </ScrollView>
    </SafeAreaView>
  );
}