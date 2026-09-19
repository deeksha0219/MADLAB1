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
import firestore from "@react-native-firebase/firestore";
import Feather from "react-native-vector-icons/Feather";

type Props = {
  navigation: any;
  route: any;
  setIsAccountDone: (value: boolean) => void;
};

export default function CreateAccountScreen({
  setIsAccountDone,
}: Props) {
  const [collegeId, setCollegeId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const handleRegister = async () => {
    if (!collegeId || !name || !phone || !password || !confirmPassword) {
      Alert.alert("Error", "Please fill all fields!");
      return;
    }

    if (!collegeId.trim().toLowerCase().endsWith("@rvu.edu.in")) {
      Alert.alert(
        "Invalid Email",
        "Only @rvu.edu.in emails are allowed!"
      );
      return;
    }

    if (phone.length !== 10) {
      Alert.alert(
        "Error",
        "Enter valid 10-digit phone number!"
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        "Error",
        "Passwords do not match!"
      );
      return;
    }

    if (password.length < 6) {
      Alert.alert(
        "Error",
        "Password must be at least 6 characters!"
      );
      return;
    }

    setLoading(true);

    try {
      const db = firestore();

      // CHECK PHONE EXISTS
      const phoneCheck = await db
        .collection("users")
        .where("phone", "==", phone)
        .get();

      if (!phoneCheck.empty) {
        Alert.alert(
          "Error",
          "Phone number already registered!"
        );
        return;
      }

      // CHECK COLLEGE ID EXISTS
      const idCheck = await db
        .collection("users")
        .where("collegeId", "==", collegeId)
        .get();

      if (!idCheck.empty) {
        Alert.alert(
          "Error",
          "College ID already registered!"
        );
        return;
      }

      // SAVE TO FIRESTORE
      await db.collection("users").add({
        collegeId,
        name,
        phone,
        password,
        createdAt: new Date().toISOString(),
      });

      Alert.alert(
        "✅ Success!",
        "Account created! Please login."
      );

      setIsAccountDone(true);

    } catch (err) {
      console.log("Firebase error:", err);

      Alert.alert(
        "Error",
        "Registration failed! Check your connection."
      );

    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={Accstyles.container}>

      <ScrollView
        ref={scrollRef}
        style={{
          flex: 1,
          width: "100%",
        }}
        contentContainerStyle={{
          alignItems: "center",
          paddingBottom: 300,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={true}
      >

        <Image
          source={require("../../assets/logo_text.png")}
          style={Accstyles.logoImage}
        />

        <Text style={Accstyles.welcome}>
          Welcome! 👋
        </Text>

        <Text style={Accstyles.subtitle}>
          Ready to skip the queue today?
        </Text>

        <View style={Accstyles.card}>

          <Text style={Accstyles.cardTitle}>
            Create Account
          </Text>

          <TextInput
            placeholder="Enter your RVU Email ID"
            placeholderTextColor="#555"
            style={Accstyles.input}
            value={collegeId}
            onChangeText={setCollegeId}
            autoCapitalize="none"
          />

          <TextInput
            placeholder="Full Name"
            placeholderTextColor="#555"
            style={Accstyles.input}
            value={name}
            onChangeText={setName}
          />

          <TextInput
            placeholder="Phone Number"
            placeholderTextColor="#555"
            style={Accstyles.input}
            keyboardType="number-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
          />

          <View style={{ position: "relative" }}>

            <TextInput
              placeholder="Create Password"
              placeholderTextColor="#555"
              secureTextEntry={!showPassword}
              style={Accstyles.input}
              value={password}
              onChangeText={setPassword}
            />

            <TouchableOpacity
              onPress={() =>
                setShowPassword(!showPassword)
              }
              style={{
                position: "absolute",
                right: 18,
                top: 12,
              }}
            >
              <Feather
                name={
                  showPassword
                    ? "eye"
                    : "eye-off"
                }
                size={20}
                color="#555"
              />
            </TouchableOpacity>

          </View>

          <View style={{ position: "relative" }}>

            <TextInput
              placeholder="Confirm Password"
              placeholderTextColor="#555"
              secureTextEntry={!showPassword}
              style={Accstyles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            <TouchableOpacity
              onPress={() =>
                setShowPassword(!showPassword)
              }
              style={{
                position: "absolute",
                right: 18,
                top: 12,
              }}
            >
              <Feather
                name={
                  showPassword
                    ? "eye"
                    : "eye-off"
                }
                size={20}
                color="#555"
              />
            </TouchableOpacity>

          </View>

          <TouchableOpacity
            style={[
              Accstyles.button,
              loading && { opacity: 0.6 },
            ]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={Accstyles.buttonText}>
                Start Now
              </Text>
            )}
          </TouchableOpacity>

        </View>

        <TouchableOpacity
          onPress={() => setIsAccountDone(true)}
        >
          <Text style={Accstyles.footer}>
            Already have an Account?{" "}
            <Text style={Accstyles.login}>
              LOGIN
            </Text>
          </Text>
        </TouchableOpacity>

      </ScrollView>

    </SafeAreaView>
  );
}