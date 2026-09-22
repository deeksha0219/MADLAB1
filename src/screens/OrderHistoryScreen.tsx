import React, { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, FlatList, SafeAreaView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { orderHistoryStyles as styles } from "../styles/Studentstyles";
import firestore from "@react-native-firebase/firestore";

const foodImages: any = {
  "Peri Peri Fries": require("../../assets/peri_peri_fries.png"),
  "Lime Soda": require("../../assets/lime.png"),
  "Sandwich": require("../../assets/sandwich.png"),
  "Masala Dosa": require("../../assets/masala_dosa.png"),
  "Gobi Noodles": require("../../assets/gobi.png"),
  "Hyderabadi Chicken Biryani": require("../../assets/chicken_biryani.png"),
  "Chicken Popcorn": require("../../assets/chicken_popcorn.png"),
  "Chicken Manchurian": require("../../assets/chicken_manchurian.png"),
  "Potato Bites": require("../../assets/potato_bites.png"),
  "Boiled Egg": require("../../assets/eggs.png"),
  "Coffee": require("../../assets/coffee.png"),
  "Tea": require("../../assets/tea.png"),
  "Lassi": require("../../assets/lassi.png"),
  "Omelette": require("../../assets/Omelette.png"),
  "Pav Bhaji": require("../../assets/pav_bhaaji.png"),
  "Vada": require("../../assets/Vada.png"),
  "Poori Saagu": require("../../assets/Poori_saagu.png"),
  "Akki Roti": require("../../assets/Akki_rotti.png"),
  "Ragi Roti": require("../../assets/Ragi_rotti.png"),
  "Aloo Bonda": require("../../assets/Aloo_bonda.png"),
  "Chole Bhature": require("../../assets/chole_bhature.png"),
  "Gulab Jamun": require("../../assets/gulab_jamun.png"),
  "Fruit Custard": require("../../assets/fruit_custard.png"),
  "Carrot Halwa": require("../../assets/carrot_halwa.png"),
  "Brownie Sundae": require("../../assets/brownie.png"),
  "Kesar Badam Milkshake": require("../../assets/badam_milk.png"),
  "Butterscotch Milkshake": require("../../assets/butterscotch.png"),
  "Chocolate Milk": require("../../assets/choco_milk.png"),
  "Veg Manchurian": require("../../assets/Veg_manchurian.png"),
  "Chilly 65": require("../../assets/chilly_65.png"),
  "Honey Chilly Potato": require("../../assets/honey_chilli.png"),
  "Veg Puff": require("../../assets/veg_puff.png"),
  "Paneer Puff": require("../../assets/paneer_puff.png"),
  "Egg Puff": require("../../assets/egg_puff.png"),
  "Veg Burger": require("../../assets/veg_burger.png"),
  "Chicken Burger": require("../../assets/chicken_burger.png"),
  "Samosa": require("../../assets/Samosa.png"),
  "Idly": require("../../assets/Idly.png"),
  "Rice Bath": require("../../assets/veg_biryani.png"),
  "Set Dosa": require("../../assets/set_dosa.png"),
  "Mysore Masala Dosa": require("../../assets/mysore.png"),
  "Open Butter Dosa": require("../../assets/open_butter.png"),
  "Plain Dosa": require("../../assets/plain_dosa.png"),
  "Paneer Curry Paratha": require("../../assets/paneer_curry.png"),
  "Brownie": require("../../assets/brownie.png"),
  "Choco Pastry": require("../../assets/choco_pastry.png"),
  "Black Forest": require("../../assets/black_forest.png"),
  "Gobi Manchurian": require("../../assets/gobi_manchuri.png"),
  "All Fried Rice": require("../../assets/chinese.png"),
  "Gobi Rice": require("../../assets/chinese.png"),
};

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  orderId?: string;
  referenceId?: string;
  items: OrderItem[];
  total: number;
  placedAt: any;
}

const formatDate = (val: any): string => {
  if (typeof val === "number" && !isNaN(val)) return new Date(val).toLocaleString();
  if (typeof val?.toDate === "function") return val.toDate().toLocaleString();
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? "Old Order" : d.toLocaleString();
  }
  return "Old Order";
};

import auth from "@react-native-firebase/auth";

export default function OrderHistoryScreen() {
  const navigation = useNavigation<any>();
  const [orders, setOrders] = useState<Order[]>([]);
  const currentUid = auth().currentUser?.uid;

  useEffect(() => {
    if (!currentUid) {
      setOrders([]);
      return;
    }
    const unsubscribe = firestore()
      .collection("orders")
      .where("studentUid", "==", currentUid)
      .orderBy("createdAt", "desc")
      .onSnapshot(snap => {
        if (!snap) return;
        const data = snap.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            orderId: d.orderId || doc.id,
            referenceId: d.orderId || doc.id,
            items: (d.itemsSnapshot || []).map((item: any) => ({
              id: item.itemId,
              name: item.itemName,
              price: Math.floor((item.unitPriceInPaise || 0) / 100),
              quantity: item.quantity,
            })),
            total: Math.floor((d.totalInPaise || 0) / 100),
            placedAt: d.createdAt,
          };
        }) as Order[];

        setOrders(data);
      }, err => {
        console.log("Order history error:", err);
      });
    return () => unsubscribe();
  }, [currentUid]);

  const renderOrder = ({ item }: { item: Order }) => (
    <View style={styles.orderCard}>
      <Text style={styles.orderDate}>🕐 {formatDate(item.placedAt)}</Text>

      {/* Order ID / Reference ID */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={{ fontSize: 12, color: "gray" }}>
          Order ID: <Text style={{ fontWeight: "bold", color: "#333" }}>{(item as any).orderId || "—"}</Text>
        </Text>
        <Text style={{ fontSize: 12, color: "gray" }}>
          Ref: <Text style={{ fontWeight: "bold", color: "#333" }}>{(item as any).referenceId || "—"}</Text>
        </Text>
      </View>

      {item.items.map((food, index) => (
        <View key={index} style={styles.itemRow}>
          <Image
            source={foodImages[food.name] || require("../../assets/snacks.png")}
            style={styles.itemImage}
          />
          <View style={styles.itemDetails}>
            <View style={styles.itemNameRow}>
              <Text style={styles.itemName}>{food.name} ({food.quantity})</Text>
              <Text style={styles.itemPrice}>₹{food.price * food.quantity}</Text>
            </View>
          </View>
        </View>
      ))}
      <View style={styles.bottomRow}>
        <Text style={styles.totalText}>Total: ₹{item.total}</Text>
        <TouchableOpacity
          style={styles.reorderBtn}
          onPress={async () => {
            try {
              const cartRef = firestore().collection("cart");

              for (const food of item.items) {
                const existing = await cartRef
                  .where("name", "==", food.name)
                  .get();

                if (!existing.empty) {
                  const doc = existing.docs[0];
                  await cartRef.doc(doc.id).update({
                    quantity: doc.data().quantity + food.quantity,
                  });
                } else {
                  await cartRef.add({
                    name: food.name,
                    price: food.price,
                    quantity: food.quantity,
                  });
                }
              }

              navigation.navigate("Cart");
            } catch (err) {
              console.log(err);
            }
          }}
        >
          <Text style={styles.reorderIcon}>↻</Text>
          <Text style={styles.reorderText}>Reorder</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order History</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={{ padding: 15 }}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No orders yet! 🍽️</Text>
        }
      />
    </SafeAreaView>
  );
}