import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import AppNavigator from "./src/navigation/AppNavigator";
import { CartProvider } from "./src/screens/CartContext"; // ✅ ADD

export default function App() {
  return (
    <CartProvider> 
        <AppNavigator />
    </CartProvider> 
  );
}
