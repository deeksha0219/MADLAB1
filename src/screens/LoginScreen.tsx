import React, { useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import { loginStyles } from "../styles/Studentstyles";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
} from "@react-native-firebase/firestore";
import auth from "@react-native-firebase/auth";
import { getApp } from "@react-native-firebase/app";

type Props = {
  setRole: (role: "student" | "Service Desk") => void;
};

export default function LoginScreen({ setRole }: Props) {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [confirm, setConfirm] = useState<any>(null);

  // ScrollView reference
  const scrollViewRef = useRef<ScrollView>(null);

  const app = getApp();
  const db = getFirestore(app);

  // --------------------------------------------------
  // SEND OTP
  // --------------------------------------------------

  const handleSendOtp = async () => {
    if (phone.length !== 10) {
      Alert.alert(
        "Error",
        "Enter valid 10-digit phone number!"
      );
      return;
    }

    setLoading(true);

    try {
      auth().settings.appVerificationDisabledForTesting = true;

      const snap = await getDocs(
        query(
          collection(db, "users"),
          where("phone", "==", phone)
        )
      );

      if (snap.empty) {
        Alert.alert(
          "Error",
          "Phone not registered!"
        );
        return;
      }

      const confirmation =
        await auth().signInWithPhoneNumber(
          `+91${phone}`
        );

      setConfirm(confirmation);
      setOtpSent(true);

      Alert.alert("OTP Sent!");

    } catch (err: any) {
      console.log(
        "ERROR:",
        err.code,
        err.message
      );

      Alert.alert(
        "Error",
        err.message
      );

    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------
  // VERIFY OTP
  // --------------------------------------------------

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) {
      Alert.alert(
        "Error",
        "Enter valid 6-digit OTP!"
      );
      return;
    }

    if (!confirm) {
      Alert.alert(
        "Error",
        "Request OTP first!"
      );
      return;
    }

    setLoading(true);

    try {
      await confirm.confirm(otp);

      setRole("student");

    } catch (err: any) {
      Alert.alert(
        "Error",
        "Wrong OTP!"
      );

    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------
  // RESEND OTP
  // --------------------------------------------------

  const handleResendOtp = async () => {
    setOtp("");
    setConfirm(null);
    setOtpSent(false);

    // Wait for state update before sending again
    setTimeout(() => {
      handleSendOtp();
    }, 100);
  };

  // --------------------------------------------------
  // SCREEN
  // --------------------------------------------------

  return (
    <SafeAreaView style={loginStyles.container}>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : "height"
        }
      >

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            loginStyles.scrollContent,
            {
              paddingBottom: 40,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >

          {/* LOGO */}

          <Image
            source={require("../../assets/logo_text.png")}
            style={loginStyles.logo}
            resizeMode="contain"
          />

          {/* WELCOME */}

          <Text style={loginStyles.welcome}>
            Welcome! 👋
          </Text>

          <Text style={loginStyles.subText}>
            Ready to skip the queue today?
          </Text>

          {/* PHONE NUMBER */}

          <View style={loginStyles.phoneContainer}>

            <Text style={loginStyles.countryCode}>
              +91 |
            </Text>

            <TextInput
              placeholder="Enter Mobile Number"
              placeholderTextColor="#555"
              style={loginStyles.phoneInput}
              keyboardType="number-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
              editable={!otpSent}
            />

            <TouchableOpacity
              style={[
                loginStyles.otpButton,
                otpSent && {
                  backgroundColor: "gray",
                },
              ]}
              onPress={
                otpSent
                  ? undefined
                  : handleSendOtp
              }
              disabled={
                loading || otpSent
              }
            >

              {loading && !otpSent ? (
                <ActivityIndicator
                  color="#fff"
                  size="small"
                />
              ) : (
                <Text
                  style={
                    loginStyles.otpButtonText
                  }
                >
                  {otpSent
                    ? "Sent ✓"
                    : "Get OTP"}
                </Text>
              )}

            </TouchableOpacity>

          </View>

          {/* OTP INPUT */}

          <TextInput
            placeholder="Enter OTP"
            placeholderTextColor="#555"
            style={loginStyles.otpInput}
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={setOtp}

            // ⭐ AUTOMATICALLY MOVE SCREEN UP
            // WHEN KEYBOARD OPENS
            onFocus={() => {
              setTimeout(() => {
                scrollViewRef.current?.scrollToEnd({
                  animated: true,
                });
              }, 250);
            }}
          />

          {/* RESEND */}

          <View
            style={{
              flexDirection: "row",
              marginTop: 12,
              alignItems: "center",
            }}
          >

            <Text
              style={
                loginStyles.resendText
              }
            >
              Didn't receive OTP?
            </Text>

            <Text
              style={loginStyles.resend}
              onPress={handleResendOtp}
            >
              {" "}Resend
            </Text>

          </View>

          {/* VERIFY BUTTON */}

          <TouchableOpacity
            style={[
              loginStyles.verifyButton,
              loading && {
                opacity: 0.6,
              },
            ]}
            onPress={handleVerifyOtp}
            disabled={loading}
          >

            {loading && otpSent ? (
              <ActivityIndicator
                color="#fff"
              />
            ) : (
              <Text
                style={
                  loginStyles.verifyButtonText
                }
              >
                VERIFY OTP
              </Text>
            )}

          </TouchableOpacity>

        </ScrollView>

      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}