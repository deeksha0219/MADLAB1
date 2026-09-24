import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import auth, { FirebaseAuthTypes } from "@react-native-firebase/auth";

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
import AdminLandingScreen from "../screens/AdminLandingScreen";
import AccessDeniedScreen from "../screens/AccessDeniedScreen";
import NotificationsScreen from "../screens/NotificationsScreen";

import { getStudentProfile, StudentProfile } from "../services/profileService";
import { getAdminProfile, AdminProfile } from "../services/adminService";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const [initializing, setInitializing] = useState(true);
  const [authUser, setAuthUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [isAccessDenied, setIsAccessDenied] = useState(false);
  const [authView, setAuthView] = useState<"login" | "register">("login");

  // Handle Firebase Auth state changes
  useEffect(() => {
    const subscriber = auth().onAuthStateChanged(async (user) => {
      setAuthUser(user);

      if (!user) {
        setStudentProfile(null);
        setAdminProfile(null);
        setIsAccessDenied(false);
        setInitializing(false);
        return;
      }

      try {
        // 1. Check if user is an authorized admin in 'admins/{uid}'
        const adminData = await getAdminProfile(user.uid);
        if (adminData && adminData.status === "active") {
          setAdminProfile(adminData);
          setStudentProfile(null);
          setIsAccessDenied(false);
          setInitializing(false);
          return;
        }

        // 2. If not admin, check if user has a student profile in 'users/{uid}'
        const studentData = await getStudentProfile(user.uid);
        if (studentData) {
          if (studentData.status !== "active") {
            setIsAccessDenied(true);
          } else {
            setStudentProfile(studentData);
            setIsAccessDenied(false);
          }
        } else {
          // New authenticated user without a profile yet -> route to AccountScreen to complete profile
          setStudentProfile(null);
          setIsAccessDenied(false);
        }
      } catch (err) {
        console.error("[AppNavigator] Error resolving user profile/role:", err);
      } finally {
        setInitializing(false);
      }
    });

    return subscriber; // unsubscribe on unmount
  }, []);

  if (initializing) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* UNAUTHENTICATED STATE */}
        {!authUser ? (
          authView === "login" ? (
            <Stack.Screen name="Login">
              {(props) => (
                <LoginScreen
                  {...props}
                  onNavigateToRegister={() => setAuthView("register")}
                />
              )}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Account">
              {(props) => (
                <AccountScreen
                  {...props}
                  onNavigateToLogin={() => setAuthView("login")}
                />
              )}
            </Stack.Screen>
          )
        ) : isAccessDenied ? (
          /* ACCESS DENIED STATE (INACTIVE / SUSPENDED) */
          <Stack.Screen name="AccessDenied">
            {(props) => (
              <AccessDeniedScreen
                {...props}
                message="Your student or staff account has been deactivated. Please contact campus security/administration."
              />
            )}
          </Stack.Screen>
        ) : adminProfile ? (
          /* AUTHENTICATED ADMIN STATE */
          <>
            <Stack.Screen name="AdminLanding">
              {(props) => (
                <AdminLandingScreen {...props} adminProfile={adminProfile} />
              )}
            </Stack.Screen>
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
          </>
        ) : !studentProfile ? (
          /* AUTHENTICATED BUT PROFILE INCOMPLETE -> Complete registration */
          <Stack.Screen name="CompleteProfile">
            {(props) => (
              <AccountScreen {...props} currentUser={authUser} />
            )}
          </Stack.Screen>
        ) : (
          /* AUTHENTICATED ACTIVE STUDENT STATE */
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Category" component={CategoryScreen} />
            <Stack.Screen name="Cart" component={CartScreen} />
            <Stack.Screen name="Payment" component={PaymentScreen} />
            <Stack.Screen name="OrderHistory" component={OrderHistoryScreen} />
            <Stack.Screen name="OrderConfirmed" component={OrderConfirmed} />
            <Stack.Screen name="MMAdminCategory" component={MMAdminCategoryScreen} />
            <Stack.Screen name="MMLibraryCategory" component={MMLibraryCategoryScreen} />
            <Stack.Screen name="MMAdminBlock" component={MMAdminBlockScreen} />
            <Stack.Screen name="MMLibrary" component={MMLibraryScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}