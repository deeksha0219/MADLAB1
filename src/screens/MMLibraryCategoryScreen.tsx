import React, { useState, useEffect } from "react";
import {
  View, Text, Image, TouchableOpacity, ScrollView, Alert
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import { categoryStyles as styles } from "../styles/Studentstyles";
import firestore from "@react-native-firebase/firestore";

export default function MMLibraryCategoryScreen({ route, navigation }: any) {
  const { category } = route.params;
  const [unavailableItems, setUnavailableItems] = useState<string[]>([]);

  // 🔥 Listen to unavailable items from Firestore
  useEffect(() => {
  const unsubscribe = firestore()
    .collection("menu")
    .where("canteen", "==", "MM_LIBRARY") // ✅ only this canteen
    .onSnapshot(snap => {
      const unavailable: string[] = [];
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.available === false) unavailable.push(data.name);
      });
      setUnavailableItems(unavailable);
    });
  return () => unsubscribe();
}, [])

  const addToCart = async (item: any) => {
  try {
    const cartRef = firestore().collection("cart");
    const existing = await cartRef.where("name", "==", item.name).get();

    if (!existing.empty) {
      const doc = existing.docs[0];
      await cartRef.doc(doc.id).update({
        quantity: doc.data().quantity + 1,
      });
    } else {
      await cartRef.add({
        name: item.name,
        price: item.price,
        desc: item.desc,
        quantity: 1,
      });
    }

    navigation.navigate("Cart");
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
          const isUnavailable = unavailableItems.includes(item.name);

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

              <TouchableOpacity
                style={[styles.button, isUnavailable && { backgroundColor: "#ccc" }]}
                disabled={isUnavailable}
                onPress={() => addToCart(item)}
              >
                <Text style={styles.buttonText}>
                  {isUnavailable ? "Unavailable" : "Add To Tummy"}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}

      </ScrollView>
    </SafeAreaView>
  );
}