import React, { useState, useEffect } from "react";
import {
  View, Text, Image, TextInput,
  TouchableOpacity, ScrollView, Switch, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import FeatherIcon from "react-native-vector-icons/Feather";
import { home } from "../styles/Studentstyles";
import { useNavigation } from "@react-navigation/native";
import firestore from "@react-native-firebase/firestore";

export default function MMLibraryScreen() {
  const navigation = useNavigation<any>();

  const [isEnabled, setIsEnabled] = useState(true);
  const [selectedCanteen, setSelectedCanteen] = useState("M.M Foods (Library)");
  const [showDropdown, setShowDropdown] = useState(false);
  const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
  const [unavailableItems, setUnavailableItems] = useState<string[]>([]);

  // Sync cart quantities from Firestore
  useEffect(() => {
  const unsubscribe = firestore()
    .collection("cart")
    .onSnapshot(snap => {
      const qtys: any = {};
      snap.docs.forEach(doc => {
        const data = doc.data();
        qtys[data.name] = data.quantity;
      });
      setQuantities(qtys);
    });

  return () => unsubscribe();
}, []);

  // Fetch unavailable items
  useEffect(() => {
  const unsubscribe = firestore()
    .collection("menu")
    .where("canteen", "==", "MM_LIBRARY") // 🔥 ONLY THIS FILTER
    .onSnapshot(snap => {
      const unavailable: string[] = [];

      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.available === false) {
          unavailable.push(data.name);
        }
      });

      setUnavailableItems(unavailable);
    });

  return () => unsubscribe();
}, []);

  const increaseQty = async (name: string, price: number) => {
  try {
    const cartRef = firestore().collection("cart");
    const existing = await cartRef.where("name", "==", name).get();

    if (!existing.empty) {
      const doc = existing.docs[0];
      await cartRef.doc(doc.id).update({
        quantity: doc.data().quantity + 1,
      });
    } else {
      await cartRef.add({
        name,
        price,
        quantity: 1,
      });
    }

  } catch (err) {
    console.log("Error:", err);
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
    console.log(err);
  }
};

  const renderCard = (name: string, desc: string, price: number, img: any) => {
    const isUnavailable = unavailableItems.includes(name);
    return (
      <View key={name} style={[home.card, isUnavailable && { opacity: 0.4 }]}>
        <View style={{ flex: 1 }}>
          <Text style={home.title}>{name}</Text>
          <Text style={home.desc}>{desc}</Text>
          {isUnavailable ? (
            <Text style={{ color: "red", fontWeight: "bold", marginTop: 6 }}>
              Currently Unavailable
            </Text>
          ) : (
            <View style={home.priceRow}>
              <TouchableOpacity style={home.qtyBtn} onPress={() => decreaseQty(name)}>
                <Text>-</Text>
              </TouchableOpacity>
              <Text style={home.price}>₹{price} ({quantities[name] || 0})</Text>
              <TouchableOpacity style={home.qtyBtn} onPress={() => increaseQty(name, price)}>
                <Text>+</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <View style={home.foodBox}>
          <Image source={img} style={home.foodImg} />
        </View>
      </View>
    );
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
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.20)", justifyContent: "flex-start", paddingTop: 90, alignItems: "center" }}
            >
              <View style={{ width: "72%", backgroundColor: "#fff", borderRadius: 18, paddingVertical: 8, elevation: 8 }}>
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
                onPress={() => navigation.navigate("MMLibraryCategory", { category: c.cat })}
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
                {renderCard("Masala Dosa", "Fresh dosa with chutney", 60, require("../../assets/masala_dosa.png"))}
                {renderCard("Gobi Noodles", "Spicy noodles with cauliflower", 70, require("../../assets/gobi.png"))}
                {renderCard("Gobi Rice", "Spicy cauliflower rice", 80, require("../../assets/chinese.png"))}
                {renderCard("Peri Peri Fries", "Spicy fries with peri peri masala", 100, require("../../assets/peri_peri_fries.png"))}
              </>
            )}

            {!isEnabled && (
              <>
                {renderCard("Chicken Burger", "Juicy chicken burger", 90, require("../../assets/chicken_burger.png"))}
              </>
            )}
          </ScrollView>

          {/* BOTTOM NAV */}
          <View style={{ flexDirection: "row", justifyContent: "space-around", marginTop: 10 }}>
            <TouchableOpacity onPress={() => navigation.navigate("MMLibrary")}>
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