import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  Image, SafeAreaView, Alert, ActivityIndicator
} from "react-native";
import { Accstyles } from "../styles/Studentstyles";
import firestore from "@react-native-firebase/firestore";

type Props = {
  navigation: any;
  route: any;
  setIsAccountDone: (value: boolean) => void;
};

export default function CreateAccountScreen({ setIsAccountDone }: Props) {
  const [collegeId, setCollegeId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!collegeId || !name || !phone || !password || !confirmPassword) {
      Alert.alert("Error", "Please fill all fields!");
      return;
    }
    if (phone.length !== 10) {
      Alert.alert("Error", "Enter valid 10-digit phone number!");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match!");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters!");
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
        Alert.alert("Error", "Phone number already registered!");
        return;
      }

      // CHECK COLLEGE ID EXISTS
      const idCheck = await db
        .collection("users")
        .where("collegeId", "==", collegeId)
        .get();

      if (!idCheck.empty) {
        Alert.alert("Error", "College ID already registered!");
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

      Alert.alert("✅ Success!", "Account created! Please login.");
      setIsAccountDone(true);

    } catch (err) {
      console.log("Firebase error:", err);
      Alert.alert("Error", "Registration failed! Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={Accstyles.container}>
      <Image
        source={require("../../assets/logo_text.png")}
        style={Accstyles.logoImage}
      />

      <Text style={Accstyles.welcome}>Welcome! 👋</Text>
      <Text style={Accstyles.subtitle}>Ready to skip the queue today? </Text>

      <View style={Accstyles.card}>
        <Text style={Accstyles.cardTitle}>Create Account </Text>

        <TextInput
          placeholder="Enter your College ID"
          placeholderTextColor="#555"
          style={Accstyles.input}
          value={collegeId}
          onChangeText={setCollegeId}
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
        <TextInput
          placeholder="Create Password"
          placeholderTextColor="#555"
          secureTextEntry
          style={Accstyles.input}
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          placeholder="Confirm Password"
          placeholderTextColor="#555"
          secureTextEntry
          style={Accstyles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />

        <TouchableOpacity
          style={[Accstyles.button, loading && { opacity: 0.6 }]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={Accstyles.buttonText}>Start Now</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => setIsAccountDone(true)}>
        <Text style={Accstyles.footer}>        Already have an Account?{" "}
          <Text style={Accstyles.login}>LOGIN</Text>
        </Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

