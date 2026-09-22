/**
 * GrabNGo - Protected Admin Landing Screen Placeholder
 *
 * NOTE: As specified in Step 4 scope, this screen serves strictly as the protected
 * landing placeholder for authenticated canteen administrators. The complete admin
 * order management queue, canteen inventory, and status transitions will be implemented
 * in Step 7.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { AdminProfile } from '../services/adminService';
import { signOutUser } from '../services/authService';

type Props = {
  adminProfile: AdminProfile;
  navigation: any;
};

export default function AdminLandingScreen({ adminProfile }: Props) {
  const handleSignOut = async () => {
    try {
      await signOutUser();
    } catch (error) {
      console.error('Error signing out admin:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.badge}>ADMINISTRATION</Text>
        <Text style={styles.title}>Canteen Admin Console</Text>
        <Text style={styles.subtitle}>Authenticated via Firebase Auth UID</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Assigned Canteens</Text>
        <Text style={styles.cardSub}>
          Server-controlled permissions from admins/{adminProfile.uid}
        </Text>

        <View style={styles.canteenList}>
          {adminProfile.canteenIds.map((canteenId) => (
            <View key={canteenId} style={styles.canteenTag}>
              <Text style={styles.canteenText}>{canteenId}</Text>
            </View>
          ))}
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Notice (Step 4 Scope)</Text>
          <Text style={styles.infoText}>
            The Admin Order Processing Queue, live orders listener, and menu management
            modules are intentionally out of scope for Step 4 and will be implemented in Step 7.
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out of Admin Console</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 20,
    justifyContent: 'space-between',
  },
  header: {
    marginTop: 30,
    alignItems: 'center',
  },
  badge: {
    backgroundColor: '#DC2626',
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    letterSpacing: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F1F5F9',
  },
  cardSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 16,
  },
  canteenList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  canteenTag: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  canteenText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  infoBox: {
    backgroundColor: '#0B1329',
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  infoTitle: {
    color: '#F59E0B',
    fontWeight: 'bold',
    fontSize: 12,
    marginBottom: 4,
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  signOutButton: {
    backgroundColor: '#EF4444',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  signOutText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
