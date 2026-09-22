import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Accstyles } from "../styles/Studentstyles";
import { createStudentProfile, isValidRvuEmail } from "../services/profileService";
import {
  requestPhoneOtp,
  confirmPhoneOtp,
  getCurrentUser,
} from "../services/authService";

type Props = {
  navigation?: any;
  onNavigateToLogin?: () => void;
  currentUser?: any;
};

export default function CreateAccountScreen({
  navigation,
  onNavigateToLogin,
  currentUser,
}: Props) {
  const [collegeId, setCollegeId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(currentUser?.phoneNumber?.replace("+91", "") || "");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const activeUser = currentUser || getCurrentUser();

  // --------------------------------------------------
  // SEND OTP (Only needed if user is not already authenticated)
  // --------------------------------------------------
  const handleSendOtp = async () => {
    const cleanPhone = phone.trim();
    if (!cleanPhone || cleanPhone.length !== 10) {
      Alert.alert("Invalid Phone", "Please enter a valid 10-digit phone number.");
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
      Alert.alert("OTP Sent", "Verification code sent to your phone.");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------
  // REGISTER / COMPLETE PROFILE
  // --------------------------------------------------
  const handleRegister = async () => {
    const cleanName = name.trim();
    const cleanCollegeId = collegeId.trim().toLowerCase();

    if (!cleanName || cleanName.length < 2) {
      Alert.alert("Invalid Name", "Please enter your full name.");
      return;
    }

    if (!isValidRvuEmail(cleanCollegeId)) {
      Alert.alert(
        "Invalid Email",
        "Only official RV University emails (@rvu.edu.in) are allowed."
      );
      return;
    }

    setLoading(true);

    try {
      let targetUser = activeUser;

      // If not yet authenticated, verify OTP first
      if (!targetUser) {
        if (!confirmResult) {
          Alert.alert("Error", "Please request and verify your phone OTP first.");
          setLoading(false);
          return;
        }

        const verifyRes = await confirmPhoneOtp(confirmResult, otp);
        if (!verifyRes.success || !verifyRes.user) {
          Alert.alert("Verification Failed", verifyRes.error || "Incorrect OTP code.");
          setLoading(false);
          return;
        }

        targetUser = verifyRes.user;
      }

      // Authoritative profile creation in users/{uid}
      await createStudentProfile(targetUser.uid, {
        name: cleanName,
        collegeId: cleanCollegeId,
        phone: targetUser.phoneNumber || `+91${phone.trim()}`,
      });

      Alert.alert("Success! 🎉", "Your profile has been created successfully.");
      // onAuthStateChanged / profile state will automatically transition the stack
    } catch (err: any) {
      console.error("Registration error:", err);
      Alert.alert("Registration Error", err.message || "Failed to complete registration.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoToLogin = () => {
    if (onNavigateToLogin) {
      onNavigateToLogin();
    } else if (navigation?.navigate) {
      navigation.navigate("Login");
    }
  };

  return (
    <SafeAreaView style={Accstyles.container}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, width: "100%" }}
        contentContainerStyle={{ alignItems: "center", paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={true}
      >
        <Image
          source={require("../../assets/logo_text.png")}
          style={Accstyles.logoImage}
        />

        <Text style={Accstyles.welcome}>Welcome! 👋</Text>
        <Text style={Accstyles.subtitle}>Create your GrabNGo Student Account</Text>

        <View style={Accstyles.card}>
          <Text style={Accstyles.cardTitle}>Student Profile</Text>

          {/* RVU College Email */}
          <TextInput
            placeholder="Enter your RVU Email ID (@rvu.edu.in)"
            placeholderTextColor="#555"
            style={Accstyles.input}
            value={collegeId}
            onChangeText={setCollegeId}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />

          {/* Full Name */}
          <TextInput
            placeholder="Full Name"
            placeholderTextColor="#555"
            style={Accstyles.input}
            value={name}
            onChangeText={setName}
            editable={!loading}
          />

          {/* Phone Number (if not already authenticated) */}
          {!activeUser && (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
                <TextInput
                  placeholder="10-digit Mobile Number"
                  placeholderTextColor="#555"
                  style={[Accstyles.input, { flex: 1, marginBottom: 0 }]}
                  keyboardType="number-pad"
                  maxLength={10}
                  value={phone}
                  onChangeText={setPhone}
                  editable={!otpSent && !loading}
                />
                <TouchableOpacity
                  style={{
                    backgroundColor: otpSent ? "gray" : "#E0533C",
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    marginLeft: 8,
                  }}
                  onPress={otpSent ? undefined : handleSendOtp}
                  disabled={loading || otpSent}
                >
                  <Text style={{ color: "#FFF", fontWeight: "bold", fontSize: 13 }}>
                    {otpSent ? "Sent ✓" : "Get OTP"}
                  </Text>
                </TouchableOpacity>
              </View>

              {otpSent && (
                <TextInput
                  placeholder="Enter 6-digit OTP"
                  placeholderTextColor="#555"
                  style={[Accstyles.input, { marginTop: 12 }]}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otp}
                  onChangeText={setOtp}
                  editable={!loading}
                />
              )}
            </>
          )}

          {/* Submit Button */}
          <TouchableOpacity
            style={[Accstyles.button, loading && { opacity: 0.6 }]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={Accstyles.buttonText}>Complete Registration</Text>
            )}
          </TouchableOpacity>
        </View>

        {!activeUser && (
          <TouchableOpacity onPress={handleGoToLogin} style={{ marginTop: 20 }}>
            <Text style={Accstyles.footer}>
              Already have an Account?{" "}
              <Text style={Accstyles.login}>LOGIN</Text>
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}