import React, { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import { categoryStyles as styles } from "../styles/Studentstyles";
import firestore from "@react-native-firebase/firestore";

export default function CategoryScreen({ route, navigation }: any) {
  const { category } = route.params;

  // 🔥 availability from Firestore
  const [availabilityMap, setAvailabilityMap] = useState<any>({});

  useEffect(() => {
    const unsubscribe = firestore()
      .collection("menu")
      .where("category", "==", category)
      .onSnapshot(snapshot => {
        const map: any = {};
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          map[data.name] = data.available;
        });
        setAvailabilityMap(map);
      });

    return () => unsubscribe();
  }, [category]);

  // ✅ your original menu (UNCHANGED)
  const menu: any = {
    SNACKS: [
      { name: "Potato Bites", price: 80, desc: "Golden crispy potato bites perfect for snacking", image: require("../../assets/potato_bites.png") },
      { name: "Chicken Popcorn", price: 90, desc: "Juicy chicken popcorn coated in a crunchy and flavorful crust", image: require("../../assets/chicken_popcorn.png") },
      { name: "Boiled Egg", price: 25, desc: "Two fresh boiled eggs, simple and protein rich", image: require("../../assets/eggs.png") },
      { name: "Omelette", price: 180, desc: "Soft egg omelette filled with flavorful chicken and light spices", image: require("../../assets/Omelette.png") },
      { name: "Peri Peri Fries", price: 120, desc: "Crispy fries seasoned with peri peri spices", image: require("../../assets/peri_peri_fries.png") },
      { name: "Sandwich", price: 60, desc: "Fresh vegetables and cheese in a toasted bread", image: require("../../assets/sandwich.png") }
    ],
    SOUTH: [
      { name: "Idly (2 pcs)", price: 30, desc: "Light, healthy, and perfectly steamed idly", image: require("../../assets/Idlis.png") },
      { name: "Vada", price: 20, desc: "Crispy outside, soft inside — perfect vada", image: require("../../assets/Vada.png") },
      { name: "Poori Saagu", price: 70, desc: "Soft, puffed pooris served with spicy saggu", image: require("../../assets/Poori_saagu.png") },
      { name: "Akki Roti", price: 80, desc: "Soft, fluffy roti made from rice flour", image: require("../../assets/Akki_rotti.png") },
      { name: "Ragi Roti", price: 50, desc: "Nutritious roti made from ragi flour", image: require("../../assets/Ragi_rotti.png") },
      { name: "Aloo Bonda", price: 60, desc: "Crispy potato balls filled with spiced potatoes", image: require("../../assets/Aloo_bonda.png") },
      { name: "Masala Dosa", price: 70, desc: "Crispy dosa with chutney and sambar", image: require("../../assets/masala_dosa.png") }
    ],
    NORTH: [
      { name: "Hyderabadi Chicken Biryani", price: 150, desc: "Spiced basmati rice with tender chicken", image: require("../../assets/chicken_biryani.png") },
      { name: "Chole Bhature", price: 100, desc: "Spicy chickpeas with fried bread", image: require("../../assets/chole_bhature.png") },
      { name: "Pav Bhaji", price: 120, desc: "Butter-loaded pav with spicy bhaji", image: require("../../assets/pav_bhaaji.png") },
    ],
    DESSERTS: [
      { name: "Gulab Jamun", price: 50, desc: "Soft and sweet dessert", image: require("../../assets/gulab_jamun.png") },
      { name: "Fruit Custard", price: 100, desc: "Creamy custard with fruits", image: require("../../assets/fruit_custard.png") },
      { name: "Carrot Halwa", price: 60, desc: "Delicious carrot dessert", image: require("../../assets/carrot_halwa.png") },
      { name: "Brownie Sundae", price: 80, desc: "Chocolate brownie with ice cream", image: require("../../assets/brownie.png") }
    ],
    BEVERAGES: [
      { name: "Coffee", price: 40, desc: "Hot coffee", image: require("../../assets/coffee.png") },
      { name: "Tea", price: 40, desc: "Hot tea", image: require("../../assets/tea.png") },
      { name: "Kesar Badam Milkshake", price: 50, desc: "Rich milkshake", image: require("../../assets/badam_milk.png") },
      { name: "Butterscotch Milkshake", price: 60, desc: "Sweet shake", image: require("../../assets/butterscotch.png") },
      { name: "Chocolate Milk", price: 60, desc: "Cold chocolate milk", image: require("../../assets/choco_milk.png") },
      { name: "Lassi", price: 50, desc: "Refreshing drink", image: require("../../assets/lassi.png") },
      { name: "Lime Soda", price: 30, desc: "Tangy soda", image: require("../../assets/lime.png") }
    ],
    CHINESE: [
      { name: "Veg Manchurian", price: 70, desc: "Spicy veggie balls", image: require("../../assets/Veg_manchurian.png") },
      { name: "Chilly 65", price: 90, desc: "Spicy fried bites", image: require("../../assets/chilly_65.png") },
      { name: "Honey Chilly Potato", price: 80, desc: "Sweet & spicy potato", image: require("../../assets/honey_chilli.png") },
      { name: "Chicken Manchurian", price: 80, desc: "Chicken in sauce", image: require("../../assets/chicken_manchurian.png") },
      { name: "Gobi Noodles", price: 60, desc: "Noodles with gobi", image: require("../../assets/gobi.png") }
    ],
  };

  const items = menu[category] || [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView>

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <MaterialIcon name="arrow-back" size={28} color="black" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{category}</Text>
          <MaterialIcon name="search" size={26} color="black" />
        </View>

        {/* ITEMS */}
        {items.map((item: any, index: number) => {
          const isAvailable = availabilityMap[item.name] !== false;

          return (
            <View
              key={index}
              style={[
                styles.card,
                !isAvailable && { opacity: 0.5 } // grey effect
              ]}
            >
              <Image source={item.image} style={styles.image} />

              <View style={styles.row}>
                <Text style={styles.title}>{item.name}</Text>
                <Text style={styles.price}>₹{item.price}</Text>
              </View>

              <Text style={styles.desc}>{item.desc}</Text>

              {!isAvailable && (
                <Text style={{ color: "red", fontWeight: "bold", marginBottom: 5 }}>
                  Out of Stock
                </Text>
              )}

              <TouchableOpacity
                disabled={!isAvailable}
                style={[
                  styles.button,
                  !isAvailable && { backgroundColor: "#ccc" }
                ]}
                onPress={async () => {
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
                        quantity: 1,
                      });
                    }

                    navigation.navigate("Cart");
                  } catch (err: any) {
                    Alert.alert("❌ Error", err.message);
                  }
                }}
              >
                <Text style={styles.buttonText}>
                  {isAvailable ? "Add To Tummy" : "Unavailable"}
                </Text>
              </TouchableOpacity>

            </View>
          );
        })}

      </ScrollView>
    </SafeAreaView>
  );
}