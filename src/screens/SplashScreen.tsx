import React from "react";
import { View, Text, Image } from "react-native";
import { splashStyles } from "../styles/Studentstyles";

export default function SplashScreen() {
  return (
    <View style={splashStyles.container}>

      {/* Logo in center */}
      <View style={splashStyles.logoContainer}>
        <Image
          source={require("../../assets/logo.png")}
          style={splashStyles.logo}
          resizeMode="contain"
        />
      </View>

      {/* Tagline below logo */}
      <Text style={splashStyles.tagline}>No Line, Just Dine.</Text>

      {/* Loading at bottom */}
      <View style={splashStyles.bottomContainer}>
        <Text style={splashStyles.foodEmojis}>🍰   🍝   🍟</Text>
        <Text style={splashStyles.loading}>  Loading... </Text>
      </View>

    </View>
  );
}