import React, { useState, useEffect } from "react";
import {
  View, Text, Image, TextInput,
  TouchableOpacity, ScrollView, Switch, Modal
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import FeatherIcon from "react-native-vector-icons/Feather";
import { home as Homestyles } from "../styles/Studentstyles";
import { useNavigation } from "@react-navigation/native";
import firestore from "@react-native-firebase/firestore";

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
  const [searchText, setSearchText] = useState("");
  const [unavailableItems, setUnavailableItems] = useState<string[]>([]);
  const [selectedCanteen, setSelectedCanteen] = useState<string>("BIG MINGOS");
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  // ✅ FETCH UNAVAILABLE ITEMS FROM FIRESTORE
  useEffect(() => {
    const unsubscribe = firestore()
      .collection("menu")
      .where("available", "==", false)
      .where("canteen", "==", "BIG_MINGOS")
      .onSnapshot(snap => {
        const names = snap.docs.map(doc => doc.data().name);
        setUnavailableItems(names);
      });
    return () => unsubscribe();
  }, []);

  // ✅ SYNC CART QUANTITIES FROM FIRESTORE
  useEffect(() => {
    const unsubscribe = firestore()
      .collection("cart")
      .onSnapshot(snap => {
        const qtys: { [key: string]: number } = {};
        snap.docs.forEach(doc => {
          const data = doc.data();
          qtys[data.name] = data.quantity;
        });
        setQuantities(qtys);
      });
    return () => unsubscribe();
  }, []);

  const increaseQty = async (name: string, price: number) => {
    try {
      const cartRef = firestore().collection("cart");
      const existing = await cartRef.where("name", "==", name).get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        await cartRef.doc(doc.id).update({ quantity: doc.data().quantity + 1 });
      } else {
        await cartRef.add({ name, price, quantity: 1 });
      }
    } catch (err) {
      console.log("Error adding to cart:", err);
    }
  };

  const decreaseQty = async (name: string) => {
    try {
      const cartRef = firestore().collection("cart");
      const existing = await cartRef.where("name", "==", name).get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        const qty = doc.data().quantity;
        if (qty <= 1) {
          await cartRef.doc(doc.id).delete();
        } else {
          await cartRef.doc(doc.id).update({ quantity: qty - 1 });
        }
      }
    } catch (err) {
      console.log("Error decreasing cart:", err);
    }
  };

  const getTotalItems = () =>
    Object.values(quantities).reduce((sum, qty) => sum + qty, 0);

  const vegItems = [
    { name: "Masala Dosa", desc: "Crispy dosa with chutney and sambar", price: 70, img: require("../../assets/masala_dosa.png") },
    { name: "Gobi Noodles", desc: "Spicy noodles with cauliflower", price: 70, img: require("../../assets/gobi.png") },
    { name: "Sandwich", desc: "Grilled sandwich with veggies", price: 80, img: require("../../assets/sandwich.png") },
    { name: "Peri Peri Fries", desc: "Spicy fries with peri peri masala", price: 120, img: require("../../assets/peri_peri_fries.png") },
  ];

  const nonVegItems = [
    { name: "Hyderabadi Chicken Biryani", desc: "Aromatic chicken rice", price: 150, img: require("../../assets/chicken_biryani.png") },
    { name: "Chicken Popcorn", desc: "Bite-sized chunks of boneless chicken, crispy and golden", price: 130, img: require("../../assets/chicken_popcorn.png") },
    { name: "Chicken Manchurian", desc: "Chicken tossed in a tangy, spicy and slightly sweet sauce", price: 100, img: require("../../assets/chicken_manchurian.png") },
  ];

  const allItems = [
    ...vegItems, ...nonVegItems,
    { name: "Potato Bites", price: 80, desc: "Golden crispy potato bites perfect for snacking", img: require("../../assets/potato_bites.png") },
    { name: "Boiled Egg", price: 25, desc: "Two fresh boiled eggs, simple and protein rich", img: require("../../assets/eggs.png") },
    { name: "Omelette", price: 180, desc: "Soft egg omelette filled with flavorful chicken and light spices", img: require("../../assets/Omelette.png") },
    { name: "Idli (2 pcs)", price: 30, desc: "Light, healthy, and perfectly steamed idly", img: require("../../assets/Idlis.png") },
    { name: "Vada", price: 20, desc: "Crispy outside, soft inside — perfect vada", img: require("../../assets/Vada.png") },
    { name: "Poori Saagu", price: 70, desc: "Soft, puffed pooris served with spicy saggu", img: require("../../assets/Poori_saagu.png") },
    { name: "Akki Roti", price: 80, desc: "Soft, fluffy roti made from rice flour", img: require("../../assets/Akki_rotti.png") },
    { name: "Ragi Roti", price: 50, desc: "Nutritious roti made from ragi flour", img: require("../../assets/Ragi_rotti.png") },
    { name: "Aloo Bonda", price: 60, desc: "Crispy potato balls filled with spiced potatoes", img: require("../../assets/Aloo_bonda.png") },
    { name: "Chole Bhature", price: 100, desc: "Spicy chickpeas served with deep-fried bread", img: require("../../assets/chole_bhature.png") },
    { name: "Pav Bhaji", price: 120, desc: "Butter-loaded pav with spicy bhaji", img: require("../../assets/pav_bhaaji.png") },
    { name: "Gulab Jamun", price: 50, desc: "Soft, juicy, and soaked in sweetness", img: require("../../assets/gulab_jamun.png") },
    { name: "Fruit Custard", price: 100, desc: "Creamy custard topped with fruits & ice cream", img: require("../../assets/fruit_custard.png") },
    { name: "Carrot Halwa", price: 60, desc: "Creamy and delicious halwa made with carrots", img: require("../../assets/carrot_halwa.png") },
    { name: "Brownie Sundae", price: 80, desc: "Chocolatey, gooey, and absolutely irresistible", img: require("../../assets/brownie.png") },
    { name: "Coffee", price: 40, desc: "Strong, warm, and comforting", img: require("../../assets/coffee.png") },
    { name: "Tea", price: 40, desc: "A cup of calm in every sip", img: require("../../assets/tea.png") },
    { name: "Kesar Badam Milkshake", price: 50, desc: "Rich, creamy, and full of kesar-badam goodness", img: require("../../assets/badam_milk.png") },
    { name: "Butterscotch Milkshake", price: 60, desc: "Creamy, sweet, and butterscotch bliss", img: require("../../assets/butterscotch.png") },
    { name: "Chocolate Milk", price: 60, desc: "Sweet, chilled, and refreshing", img: require("../../assets/choco_milk.png") },
    { name: "Lassi", price: 50, desc: "Thick, chilled, and soothing", img: require("../../assets/lassi.png") },
    { name: "Lime Soda", price: 30, desc: "Refreshing and tangy, made with fresh lime juice", img: require("../../assets/lime.png") },
    { name: "Veg Manchurian", price: 70, desc: "Crispy veggie balls tossed in a spicy sauce", img: require("../../assets/Veg_manchurian.png") },
    { name: "Chilly 65", price: 90, desc: "Deep-fried bites tossed in a fiery chili sauce with garlic and spices", img: require("../../assets/chilly_65.png") },
    { name: "Honey Chilly Potato", price: 80, desc: "Crispy potatoes in sweet & spicy honey chilli sauce", img: require("../../assets/honey_chilli.png") },
  ];

  const filteredItems = searchText.length > 0
    ? allItems.filter(item => item.name.toLowerCase().includes(searchText.toLowerCase()))
    : [];

  const renderFoodCard = (item: any) => {
    const isUnavailable = unavailableItems.includes(item.name) && selectedCanteen === "BIG MINGOS";
    return (
      <View key={item.name} style={[Homestyles.card, isUnavailable && { opacity: 0.4 }]}>
        <View style={{ flex: 1 }}>
          <Text style={Homestyles.title}>{item.name}</Text>
          <Text style={Homestyles.desc}>{item.desc}</Text>
          {isUnavailable ? (
            <Text style={{ color: "red", fontWeight: "bold", marginTop: 6 }}>
              Currently Unavailable
            </Text>
          ) : (
            <View style={Homestyles.priceRow}>
              <TouchableOpacity style={Homestyles.qtyBtn} onPress={() => decreaseQty(item.name)}>
                <Text>-</Text>
              </TouchableOpacity>
              <Text style={Homestyles.price}>
                ₹{item.price} ({quantities[item.name] || 0})
              </Text>
              <TouchableOpacity style={Homestyles.qtyBtn} onPress={() => increaseQty(item.name, item.price)}>
                <Text>+</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <View style={Homestyles.foodBox}>
          <Image source={item.img} style={Homestyles.foodImg} />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <View style={Homestyles.container}>

          {/* ✅ NEW HEADER WITH LOGO + DROPDOWN */}
          <View style={Homestyles.header}>
            <View style={{ alignItems: "center" }}>
              <Text style={Homestyles.location}>LOCATION</Text>
              <TouchableOpacity
                onPress={() => setShowDropdown(true)}
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <Text style={Homestyles.place}>{selectedCanteen}</Text>
                <MaterialIcon name="keyboard-arrow-down" size={24} color="black" />
              </TouchableOpacity>
            </View>

            <Image
              source={require("../../assets/logo_text.png")}
              style={Homestyles.logoCenter}
            />

            <FeatherIcon name="bell" size={30} color="black" />
          </View>

          {/* ✅ CANTEEN DROPDOWN MODAL */}
          <Modal visible={showDropdown} transparent animationType="fade">
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setShowDropdown(false)}
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.20)", justifyContent: "flex-start", paddingTop: 90, alignItems: "center" }}
            >
              <View style={{ width: "72%", backgroundColor: "#fff", borderRadius: 18, paddingVertical: 8, elevation: 8 }}>
                {["BIG MINGOS", "M.M Foods (Library)", "M.M Foods (Admin Block)"].map((item, index) => (
                  <TouchableOpacity
                    key={item}
                    onPress={() => {
                      setSelectedCanteen(item);
                      setShowDropdown(false);
                      if (item === "M.M Foods (Admin Block)") navigation.navigate("MMAdminBlock");
                      if (item === "M.M Foods (Library)") navigation.navigate("MMLibrary");
                    }}
                    style={{ paddingVertical: 16, paddingHorizontal: 18, borderBottomWidth: index !== 2 ? 1 : 0, borderBottomColor: "#f1f1f1" }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: "600", color: selectedCanteen === item ? "#E53935" : "#222" }}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

          {/* ✅ NEW SEARCH WITH MATERIAL ICONS */}
          <View style={Homestyles.searchRow}>
            <View style={Homestyles.searchBox}>
              <MaterialIcon name="search" size={24} color="black" />
              <TextInput
                placeholder="Search food..."
                style={{ flex: 1 }}
                value={searchText}
                onChangeText={setSearchText}
              />
              {searchText.length > 0 ? (
                <TouchableOpacity onPress={() => setSearchText("")}>
                  <MaterialIcon name="close" size={22} color="black" />
                </TouchableOpacity>
              ) :(null)}
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
          {searchText.length === 0 && (
            <View style={Homestyles.grid}>
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
                  style={Homestyles.category}
                  onPress={() => navigation.navigate("Category", { category: c.cat })}
                >
                  <Image source={c.img} style={Homestyles.catImage} />
                  <Text style={Homestyles.catText}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false}>
            {searchText.length > 0 ? (
              <>
                <Text style={Homestyles.section}>
                  {filteredItems.length > 0 ? `Results for "${searchText}"` : `No results for "${searchText}"`}
                </Text>
                {filteredItems.map(renderFoodCard)}
              </>
            ) : (
              <>
                <Text style={Homestyles.section}>MOST POPULAR 🤤</Text>
                {isEnabled ? vegItems.map(renderFoodCard) : nonVegItems.map(renderFoodCard)}
              </>
            )}
          </ScrollView>

          {/* ✅ NEW BOTTOM NAV WITH MATERIAL ICONS */}
          <View style={{ flexDirection: "row", justifyContent: "space-around", marginTop: 10, paddingVertical: 10 }}>
            <MaterialIcon name="home" size={30} color="black" />

            <TouchableOpacity onPress={() => navigation.navigate("Cart")}>
              <View>
                <MaterialIcon name="shopping-cart" size={30} color="black" />
                {getTotalItems() > 0 && (
                  <View style={{
                    position: "absolute", top: -5, right: -5,
                    backgroundColor: "red", borderRadius: 10,
                    width: 18, height: 18, alignItems: "center", justifyContent: "center"
                  }}>
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "bold" }}>
                      {getTotalItems()}
                    </Text>
                  </View>
                )}
              </View>
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