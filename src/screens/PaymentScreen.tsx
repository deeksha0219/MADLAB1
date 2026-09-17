import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import firestore from "@react-native-firebase/firestore";

export default function PaymentScreen({ navigation, route }: any) {
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const total = route.params?.total || 0;
  const pickupTime = route.params?.pickupTime || "Not selected";

  const upiMethods = [
    {
      id: "phonepe",
      label: "PhonePe",
      icon: require("../../assets/phonepe.png"),
    },
    {
      id: "googlepay",
      label: "Google Pay",
      icon: require("../../assets/gpay.png"),
    },
    {
      id: "paytm",
      label: "Paytm",
      icon: require("../../assets/paytm.png"),
    },
  ];

  const cashMethods = [
    {
      id: "cash",
      label: "Pay at Counter",
      emoji: "💵",
    },
    {
      id: "scan",
      label: "Scan the QR Code",
      emoji: "📱",
    },
  ];

  // --------------------------------------------------
  // PAYMENT LABEL
  // --------------------------------------------------

  const getPaymentLabel = () => {
    if (selected === "cash") {
      return "Pay at Counter";
    }

    if (selected === "scan") {
      return "QR Payment";
    }

    return "Paid Online";
  };

  // --------------------------------------------------
  // ORDER ID
  // Example: GNG-8F3K29
  // --------------------------------------------------

  const generateOrderId = () => {
    const timePart = Date.now().toString(36).toUpperCase().slice(-5);

    const randomPart = Math.random()
      .toString(36)
      .substring(2, 5)
      .toUpperCase();

    return `GNG-${timePart}${randomPart}`;
  };

  // --------------------------------------------------
  // REFERENCE ID
  // Example: REF-583921
  // --------------------------------------------------

  const generateReferenceId = () => {
    const randomNumber = Math.floor(
      100000 + Math.random() * 900000
    );

    return `REF-${randomNumber}`;
  };

  // --------------------------------------------------
  // PLACE ORDER
  // --------------------------------------------------

  const placeOrder = async () => {
    if (placing) {
      return;
    }

    if (!selected) {
      Alert.alert(
        "Select Payment",
        "Please select a payment method."
      );
      return;
    }

    setPlacing(true);

    try {
      // ----------------------------------------------
      // 1. GET CURRENT CART
      // ----------------------------------------------

      const cartSnap = await firestore()
        .collection("cart")
        .get();

      if (cartSnap.empty) {
        Alert.alert(
          "Cart is empty",
          "Add items before placing an order."
        );

        setPlacing(false);
        return;
      }

      // ----------------------------------------------
      // 2. CONVERT CART INTO ARRAY
      // ----------------------------------------------

      const cartItems = cartSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as any[];

      // ----------------------------------------------
      // 3. GENERATE ORDER + REFERENCE IDS
      // ----------------------------------------------

      const orderId = generateOrderId();
      const referenceId = generateReferenceId();

      // ----------------------------------------------
      // 4. PREPARE ITEMS FOR SERVICE DESK
      // ----------------------------------------------

      const serviceDeskItems = cartItems.map((item) => ({
        id: item.id,
        name: item.name,
        price: Number(item.price) || 0,
        quantity: Number(item.quantity) || 1,
      }));

      // ----------------------------------------------
      // 5. CREATE ORDER DOCUMENT
      // ----------------------------------------------
      //
      // This collection is the IMPORTANT one.
      //
      // Service Desk should listen to:
      //
      // firestore()
      //   .collection("orders")
      //   .onSnapshot(...)
      //
      // ----------------------------------------------

      const orderData = {
        orderId: orderId,
        referenceId: referenceId,

        customerName: "Student",

        pickupTime: pickupTime,

        items: serviceDeskItems,

        total: Number(total) || 0,

        payment: getPaymentLabel(),

        // New order waiting for Service Desk
        status: "new",

        // Service Desk redemption
        redeemed: false,
        redeemedAt: null,

        // Firebase server timestamp
        placedAt: firestore.FieldValue.serverTimestamp(),

        createdAt: firestore.FieldValue.serverTimestamp(),
      };

      // ----------------------------------------------
      // 6. SAVE TO "orders"
      // ----------------------------------------------
      //
      // SERVICE DESK / ADMIN DASHBOARD
      //
      // ----------------------------------------------

      const orderRef = await firestore()
        .collection("orders")
        .add(orderData);

      console.log("ORDER CREATED");
      console.log("Firestore ID:", orderRef.id);
      console.log("Order ID:", orderId);
      console.log("Reference ID:", referenceId);

      // ----------------------------------------------
      // 7. SAVE TO STUDENT ORDER HISTORY
      // ----------------------------------------------

      await firestore()
        .collection("orderHistory")
        .add({
          orderId: orderId,
          referenceId: referenceId,

          items: cartItems,

          total: Number(total) || 0,

          pickupTime: pickupTime,

          placedAt: firestore.FieldValue.serverTimestamp(),

          status: "new",

          payment: getPaymentLabel(),
        });

      // ----------------------------------------------
      // 8. CLEAR CART
      // ----------------------------------------------

      const batch = firestore().batch();

      cartSnap.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      // ----------------------------------------------
      // 9. GO TO ORDER CONFIRMED
      // ----------------------------------------------

      navigation.navigate("OrderConfirmed", {
        orderId: orderId,
        referenceId: referenceId,
      });

    } catch (error) {
      console.log("================================");
      console.log("ORDER PLACEMENT ERROR");
      console.log(error);
      console.log("================================");

      Alert.alert(
        "Order Failed",
        "Something went wrong while placing your order. Please try again."
      );
    } finally {
      setPlacing(false);
    }
  };

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#f2f2f2",
      }}
    >
      {/* HEADER */}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 15,
          gap: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
        >
          <Text
            style={{
              fontSize: 22,
            }}
          >
            ←
          </Text>
        </TouchableOpacity>

        <Text
          style={{
            fontSize: 18,
            fontWeight: "bold",
          }}
        >
          Total Bill : ₹{total}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 15,
          paddingBottom: 30,
        }}
      >
        {/* PICKUP TIME */}

        <View
          style={{
            backgroundColor: "#fff",
            padding: 15,
            borderRadius: 12,
            marginBottom: 15,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: "gray",
            }}
          >
            Pickup Time
          </Text>

          <Text
            style={{
              fontWeight: "bold",
            }}
          >
            ⏰ {pickupTime}
          </Text>
        </View>

        {/* UPI */}

        <Text
          style={{
            color: "gray",
            fontSize: 13,
            marginBottom: 10,
          }}
        >
          Pay By Any UPI App
        </Text>

        {upiMethods.map((method) => (
          <TouchableOpacity
            key={method.id}
            onPress={() => setSelected(method.id)}
            disabled={placing}
            style={{
              flexDirection: "row",
              alignItems: "center",

              backgroundColor:
                selected === method.id
                  ? "#ffe5de"
                  : "#fff",

              padding: 15,
              borderRadius: 12,
              marginBottom: 10,

              borderWidth:
                selected === method.id ? 2 : 0,

              borderColor: "#DF401C",

              elevation: 1,
            }}
          >
            <Image
              source={method.icon}
              style={{
                width: 36,
                height: 36,
                marginRight: 15,
                resizeMode: "contain",
              }}
            />

            <Text
              style={{
                fontSize: 16,
              }}
            >
              {method.label}
            </Text>
          </TouchableOpacity>
        ))}

        {/* CASH */}

        <Text
          style={{
            color: "gray",
            fontSize: 13,
            marginTop: 10,
            marginBottom: 10,
          }}
        >
          CASH
        </Text>

        {cashMethods.map((method) => (
          <TouchableOpacity
            key={method.id}
            onPress={() => setSelected(method.id)}
            disabled={placing}
            style={{
              flexDirection: "row",
              alignItems: "center",

              backgroundColor:
                selected === method.id
                  ? "#ffe5de"
                  : "#fff",

              padding: 15,
              borderRadius: 12,
              marginBottom: 10,

              borderWidth:
                selected === method.id ? 2 : 0,

              borderColor: "#DF401C",

              elevation: 1,
            }}
          >
            <Text
              style={{
                fontSize: 24,
                marginRight: 15,
              }}
            >
              {method.emoji}
            </Text>

            <Text
              style={{
                fontSize: 16,
              }}
            >
              {method.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* PLACE ORDER BUTTON */}

      <View
        style={{
          padding: 15,
        }}
      >
        <TouchableOpacity
          onPress={placeOrder}
          disabled={!selected || placing}
          style={{
            backgroundColor:
              selected && !placing
                ? "#DF401C"
                : "#ccc",

            padding: 18,
            borderRadius: 14,
            alignItems: "center",

            flexDirection: "row",
            justifyContent: "center",
            gap: 10,
          }}
        >
          {placing && (
            <ActivityIndicator
              color="#fff"
              size="small"
            />
          )}

          <Text
            style={{
              color: "#fff",
              fontWeight: "bold",
              fontSize: 16,
            }}
          >
            {placing
              ? "Placing Order..."
              : "Order My Food"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}