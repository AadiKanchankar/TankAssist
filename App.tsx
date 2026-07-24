import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from './constants/colors';
import { queryClient } from './lib/queryClient';
import { supabase } from './lib/supabase';
import { useAuthStore } from './store/useAuthStore';

// Auth screens
import LoginScreen from './app/(auth)/login';
import VerifyOtpScreen from './app/(auth)/verify-otp';
import DeactivatedScreen from './app/(auth)/deactivated';
import KickedOutScreen from './app/(auth)/kicked-out';

// Rep screens
import RepDashboard from './app/(rep)/dashboard';
import AttendanceScreen from './app/(rep)/attendance';
import RepStoresScreen from './app/(rep)/stores';
import StoreVisitScreen from './app/(rep)/store-visit';
import ReportScreen from './app/(rep)/report';

// Admin screens
import AdminDashboard from './app/(admin)/dashboard';
import AdminRepsScreen from './app/(admin)/reps';
import AdminStoresScreen from './app/(admin)/stores';
import StoreFormScreen from './app/(admin)/store-form';
import RepDetailScreen from './app/(admin)/rep-detail';
import ProductsScreen from './app/(admin)/products';
import OrdersScreen from './app/(admin)/orders';
import ManagementDashboard from './app/(admin)/management-dashboard';

// Shared screens
import ProfileScreen from './app/(shared)/profile';
import StoreDetailScreen from './app/(shared)/store-detail';
import OrderDetailScreen from './app/(shared)/order-detail';
import TesterBadge from './components/TesterBadge';
import LocationResponder from './components/LocationResponder';

const Stack = createNativeStackNavigator();
const RepTab = createBottomTabNavigator();
const AdminTab = createBottomTabNavigator();
const RepDashStack = createNativeStackNavigator();

// Rep tab: Dashboard stack (Dashboard + Attendance + StoreVisit)
function RepDashboardStack() {
  return (
    <RepDashStack.Navigator screenOptions={{ headerShown: false }}>
      <RepDashStack.Screen name="DashboardHome" component={RepDashboard} />
      <RepDashStack.Screen name="Attendance" component={AttendanceScreen} />
      <RepDashStack.Screen name="StoreVisit" component={StoreVisitScreen} />
    </RepDashStack.Navigator>
  );
}

// Rep tab: Stores stack (Stores + StoreVisit)
const StoresStack = createNativeStackNavigator();
function RepStoresStack() {
  return (
    <StoresStack.Navigator screenOptions={{ headerShown: false }}>
      <StoresStack.Screen name="StoresList" component={RepStoresScreen} />
      <StoresStack.Screen name="StoreDetail" component={StoreDetailScreen} />
      <StoresStack.Screen name="StoreVisit" component={StoreVisitScreen} />
    </StoresStack.Navigator>
  );
}

// Admin tab: Stores stack (list → detail → add/edit form)
const AdminStoresStackNav = createNativeStackNavigator();
function AdminStoresStack() {
  return (
    <AdminStoresStackNav.Navigator screenOptions={{ headerShown: false }}>
      <AdminStoresStackNav.Screen
        name="StoresList"
        component={AdminStoresScreen}
      />
      <AdminStoresStackNav.Screen
        name="StoreDetail"
        component={StoreDetailScreen}
      />
      <AdminStoresStackNav.Screen name="StoreForm" component={StoreFormScreen} />
      <AdminStoresStackNav.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
      />
    </AdminStoresStackNav.Navigator>
  );
}

// Admin tab: Reps stack (rep list → per-rep detail: Assign Stores + Report)
const RepsStack = createNativeStackNavigator();
function AdminRepsStack() {
  return (
    <RepsStack.Navigator screenOptions={{ headerShown: false }}>
      <RepsStack.Screen name="RepsList" component={AdminRepsScreen} />
      <RepsStack.Screen name="RepDetail" component={RepDetailScreen} />
    </RepsStack.Navigator>
  );
}

// Admin tab: Orders stack (orders list → order detail with status actions)
const OrdersStack = createNativeStackNavigator();
function AdminOrdersStack() {
  return (
    <OrdersStack.Navigator screenOptions={{ headerShown: false }}>
      <OrdersStack.Screen name="OrdersList" component={OrdersScreen} />
      <OrdersStack.Screen name="OrderDetail" component={OrderDetailScreen} />
    </OrdersStack.Navigator>
  );
}

/** Returns tab bar options with dynamic bottom safe-area inset */
const getTabScreenOptions = (bottomInset: number) => ({
  headerShown: false,
  tabBarStyle: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: 60 + bottomInset,
    paddingBottom: 8 + bottomInset,
    paddingTop: 8,
  },
  // Active tab = olive (brand), never lime — lime is the spotlight accent only.
  tabBarActiveTintColor: Colors.accent,
  tabBarInactiveTintColor: Colors.textMuted,
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
});

// Rep bottom tabs
function RepTabs() {
  const insets = useSafeAreaInsets();
  return (
    <>
      {/* Rep-side live-location responder (active only while checked in). */}
      <LocationResponder />
      <RepTab.Navigator screenOptions={getTabScreenOptions(insets.bottom)}>
      <RepTab.Screen
        name="Dashboard"
        component={RepDashboardStack}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
          ),
        }}
      />
      <RepTab.Screen
        name="MyStores"
        component={RepStoresStack}
        options={{
          tabBarLabel: 'My stores',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront" size={size} color={color} />
          ),
        }}
      />
      <RepTab.Screen
        name="Report"
        component={ReportScreen}
        options={{
          tabBarLabel: 'Report',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text" size={size} color={color} />
          ),
        }}
      />
      <RepTab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle" size={size} color={color} />
          ),
        }}
      />
      </RepTab.Navigator>
    </>
  );
}

// Dashboard router: management gets the KPI dashboard; sales managers keep the
// current attendance/coverage dashboard.
function DashboardRouter(props: any) {
  const isManagement = useAuthStore((s) => s.profile?.role === 'management');
  return isManagement ? (
    <ManagementDashboard {...props} />
  ) : (
    <AdminDashboard {...props} />
  );
}

// Admin bottom tabs (used by sales_manager and management). The Products tab is
// management-only (catalog management); sales managers don't see it.
function AdminTabs() {
  const insets = useSafeAreaInsets();
  const isManagement = useAuthStore((s) => s.profile?.role === 'management');
  return (
    <AdminTab.Navigator screenOptions={getTabScreenOptions(insets.bottom)}>
      <AdminTab.Screen
        name="Dashboard"
        component={DashboardRouter}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
          ),
        }}
      />
      <AdminTab.Screen
        name="Team"
        component={AdminRepsStack}
        options={{
          tabBarLabel: 'Team',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <AdminTab.Screen
        name="Stores"
        component={AdminStoresStack}
        options={{
          tabBarLabel: 'Stores',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront" size={size} color={color} />
          ),
        }}
      />
      {isManagement && (
        <AdminTab.Screen
          name="Products"
          component={ProductsScreen}
          options={{
            tabBarLabel: 'Products',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="cube" size={size} color={color} />
            ),
          }}
        />
      )}
      <AdminTab.Screen
        name="Orders"
        component={AdminOrdersStack}
        options={{
          tabBarLabel: 'Orders',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt" size={size} color={color} />
          ),
        }}
      />
      <AdminTab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle" size={size} color={color} />
          ),
        }}
      />
    </AdminTab.Navigator>
  );
}

// Auth stack (self-registration removed — accounts are created by Management)
function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="VerifyOtp" component={VerifyOtpScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  const { session, profile, initialized, initialize, kickedOut, deactivated } =
    useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initialize().then(() => setReady(true));
  }, []);

  // Pause/resume token auto-refresh with app foreground state, and proactively
  // revalidate the session on resume so a device that was signed out elsewhere
  // discovers it immediately rather than at its next scheduled refresh.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        supabase.auth.getSession().then(({ data }) => {
          if (data.session) {
            supabase.auth.refreshSession();
          }
        });
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });
    return () => sub.remove();
  }, []);

  // Both a server-side sign-out ("logged in on another device", `kickedOut`) and
  // an account deactivation (`deactivated`) are surfaced as calm full-screens
  // (see the branches below), not alarming alerts.

  if (!ready || !initialized) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      {/* Data cache (Phase B): inside SafeAreaProvider, wrapping the nav trees.
          Placed here so it never affects the loading branch above or the
          AppState / kickedOut / deactivated effects in this component. */}
      <QueryClientProvider client={queryClient}>
        {deactivated ? (
          // Calm full-screen; session is already torn down by signOutDeactivated.
          <DeactivatedScreen />
        ) : kickedOut ? (
          // Calm full-screen; session was revoked server-side (single-session).
          <KickedOutScreen />
        ) : (
          <>
            <NavigationContainer>
              {!session || !profile ? (
                <AuthStack />
              ) : profile.role === 'rep' ? (
                // key on role so a tester role-switch fully remounts the tree at
                // its root (lands on the new role's Dashboard, like a fresh login).
                <RepTabs key={profile.role} />
              ) : (
                <AdminTabs key={profile.role} />
              )}
            </NavigationContainer>
            <TesterBadge />
          </>
        )}
        <StatusBar style="dark" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
