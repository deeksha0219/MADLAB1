import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import { categoryStyles as styles } from "../styles/Studentstyles";
import firestore from "@react-native-firebase/firestore";
import auth from "@react-native-firebase/auth";
import { formatPaiseToRupees } from "../services/catalogService";
import { setUserCartItem, removeUserCartItem } from "../services/orderService";
import { getActiveEnvironmentConfig } from "../config/environment";

export default function CategoryScreen({ route, navigation }: any) {
  const { category, canteenId = "BIG_MINGOS" } = route.params;

  const [availabilityMap, setAvailabilityMap] = useState<any>({});
  const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
  const [firestoreItems, setFirestoreItems] = useState<any[] | null>(null);
  const [_loading, setLoading] = useState<boolean>(false);
  const [_error, setError] = useState<string | null>(null);

  // Fetch items dynamically from Firestore catalog subcollection
  const fetchCategoryItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await firestore()
        .collection("canteens")
        .doc(canteenId)
        .collection("items")
        .where("categoryId", "==", category)
        .where("isActive", "==", true)
        .where("isAvailable", "==", true)
        .get();

      if (!snap.empty) {
        const loaded = snap.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            name: d.name,
            price: Math.floor((d.priceInPaise || 0) / 100),
            priceInPaise: d.priceInPaise,
            desc: d.description || "",
            imageUrl: d.imageUrl,
            image: null,
          };
        });
        setFirestoreItems(loaded);
      }
    } catch {
      setError("Could not refresh live items. Showing cached items.");
    } finally {
      setLoading(false);
    }
  }, [canteenId, category]);

  useEffect(() => {
    fetchCategoryItems();
  }, [fetchCategoryItems]);

  // --------------------------------------------------
  // CHECK FOOD AVAILABILITY FROM CANTEEN CATALOG
  // --------------------------------------------------

  useEffect(() => {
    const unsubscribe = firestore()
      .collection("canteens")
      .doc(canteenId)
      .collection("items")
      .where("categoryId", "==", category)
      .onSnapshot((snapshot) => {
        const map: any = {};

        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          map[doc.id] = data.isAvailable !== false;
          map[data.name] = data.isAvailable !== false;
        });

        setAvailabilityMap(map);
      });

    return () => unsubscribe();
  }, [canteenId, category]);

  // --------------------------------------------------
  // SYNC CART QUANTITIES FROM USER-SCOPED CART
  // --------------------------------------------------

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
      .onSnapshot((snap) => {
        const qtys: { [key: string]: number } = {};

        snap.docs.forEach((doc) => {
          const data = doc.data();
          qtys[doc.id] = data.quantity;
          if (data.name) qtys[data.name] = data.quantity;
        });

        setQuantities(qtys);
      });

    return () => unsubscribe();
  }, []);

  // --------------------------------------------------
  // INCREASE QUANTITY (USER CART)
  // --------------------------------------------------

  const increaseQty = async (itemId: string, name: string) => {
    try {
      const currentUid = auth().currentUser?.uid;
      if (!currentUid) {
        Alert.alert("Authentication Required", "Please sign in to add items to your cart.");
        return;
      }

      const current = quantities[itemId] || quantities[name] || 0;
      if (current >= 99) return;

      await setUserCartItem(currentUid, {
        itemId,
        canteenId,
        quantity: current + 1,
      });
    } catch (err: any) {
      Alert.alert("❌ Error", err.message);
    }
  };

  // --------------------------------------------------
  // DECREASE QUANTITY (USER CART)
  // --------------------------------------------------

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
          canteenId,
          quantity: current - 1,
        });
      }
    } catch (err: any) {
      Alert.alert("❌ Error", err.message);
    }
  };

  // --------------------------------------------------
  // MENU
  // --------------------------------------------------

  const menu: any = {
    SNACKS: [
      {
        name: "Potato Bites",
        price: 80,
        desc: "Golden crispy potato bites perfect for snacking",
        image: require("../../assets/potato_bites.png"),
      },
      {
        name: "Chicken Popcorn",
        price: 90,
        desc: "Juicy chicken popcorn coated in a crunchy and flavorful crust",
        image: require("../../assets/chicken_popcorn.png"),
      },
      {
        name: "Boiled Egg",
        price: 25,
        desc: "Two fresh boiled eggs, simple and protein rich",
        image: require("../../assets/eggs.png"),
      },
      {
        name: "Omelette",
        price: 180,
        desc: "Soft egg omelette filled with flavorful chicken and light spices",
        image: require("../../assets/Omelette.png"),
      },
      {
        name: "Peri Peri Fries",
        price: 120,
        desc: "Crispy fries seasoned with peri peri spices",
        image: require("../../assets/peri_peri_fries.png"),
      },
      {
        name: "Sandwich",
        price: 60,
        desc: "Fresh vegetables and cheese in a toasted bread",
        image: require("../../assets/sandwich.png"),
      },
    ],

    SOUTH: [
      {
        name: "Idly (2 pcs)",
        price: 30,
        desc: "Light, healthy, and perfectly steamed idly",
        image: require("../../assets/Idlis.png"),
      },
      {
        name: "Vada",
        price: 20,
        desc: "Crispy outside, soft inside — perfect vada",
        image: require("../../assets/Vada.png"),
      },
      {
        name: "Poori Saagu",
        price: 70,
        desc: "Soft, puffed pooris served with spicy saggu",
        image: require("../../assets/Poori_saagu.png"),
      },
      {
        name: "Akki Roti",
        price: 80,
        desc: "Soft, fluffy roti made from rice flour",
        image: require("../../assets/Akki_rotti.png"),
      },
      {
        name: "Ragi Roti",
        price: 50,
        desc: "Nutritious roti made from ragi flour",
        image: require("../../assets/Ragi_rotti.png"),
      },
      {
        name: "Aloo Bonda",
        price: 60,
        desc: "Crispy potato balls filled with spiced potatoes",
        image: require("../../assets/Aloo_bonda.png"),
      },
      {
        name: "Masala Dosa",
        price: 70,
        desc: "Crispy dosa with chutney and sambar",
        image: require("../../assets/masala_dosa.png"),
      },
    ],

    NORTH: [
      {
        name: "Hyderabadi Chicken Biryani",
        price: 150,
        desc: "Spiced basmati rice with tender chicken",
        image: require("../../assets/chicken_biryani.png"),
      },
      {
        name: "Chole Bhature",
        price: 100,
        desc: "Spicy chickpeas with fried bread",
        image: require("../../assets/chole_bhature.png"),
      },
      {
        name: "Pav Bhaji",
        price: 120,
        desc: "Butter-loaded pav with spicy bhaji",
        image: require("../../assets/pav_bhaaji.png"),
      },
    ],

    DESSERTS: [
      {
        name: "Gulab Jamun",
        price: 50,
        desc: "Soft and sweet dessert",
        image: require("../../assets/gulab_jamun.png"),
      },
      {
        name: "Fruit Custard",
        price: 100,
        desc: "Creamy custard with fruits",
        image: require("../../assets/fruit_custard.png"),
      },
      {
        name: "Carrot Halwa",
        price: 60,
        desc: "Delicious carrot dessert",
        image: require("../../assets/carrot_halwa.png"),
      },
      {
        name: "Brownie Sundae",
        price: 80,
        desc: "Chocolate brownie with ice cream",
        image: require("../../assets/brownie.png"),
      },
    ],

    BEVERAGES: [
      {
        name: "Coffee",
        price: 40,
        desc: "Hot coffee",
        image: require("../../assets/coffee.png"),
      },
      {
        name: "Tea",
        price: 40,
        desc: "Hot tea",
        image: require("../../assets/tea.png"),
      },
      {
        name: "Kesar Badam Milkshake",
        price: 50,
        desc: "Rich milkshake",
        image: require("../../assets/badam_milk.png"),
      },
      {
        name: "Butterscotch Milkshake",
        price: 60,
        desc: "Sweet shake",
        image: require("../../assets/butterscotch.png"),
      },
      {
        name: "Chocolate Milk",
        price: 60,
        desc: "Cold chocolate milk",
        image: require("../../assets/choco_milk.png"),
      },
      {
        name: "Lassi",
        price: 50,
        desc: "Refreshing drink",
        image: require("../../assets/lassi.png"),
      },
      {
        name: "Lime Soda",
        price: 30,
        desc: "Tangy soda",
        image: require("../../assets/lime.png"),
      },
    ],

    CHINESE: [
      {
        name: "Veg Manchurian",
        price: 70,
        desc: "Spicy veggie balls",
        image: require("../../assets/Veg_manchurian.png"),
      },
      {
        name: "Chilly 65",
        price: 90,
        desc: "Spicy fried bites",
        image: require("../../assets/chilly_65.png"),
      },
      {
        name: "Honey Chilly Potato",
        price: 80,
        desc: "Sweet & spicy potato",
        image: require("../../assets/honey_chilli.png"),
      },
      {
        name: "Chicken Manchurian",
        price: 80,
        desc: "Chicken in sauce",
        image: require("../../assets/chicken_manchurian.png"),
      },
      {
        name: "Gobi Noodles",
        price: 60,
        desc: "Noodles with gobi",
        image: require("../../assets/gobi.png"),
      },
    ],
  };

  const isStagingOrProd = getActiveEnvironmentConfig().environment !== 'local';
  const items = firestoreItems && firestoreItems.length > 0 ? firestoreItems : (isStagingOrProd ? [] : (menu[category] || []));

  // --------------------------------------------------
  // TOTAL ITEMS IN CART
  // --------------------------------------------------

  const totalItems = Object.values(quantities).reduce(
    (total, qty) => total + qty,
    0
  );

  // --------------------------------------------------
  // SCREEN
  // --------------------------------------------------

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#fff",
      }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingBottom: totalItems > 0 ? 80 : 20,
        }}
      >

        {/* HEADER */}

        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
          >
            <MaterialIcon
              name="arrow-back"
              size={28}
              color="black"
            />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>
            {category}
          </Text>
        </View>

        {items.length === 0 && (
          <View style={{ alignItems: "center", marginTop: 40 }}>
            <Text style={{ color: "#888", fontSize: 16 }}>
              No items currently available in this category.
            </Text>
          </View>
        )}

        {/* LIST */}

        {items.map((item: any, index: number) => {
          const itemId = item.id || `demo_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          const isAvailable =
            availabilityMap[itemId] !== undefined
              ? availabilityMap[itemId]
              : availabilityMap[item.name] !== undefined
              ? availabilityMap[item.name]
              : item.isAvailable !== undefined
              ? item.isAvailable
              : true;

          const qty =
            quantities[itemId] || quantities[item.name] || 0;

          return (
            <View
              key={item.id || index}
              style={[
                styles.card,
                !isAvailable && {
                  opacity: 0.5,
                },
              ]}
            >

              {/* FOOD IMAGE */}

              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.image}
                />
              ) : item.image ? (
                <Image
                  source={item.image}
                  style={styles.image}
                />
              ) : null}

              {/* NAME + PRICE */}

              <View style={styles.row}>
                <Text style={styles.title}>
                  {item.name}
                </Text>

                <Text style={styles.price}>
                  {typeof item.priceInPaise === "number"
                    ? formatPaiseToRupees(item.priceInPaise)
                    : `₹${item.price}`}
                </Text>
              </View>

              {/* DESCRIPTION */}

              <Text style={styles.desc}>
                {item.desc}
              </Text>

              {/* OUT OF STOCK */}

              {!isAvailable && (
                <Text
                  style={{
                    color: "red",
                    fontWeight: "bold",
                    marginBottom: 5,
                  }}
                >
                  Out of Stock
                </Text>
              )}

              {/* QUANTITY STEPPER */}

              {isAvailable && qty > 0 ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#DF401C",
                    borderRadius: 8,
                    paddingVertical: 8,
                  }}
                >

                  {/* MINUS */}

                  <TouchableOpacity
                    onPress={() =>
                      decreaseQty(itemId, item.name)
                    }
                    style={{
                      paddingHorizontal: 18,
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 18,
                        fontWeight: "bold",
                      }}
                    >
                      -
                    </Text>
                  </TouchableOpacity>

                  {/* QUANTITY */}

                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 16,
                      fontWeight: "bold",
                    }}
                  >
                    {qty}
                  </Text>

                  {/* PLUS */}

                  <TouchableOpacity
                    onPress={() =>
                      increaseQty(itemId, item.name)
                    }
                    style={{
                      paddingHorizontal: 18,
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 18,
                        fontWeight: "bold",
                      }}
                    >
                      +
                    </Text>
                  </TouchableOpacity>

                </View>
              ) : (

                /* ADD TO TUMMY */

                <TouchableOpacity
                  disabled={!isAvailable}
                  style={[
                    styles.button,
                    !isAvailable && {
                      backgroundColor: "#ccc",
                    },
                  ]}
                  onPress={() =>
                    increaseQty(itemId, item.name)
                  }
                >
                  <Text style={styles.buttonText}>
                    {isAvailable
                      ? "Add To Tummy"
                      : "Unavailable"}
                  </Text>
                </TouchableOpacity>

              )}

            </View>
          );
        })}

      </ScrollView>

      {/* ================================================== */}
      {/* BOTTOM CART BAR */}
      {/* ================================================== */}

      {totalItems > 0 && (
        <View
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            right: 12,
            height: 48,
            backgroundColor: "#DF401C",
            borderRadius: 10,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 20,
            elevation: 10,
            zIndex: 999,
          }}
        >
          <Text
            style={{
              color: "#000",
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            {totalItems} Item added
          </Text>

          <TouchableOpacity
            onPress={() =>
              navigation.navigate("Cart")
            }
            activeOpacity={0.7}
            style={{
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: "#000",
                fontSize: 15,
                fontWeight: "600",
              }}
            >
              View cart
            </Text>

            <MaterialIcon
              name="keyboard-arrow-up"
              size={22}
              color="#000"
            />
          </TouchableOpacity>
        </View>
      )}

    </SafeAreaView>
  );
}