import React, { useState } from "react";
import {
  View, Text, Image, TextInput,
  TouchableOpacity, Alert, ActivityIndicator
} from "react-native";
import { loginStyles } from "../styles/Studentstyles";
import { getFirestore, collection, query, where, getDocs } from "@react-native-firebase/firestore";
import auth from '@react-native-firebase/auth';
import { getApp } from "@react-native-firebase/app";

type Props = {
  setRole: (role: "student" | "Service Desk") => void;
};

export default function LoginScreen({ setRole }: Props) {
  const [selectedRole, setSelectedRole] = useState<"student" | "admin">("student");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [adminId, setAdminId] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [confirm, setConfirm] = useState<any>(null);

  const app = getApp();
  const db = getFirestore(app);

  const handleSendOtp = async () => {
    
  if (phone.length !== 10) {
    Alert.alert("Error", "Enter valid 10-digit phone number!");
    return;
  }

  setLoading(true);
  try {
    auth().settings.appVerificationDisabledForTesting = true;

    const snap = await getDocs(
      query(collection(db, "users"), where("phone", "==", phone))
    );

    if (snap.empty) {
      Alert.alert("Error", "Phone not registered!");
      return;
    }

    const confirmation = await auth().signInWithPhoneNumber(`+91${phone}`);

    setConfirm(confirmation);
    setOtpSent(true);

    Alert.alert("OTP Sent!");

  } catch (err: any) {
    console.log("ERROR:", err.code, err.message);
    Alert.alert("Error", err.message);
  } finally {
    setLoading(false);
  }
};

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) {
      Alert.alert("Error", "Enter valid 6-digit OTP!");
      return;
    }
    if (!confirm) {
      Alert.alert("Error", "Request OTP first!");
      return;
    }
    setLoading(true);
    try {
      await confirm.confirm(otp);
      setRole("student");
    } catch (err: any) {
      Alert.alert("Error", "Wrong OTP!");
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    if (!adminId || !adminPassword) {
      Alert.alert("Error", "Fill all fields!");
      return;
    }
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "admin"),
          where("adminId", "==", adminId),
          where("password", "==", adminPassword)
        )
      );
      if (!snap.empty) {
        setRole("Service Desk");
      } else {
        Alert.alert("Error", "Invalid Admin ID or Password!");
      }
    } catch (err: any) {
      Alert.alert("Error", "Login failed!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={loginStyles.container}>
      <Image source={require("../../assets/logo_text.png")} style={loginStyles.logo} resizeMode="contain" />
      <Text style={loginStyles.welcome}>Welcome! 👋</Text>
      <Text style={loginStyles.subText}>Ready to skip the queue today? </Text>

      {/* ROLE TABS */}
<View style={loginStyles.roleContainer}>
  <TouchableOpacity
    style={[
      loginStyles.studentButton,
      { backgroundColor: selectedRole === "student" ? "#E6330A" : "#ccc" }, // ✅
    ]}
    onPress={() => {
      setSelectedRole("student");
      setOtpSent(false);
      setPhone("");
      setOtp("");
      setConfirm(null);
    }}
  >
    <Text style={[loginStyles.studentText, { color: selectedRole === "student" ? "#fff" : "#555" }]}>
      Student
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      loginStyles.adminButton,
      { backgroundColor: selectedRole === "admin" ? "#E6330A" : "#ccc" }, // ✅
    ]}
    onPress={() => setSelectedRole("admin")}
  >
    <Text style={[loginStyles.adminText, { color: selectedRole === "admin" ? "#fff" : "#555" }]}>
      Service Desk
    </Text>
  </TouchableOpacity>
</View>

      {selectedRole === "student" ? (
        <>
          <View style={loginStyles.phoneContainer}>
            <Text style={loginStyles.countryCode}>+91 |</Text>
            <TextInput
              placeholder="Enter Your Mobile Number"
              placeholderTextColor="#555"
              style={loginStyles.phoneInput}
              keyboardType="number-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
              editable={!otpSent}
            />
            <TouchableOpacity
              style={[loginStyles.otpButton, otpSent && { backgroundColor: "gray" }]}
              onPress={otpSent ? undefined : handleSendOtp}
              disabled={loading || otpSent}
            >
              {loading && !otpSent
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={loginStyles.otpButtonText}>{otpSent ? "Sent ✓" : "GetOTP"}</Text>
              }
            </TouchableOpacity>
          </View>

          <TextInput
            placeholder="Enter OTP"
            placeholderTextColor="#555"
            style={loginStyles.otpInput}
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={setOtp}
          />

          <View style={{ flexDirection: "row", marginTop: 12, alignItems: "center" }}>
            <Text style={loginStyles.resendText}>
              Didn't receive OTP?  </Text>
            <Text
              style={loginStyles.resend}
              onPress={() => {
              setOtpSent(false);
              setOtp("");
              setConfirm(null);
              handleSendOtp(); // ✅ actually resend 
              }}>{" "}Resend</Text>
          </View>

          <TouchableOpacity
            style={[loginStyles.verifyButton, loading && { opacity: 0.6 }]}
            onPress={handleVerifyOtp}
            disabled={loading}
          >
            {loading && otpSent
              ? <ActivityIndicator color="#fff" />
              : <Text style={loginStyles.verifyButtonText}>VERIFY OTP</Text>
            }
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput placeholder="Admin ID" placeholderTextColor="#555" style={loginStyles.otpInput} value={adminId} onChangeText={setAdminId} />
          <TextInput placeholder="Password" placeholderTextColor="#555" style={loginStyles.otpInput} secureTextEntry value={adminPassword} onChangeText={setAdminPassword} />

          <TouchableOpacity
            style={[loginStyles.verifyButton, loading && { opacity: 0.6 }]}
            onPress={handleAdminLogin}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={loginStyles.verifyButtonText}>LOGIN</Text>}
          </TouchableOpacity>

          <Text
            style={loginStyles.resendText}>
            Forgot Password?{" "}
          <Text
            style={loginStyles.resend}
            onPress={() =>
            Alert.alert(
            "Contact Admin",
            "Please contact your administrator to reset your password.\n\n📞 Admin: +91 XXXXXXXXXX",
            [{ text: "OK" }])}>Contact Admin</Text>
          </Text>
        </>
      )}
    </View>
  );
}