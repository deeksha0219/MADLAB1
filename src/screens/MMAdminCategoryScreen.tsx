import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import { categoryStyles as styles } from "../styles/Studentstyles";
import firestore from "@react-native-firebase/firestore";

const foodImages: any = {
  "Veg Puff": require("../../assets/veg_puff.png"),
  "Paneer Puff": require("../../assets/paneer_puff.png"),
  "Egg Puff": require("../../assets/egg_puff.png"),
  "Veg Burger": require("../../assets/veg_burger.png"),
  "Chicken Burger": require("../../assets/chicken_burger.png"),
  "Samosa": require("../../assets/Samosa.png"),
  "Idly": require("../../assets/Idly.png"),
  "Vada": require("../../assets/Vada.png"),
  "Rice Bath": require("../../assets/veg_biryani.png"),
  "Masala Dosa": require("../../assets/masala_dosa.png"),
  "Set Dosa": require("../../assets/set_dosa.png"),
  "Mysore Masala Dosa": require("../../assets/mysore.png"),
  "Open Butter Dosa": require("../../assets/open_butter.png"),
  "Plain Dosa": require("../../assets/plain_dosa.png"),
  "Paneer Curry Paratha": require("../../assets/paneer_curry.png"),
  "Brownie": require("../../assets/brownie.png"),
  "Choco Pastry": require("../../assets/choco_pastry.png"),
  "Black Forest": require("../../assets/black_forest.png"),
  "Tea": require("../../assets/tea.png"),
  "Coffee": require("../../assets/coffee.png"),
  "Gobi Manchurian": require("../../assets/gobi_manchuri.png"),
  "All Fried Rice": require("../../assets/chinese.png"),
  "Gobi Noodles": require("../../assets/gobi.png"),
};

export default function MMAdminCategoryScreen({ route, navigation }: any) {
  const { category } = route.params;

  const [items, setItems] = useState<any[]>([]);

  // ✅ FETCH FROM FIREBASE
  useEffect(() => {
    const unsubscribe = firestore()
      .collection("menu")
      .where("category", "==", category)
      .where("canteen", "==", "MM_ADMIN_BLOCK")
      .onSnapshot(snapshot => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setItems(data);
      });

    return () => unsubscribe();
  }, []);

  // ✅ ADD TO CART
  const addToCart = async (item: any) => {
    try {
      const cartRef = firestore().collection("cart");

      const existing = await cartRef
        .where("name", "==", item.name)
        .get();

      if (!existing.empty) {
        const doc = existing.docs[0];
        await cartRef.doc(doc.id).update({
          quantity: doc.data().quantity + 1,
        });
      } else {
        await cartRef.add({
          name: item.name,
          price: item.price,
          quantity: 1,
        });
      }

      navigation.navigate("Cart");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView>

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <MaterialIcon name="arrow-back" size={28} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{category}</Text>
          <MaterialIcon name="search" size={26} />
        </View>

        {items.map(item => (
          <View
            key={item.id}
            style={[styles.card, !item.available && { opacity: 0.5 }]}
          >
            <Image source={foodImages[item.name]} style={styles.image} />

            <View style={styles.row}>
              <Text style={styles.title}>{item.name}</Text>
              <Text style={styles.price}>₹{item.price}</Text>
            </View>

            <Text style={styles.desc}>{item.desc}</Text>

            {!item.available && (
              <Text style={{ color: "red", fontWeight: "bold" }}>
                Currently Unavailable
              </Text>
            )}

            <TouchableOpacity
              style={[
                styles.button,
                !item.available && { backgroundColor: "#ccc" }
              ]}
              disabled={!item.available}
              onPress={() => addToCart(item)}
            >
              <Text style={styles.buttonText}>
                {item.available ? "Add To Tummy" : "Unavailable"}
              </Text>
            </TouchableOpacity>
          </View>
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}