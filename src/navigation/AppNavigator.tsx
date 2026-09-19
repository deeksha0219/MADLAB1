import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import SplashScreen from "../screens/SplashScreen";
import AccountScreen from "../screens/AccountScreen";
import LoginScreen from "../screens/LoginScreen";
import HomeScreen from "../screens/HomeScreen";
import ProfileScreen from "../screens/ProfilScreen";
import CategoryScreen from "../screens/CategoryScreen";
import CartScreen from "../screens/CartScreen";
import PaymentScreen from "../screens/PaymentScreen";
import OrderHistoryScreen from "../screens/OrderHistoryScreen";
import OrderConfirmed from "../screens/OrderConfirmedScreen";
import MMAdminBlockScreen from "../screens/MMAdminBlockScreen";
import MMLibraryScreen from "../screens/MMLibraryScreen";
import MMAdminCategoryScreen from "../screens/MMAdminCategoryScreen";
import MMLibraryCategoryScreen from "../screens/MMLibraryCategoryScreen";



const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAccountDone, setIsAccountDone] = useState(false);
  const [role, setRole] = useState<"student" | "Service Desk" | null>(null);

  useEffect(() => {
    setTimeout(() => setIsLoading(false), 2000);
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>

        {isLoading ? (
          <Stack.Screen name="Splash" component={SplashScreen} />

        ) : !isAccountDone ? (
          <Stack.Screen name="Account">
            {(props: any) => (
              <AccountScreen {...props} setIsAccountDone={setIsAccountDone} />
            )}
          </Stack.Screen>

        ) : role === null ? (
          <Stack.Screen name="Login">
            {(props: any) => (
              <LoginScreen {...props} setRole={setRole} />
            )}
          </Stack.Screen>

        ) : role === "student" ? (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Profile"> 
              {(props: any) => ( // ✅ only ONE Profile screen
                <ProfileScreen {...props} setRole={setRole} />
              )}
            </Stack.Screen>
            <Stack.Screen name="Category" component={CategoryScreen} />
            <Stack.Screen name="Cart" component={CartScreen} />
            <Stack.Screen name="Payment" component={PaymentScreen} />
            <Stack.Screen name="OrderHistory" component={OrderHistoryScreen}  />
            <Stack.Screen name="OrderConfirmed" component={OrderConfirmed} />
            <Stack.Screen
            name="MMAdminCategory"
            component={MMAdminCategoryScreen}
            />
            <Stack.Screen
            name="MMLibraryCategory"
            component={MMLibraryCategoryScreen}
            />

            <Stack.Screen
            name="MMAdminBlock"
            component={MMAdminBlockScreen}
            />

            <Stack.Screen
            name="MMLibrary"
            component={MMLibraryScreen}
            />
          
          </>

        ) : (
          <>
            
          </>
        )}

      </Stack.Navigator>
    </NavigationContainer>
  );
}