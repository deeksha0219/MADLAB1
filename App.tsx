import React, { useEffect } from "react";
import AppNavigator from "./src/navigation/AppNavigator";
import { CartProvider } from "./src/screens/CartContext";
import { configureFirebase } from "./src/config/firebase";


export default function App() {
  useEffect(() => {
    configureFirebase();
  }, []);

  return (
    <CartProvider> 
        <AppNavigator />
    </CartProvider> 
  );
}
