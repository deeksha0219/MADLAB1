import React, { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, FlatList } from "react-native";
import { cartStyles as styles } from "../styles/Studentstyles";
import { useNavigation } from "@react-navigation/native";
import firestore from "@react-native-firebase/firestore";
import DateTimePicker from "@react-native-community/datetimepicker";

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const foodImages: any = {
  "Potato Bites": require("../../assets/potato_bites.png"),
  "Chicken Popcorn": require("../../assets/chicken_popcorn.png"),
  "Boiled Egg": require("../../assets/eggs.png"),
  "Omelette": require("../../assets/Omelette.png"),
  "Peri Peri Fries": require("../../assets/peri_peri_fries.png"),
  "Sandwich": require("../../assets/sandwich.png"),
  "Idly (2 pcs)": require("../../assets/Idlis.png"),
  "Masala Dosa": require("../../assets/masala_dosa.png"),
  "Vada": require("../../assets/Vada.png"),
  "Poori Saagu": require("../../assets/Poori_saagu.png"),
  "Akki Roti": require("../../assets/Akki_rotti.png"),
  "Ragi Roti": require("../../assets/Ragi_rotti.png"),
  "Aloo Bonda": require("../../assets/Aloo_bonda.png"),
  "Hyderabadi Chicken Biryani": require("../../assets/chicken_biryani.png"),
  "Chole Bhature": require("../../assets/chole_bhature.png"),
  "Pav Bhaji": require("../../assets/pav_bhaaji.png"),
  "Gulab Jamun": require("../../assets/gulab_jamun.png"),
  "Fruit Custard": require("../../assets/fruit_custard.png"),
  "Carrot Halwa": require("../../assets/carrot_halwa.png"),
  "Brownie Sundae": require("../../assets/brownie.png"),
  "Coffee": require("../../assets/coffee.png"),
  "Tea": require("../../assets/tea.png"),
  "Kesar Badam Milkshake": require("../../assets/badam_milk.png"),
  "Butterscotch Milkshake": require("../../assets/butterscotch.png"),
  "Chocolate Milk": require("../../assets/choco_milk.png"),
  "Lassi": require("../../assets/lassi.png"),
  "Lime Soda": require("../../assets/lime.png"),
  "Veg Manchurian": require("../../assets/Veg_manchurian.png"),
  "Chilly 65": require("../../assets/chilly_65.png"),
  "Honey Chilly Potato": require("../../assets/honey_chilli.png"),
  "Chicken Manchurian": require("../../assets/chicken_manchurian.png"),
  "Gobi Noodles": require("../../assets/gobi.png"),
  
 // ── MM LIBRARY & MM ADMIN BLOCK (missing — add these) ────────
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

import auth from "@react-native-firebase/auth";

export default function CartScreen() {
  const navigation = useNavigation<any>();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pickupTime, setPickupTime] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const currentUid = auth().currentUser?.uid;

  const formatTime = (date: Date) => {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12;
    hours = hours ? hours : 12;

    return `${hours}:${minutes < 10 ? "0" + minutes : minutes} ${ampm}`;
  };

  useEffect(() => {
    if (!currentUid) {
      setCart([]);
      return;
    }
    const unsubscribe = firestore()
      .collection("users")
      .doc(currentUid)
      .collection("cart")
      .onSnapshot(snap => {
        const data = snap.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            name: doc.id,
            price: 50, // Non-authoritative display placeholder
            quantity: typeof d.quantity === 'number' ? d.quantity : 1,
            canteenId: d.canteenId || 'BIG_MINGOS',
          };
        }) as (CartItem & { canteenId: string })[];
        setCart(data);
      });
    return () => unsubscribe();
  }, [currentUid]);

  const increase = async (id: string) => {
    if (!currentUid) return;
    const item = cart.find(i => i.id === id);
    if (item && item.quantity < 99) {
      await firestore()
        .collection("users")
        .doc(currentUid)
        .collection("cart")
        .doc(id)
        .update({
          quantity: item.quantity + 1,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
    }
  };

  const decrease = async (id: string) => {
    if (!currentUid) return;
    const item = cart.find(i => i.id === id);
    if (item) {
      if (item.quantity <= 1) {
        await firestore()
          .collection("users")
          .doc(currentUid)
          .collection("cart")
          .doc(id)
          .delete();
      } else {
        await firestore()
          .collection("users")
          .doc(currentUid)
          .collection("cart")
          .doc(id)
          .update({
            quantity: item.quantity - 1,
            updatedAt: firestore.FieldValue.serverTimestamp(),
          });
      }
    }
  };

  const getTotal = () =>
    cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const renderItem = ({ item }: { item: CartItem }) => (
    <View style={styles.card}>
      <Image source={foodImages[item.name] || require("../../assets/snacks.png")} style={styles.image} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.price}>₹{item.price}</Text>
        <View style={styles.counter}>
          <TouchableOpacity style={styles.btn} onPress={() => decrease(item.id)}>
            <Text style={styles.btnText}>-</Text>
          </TouchableOpacity>
          <Text style={styles.qty}>{item.quantity}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => increase(item.id)}>
            <Text style={styles.btnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Tummy Is Here</Text>

      <TouchableOpacity style={styles.pickup} onPress={() => setShowPicker(true)}>
        <Text>  Select Pickup Time</Text>
        <Text>{formatTime(pickupTime)}     </Text>
      </TouchableOpacity>

      {showPicker && (
        <DateTimePicker
          value={pickupTime}
          mode="time"
          is24Hour={false}
          display="default"
          onChange={(event, selectedDate) => {
            setShowPicker(false);
            if (selectedDate) setPickupTime(selectedDate);
          }}
        />
      )}

      {cart.length === 0 ? (
        <Text style={{ textAlign: "center", marginTop: 40, color: "#888" }}>
          No items added yet! 🍽️
        </Text>
      ) : (
        <FlatList
          data={cart}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 10 }}
        />
      )}

      <View style={styles.totalRow}>
        <Text style={styles.totalText}>   Total Amount :</Text>
        <Text style={styles.totalPrice}>₹{getTotal()}     </Text>
      </View>

      <TouchableOpacity
        style={[styles.checkoutBtn, cart.length === 0 && { backgroundColor: "#F63204" }]}
        onPress={() => {
          if (cart.length === 0) {
            navigation.navigate("Home");
          } else {
            const canteenId = (cart[0] as any)?.canteenId || "BIG_MINGOS";
            navigation.navigate("Payment", {
              canteenId,
              items: cart.map(i => ({ itemId: i.id, quantity: i.quantity })),
              pickupSlotId: "SLOT_DEFAULT",
              pickupTime: formatTime(pickupTime),
              total: getTotal(),
            });
          }
        }}
      >
        <Text style={styles.checkoutText}>
          {cart.length === 0 ? "Add Items 🍽️" : `Lock My Order ₹${getTotal()}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}