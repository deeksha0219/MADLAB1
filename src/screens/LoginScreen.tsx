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
  requestPhoneOtp,
  confirmPhoneOtp,
} from "../services/authService";

type Props = {
  navigation?: any;
  onNavigateToRegister?: () => void;
};

export default function LoginScreen({ navigation, onNavigateToRegister }: Props) {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [confirmResult, setConfirmResult] = useState<any>(null);

  const scrollViewRef = useRef<ScrollView>(null);

  // --------------------------------------------------
  // SEND OTP
  // --------------------------------------------------
  const handleSendOtp = async () => {
    const cleanPhone = phone.trim();
    if (!cleanPhone || cleanPhone.length !== 10) {
      Alert.alert("Invalid Phone", "Please enter a valid 10-digit mobile number.");
      return;
    }

    setLoading(true);
    try {
      const result = await requestPhoneOtp(cleanPhone);
      if (!result.success || !result.confirmation) {
        Alert.alert("Error", result.error || "Failed to send OTP.");
        return;
      }

      setConfirmResult(result.confirmation);
      setOtpSent(true);
      Alert.alert("OTP Sent", "A 6-digit verification code has been sent to your phone.");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------
  // VERIFY OTP
  // --------------------------------------------------
  const handleVerifyOtp = async () => {
    const cleanOtp = otp.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      Alert.alert("Invalid OTP", "Enter the complete 6-digit verification code.");
      return;
    }

    if (!confirmResult) {
      Alert.alert("Error", "Please request an OTP first.");
      return;
    }

    setLoading(true);
    try {
      const result = await confirmPhoneOtp(confirmResult, cleanOtp);
      if (!result.success) {
        Alert.alert("Verification Failed", result.error || "Invalid OTP code.");
        return;
      }

      // Successful sign in automatically triggers onAuthStateChanged in AppNavigator
    } catch (err: any) {
      Alert.alert("Error", err.message || "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------
  // RESEND OTP
  // --------------------------------------------------
  const handleResendOtp = async () => {
    setOtp("");
    setConfirmResult(null);
    setOtpSent(false);

    setTimeout(() => {
      handleSendOtp();
    }, 150);
  };

  const handleGoToRegister = () => {
    if (onNavigateToRegister) {
      onNavigateToRegister();
    } else if (navigation?.navigate) {
      navigation.navigate("Account");
    }
  };

  return (
    <SafeAreaView style={loginStyles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            loginStyles.scrollContent,
            { paddingBottom: 40 },
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
          <Text style={loginStyles.welcome}>Welcome! 👋</Text>
          <Text style={loginStyles.subText}>Ready to skip the queue today?</Text>

          {/* PHONE NUMBER */}
          <View style={loginStyles.phoneContainer}>
            <Text style={loginStyles.countryCode}>+91 |</Text>
            <TextInput
              placeholder="Enter Mobile Number"
              placeholderTextColor="#555"
              style={loginStyles.phoneInput}
              keyboardType="number-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
              editable={!otpSent && !loading}
            />

            <TouchableOpacity
              style={[
                loginStyles.otpButton,
                otpSent && { backgroundColor: "gray" },
              ]}
              onPress={otpSent ? undefined : handleSendOtp}
              disabled={loading || otpSent}
            >
              {loading && !otpSent ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={loginStyles.otpButtonText}>
                  {otpSent ? "Sent ✓" : "Get OTP"}
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
            editable={otpSent && !loading}
            onFocus={() => {
              setTimeout(() => {
                scrollViewRef.current?.scrollToEnd({ animated: true });
              }, 250);
            }}
          />

          {/* RESEND */}
          <View style={{ flexDirection: "row", marginTop: 12, alignItems: "center" }}>
            <Text style={loginStyles.resendText}>Didn't receive OTP?</Text>
            <TouchableOpacity onPress={otpSent ? handleResendOtp : undefined} disabled={loading || !otpSent}>
              <Text style={[loginStyles.resend, !otpSent && { color: "gray" }]}> Resend</Text>
            </TouchableOpacity>
          </View>

          {/* VERIFY BUTTON */}
          <TouchableOpacity
            style={[
              loginStyles.verifyButton,
              (loading || !otpSent) && { opacity: 0.6 },
            ]}
            onPress={handleVerifyOtp}
            disabled={loading || !otpSent}
          >
            {loading && otpSent ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={loginStyles.verifyButtonText}>VERIFY & LOGIN</Text>
            )}
          </TouchableOpacity>

          {/* CREATE ACCOUNT LINK */}
          <TouchableOpacity
            onPress={handleGoToRegister}
            style={{ marginTop: 24, alignSelf: "center" }}
          >
            <Text style={{ fontSize: 14, color: "#666" }}>
              New to GrabNGo?{" "}
              <Text style={{ color: "#E0533C", fontWeight: "bold" }}>
                Create Account
              </Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}