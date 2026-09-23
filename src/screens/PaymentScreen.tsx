import React, { useRef, useState } from "react";
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
import { createOrderCallable } from "../services/orderService";
import { createDemoPaymentCallable } from "../services/paymentService";

function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function PaymentScreen({ navigation, route }: any) {
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const idempotencyKeyRef = useRef<string>(generateUuid());

  const total = route.params?.total || 0;
  const pickupTime = route.params?.pickupTime || "Not selected";

  // Generic Demo Labels (Step 9 Correction 1)
  const upiMethods = [
    {
      id: "upi_demo",
      label: "UPI Demo",
      icon: require("../../assets/phonepe.png"),
    },
    {
      id: "wallet_demo",
      label: "Demo Wallet Payment",
      icon: require("../../assets/gpay.png"),
    },
    {
      id: "online_demo",
      label: "Demo Online Payment",
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
  // PLACE ORDER & INITIATE DEMO PAYMENT (STEP 9)
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
      const items = route.params?.items || [];
      const canteenId = route.params?.canteenId || "BIG_MINGOS";
      const pickupSlotId = route.params?.pickupSlotId || "SLOT_DEFAULT";
      const paymentMethod = selected === "cash" ? "cash" : "upi_demo";

      // Step 1: Create Order via trusted server Cloud Function
      const orderResult = await createOrderCallable({
        canteenId,
        items,
        pickupSlotId,
        paymentMethod,
        idempotencyKey: idempotencyKeyRef.current,
      });

      let providerRef = orderResult.orderId;

      // Step 2: For online demo payment, initiate server-owned demo payment record
      if (paymentMethod === "upi_demo") {
        const paymentResult = await createDemoPaymentCallable({
          orderId: orderResult.orderId,
          idempotencyKey: idempotencyKeyRef.current,
        });
        providerRef = paymentResult.providerReference || orderResult.orderId;
      }

      navigation.navigate("OrderConfirmed", {
        orderId: orderResult.orderId,
        referenceId: providerRef,
      });

    } catch (error: any) {
      Alert.alert(
        "Order Failed",
        error.message || "Something went wrong while placing your order. Please try again."
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
        {/* DEMO NOTICE BANNER (Step 9) */}
        <View
          style={{
            backgroundColor: "#FEF3C7",
            borderColor: "#F59E0B",
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            marginBottom: 15,
          }}
        >
          <Text
            style={{
              color: "#92400E",
              fontWeight: "bold",
              fontSize: 13,
            }}
          >
            ⚠️ Demo Mode — No real charges will be made
          </Text>
          <Text
            style={{
              color: "#B45309",
              fontSize: 12,
              marginTop: 2,
            }}
          >
            Payments are simulated locally in the Firebase Emulator Suite.
          </Text>
        </View>

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