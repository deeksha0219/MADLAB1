import React, { useState, useEffect } from "react";
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
import auth from "@react-native-firebase/auth";
import { setUserCartItem, removeUserCartItem } from "../services/orderService";

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
  const [quantities, setQuantities] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    const unsubscribe = firestore()
      .collection("canteens")
      .doc("MM_ADMIN_BLOCK")
      .collection("items")
      .where("categoryId", "==", category)
      .onSnapshot(snapshot => {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            name: d.name,
            price: typeof d.priceInPaise === "number" ? Math.floor(d.priceInPaise / 100) : (d.price || 0),
            priceInPaise: d.priceInPaise,
            desc: d.description || d.desc || "",
            available: d.isAvailable !== false,
          };
        });
        setItems(data);
      });

    return () => unsubscribe();
  }, [category]);

  // Sync cart quantities live from user cart
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

  const increaseQty = async (itemId: string, name: string) => {
    try {
      const currentUid = auth().currentUser?.uid;
      if (!currentUid) {
        Alert.alert("Error", "Please sign in to add items.");
        return;
      }
      const current = quantities[itemId] || quantities[name] || 0;
      if (current >= 99) return;
      await setUserCartItem(currentUid, {
        itemId,
        canteenId: "MM_ADMIN_BLOCK",
        quantity: current + 1,
      });
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const decreaseQty = async (itemId: string, name: string) => {
    try {
      const currentUid = auth().currentUser?.uid;
      if (!currentUid) return;
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

        {items.map(item => {
          const itemId = item.id || `mm_admin_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          const qty = quantities[itemId] || quantities[item.name] || 0;

          return (
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

              {/* stepper replaces button once item is in cart */}
              {item.available && qty > 0 ? (
                <View style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#DF401C",
                  borderRadius: 8,
                  paddingVertical: 8,
                }}>
                  <TouchableOpacity
                    onPress={() => decreaseQty(itemId, item.name)}
                    style={{ paddingHorizontal: 18 }}
                  >
                    <Text style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>-</Text>
                  </TouchableOpacity>
                  <Text style={{ color: "#fff", fontSize: 16, fontWeight: "bold" }}>{qty}</Text>
                  <TouchableOpacity
                    onPress={() => increaseQty(itemId, item.name)}
                    style={{ paddingHorizontal: 18 }}
                  >
                    <Text style={{ color: "#fff", fontSize: 18, fontWeight: "bold" }}>+</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.button,
                    !item.available && { backgroundColor: "#ccc" }
                  ]}
                  disabled={!item.available}
                  onPress={() => increaseQty(itemId, item.name)}
                >
                  <Text style={styles.buttonText}>
                    {item.available ? "Add To Tummy" : "Unavailable"}
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