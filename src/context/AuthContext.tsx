import React, { createContext, useContext, useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import type { User } from '../types';

interface AuthContextType {
  currentUser: User | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => {
  return useContext(AuthContext);
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const login = async (email: string, password: string): Promise<User> => {
    // Use browserLocalPersistence (localStorage) for reliable sessions
    await setPersistence(auth, browserLocalPersistence);

    const result = await signInWithEmailAndPassword(auth, email, password);

    // Fetch user role from Firestore
    const userDocRef = doc(db, 'users', result.user.uid);
    const userDoc = await getDoc(userDocRef);
    let user: User;

    if (userDoc.exists()) {
      const userData = userDoc.data();
      user = {
        uid: result.user.uid,
        email: result.user.email!,
        role: userData.role,
        displayName: userData.name || result.user.displayName || undefined,
        // Multi-store fields – required by StoreContext to scope Firestore queries
        hubId: userData.hubId || undefined,
        storeId: userData.storeId || undefined,
        scope: userData.scope || undefined,
      };

      // Admin Device Binding Check
      if (userData.role === 'admin') {
        const storedToken = userData.allowedDeviceToken;
        const localToken = localStorage.getItem('admin_device_token');

        if (!storedToken) {
          // First time login - Bind this device
          const newToken = crypto.randomUUID();
          localStorage.setItem('admin_device_token', newToken);
          await updateDoc(userDocRef, {
            allowedDeviceToken: newToken
          });
          user.allowedDeviceToken = newToken;
        } else {
          // Subsequent login - Verify device
          if (storedToken !== localToken) {
            await signOut(auth);
            throw new Error("Access Denied: This Admin account is bound to another device. Please contact the owner.");
          }
        }
      }
    } else {
      // Default role if user not found in Firestore
      user = {
        uid: result.user.uid,
        email: result.user.email!,
        role: 'employee',
        displayName: result.user.displayName || undefined
      };
    }

    setCurrentUser(user);
    return user;
  };

  const logout = async () => {
    await signOut(auth);
    setCurrentUser(null);
  };

  useEffect(() => {
    // Set up auth state listener that persists across page reloads
    // We use onIdTokenChanged to ensure we always have the latest token in cookies
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // Professional: Sync token to cookies for "Enterprise" feel and potential middleware usage
          const token = await user.getIdToken();
          Cookies.set('auth_token', token, {
            expires: 7, // 7 days
            secure: true, // Only send over HTTPS
            sameSite: 'Strict' // Protect against CSRF
          });

          // Fetch user role from Firestore
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();

            // Admin Device Verification on Auto-Login/Refresh
            if (userData.role === 'admin') {
              const storedToken = userData.allowedDeviceToken;
              const localToken = localStorage.getItem('admin_device_token');

              // If token exists in DB but doesn't match local (or local is missing), deny access
              if (storedToken && storedToken !== localToken) {
                console.warn("Unauthorized Admin Device Detected. Logging out.");
                await signOut(auth);
                Cookies.remove('auth_token');
                setCurrentUser(null);
                setLoading(false);
                return;
              }
            }

            setCurrentUser({
              uid: user.uid,
              email: user.email!,
              role: userData.role,
              displayName: userData.name || user.displayName || undefined,
              allowedDeviceToken: userData.allowedDeviceToken,
              // Multi-store fields – required by StoreContext to scope Firestore queries
              hubId: userData.hubId || undefined,
              storeId: userData.storeId || undefined,
              scope: userData.scope || undefined,
            });
          } else {
            setCurrentUser({
              uid: user.uid,
              email: user.email!,
              role: 'employee',
              displayName: user.displayName || undefined
            });
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          Cookies.remove('auth_token');
          setCurrentUser(null);
        }
      } else {
        Cookies.remove('auth_token');
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    login,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};