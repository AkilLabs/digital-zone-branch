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

const ENV_BRANCH_ID = (import.meta.env.VITE_BRANCH_ID || import.meta.env.VITE_STORE_ID || '').trim();

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const login = async (email: string, password: string): Promise<User> => {
    await setPersistence(auth, browserLocalPersistence);

    const result = await signInWithEmailAndPassword(auth, email, password);

    const userDocRef = doc(db, 'users', result.user.uid);
    const userDoc = await getDoc(userDocRef);
    let user: User;

    if (userDoc.exists()) {
      const userData = userDoc.data();
      const isOwnerOrHq =
        userData.role === 'owner' ||
        userData.role === 'hq-admin' ||
        userData.role === 'hub-admin';

      // Owner login credential works on every branch.
      // For branch-scoped users, if VITE_BRANCH_ID is configured on this host, verify branch match.
      if (!isOwnerOrHq && ENV_BRANCH_ID && userData.storeId && userData.storeId !== ENV_BRANCH_ID) {
        await signOut(auth);
        throw new Error(
          'Access Denied: Your login credentials belong to another branch and cannot access this branch host.'
        );
      }

      user = {
        uid: result.user.uid,
        email: result.user.email!,
        role: userData.role,
        displayName: userData.name || result.user.displayName || undefined,
        phone: userData.phone || undefined,
        address: userData.address || undefined,
        joiningDate: userData.joiningDate || undefined,
        hubId: userData.hubId || undefined,
        storeId: ENV_BRANCH_ID || userData.storeId || undefined,
        storeName: userData.storeName || undefined,
        scope: userData.scope || undefined,
      };

      // Admin Device Binding Check (never applies to Owner)
      if (userData.role === 'admin') {
        const storedToken = userData.allowedDeviceToken;
        const localToken = localStorage.getItem('admin_device_token');

        if (!storedToken) {
          const newToken = crypto.randomUUID();
          localStorage.setItem('admin_device_token', newToken);
          await updateDoc(userDocRef, {
            allowedDeviceToken: newToken
          });
          user.allowedDeviceToken = newToken;
        } else {
          if (storedToken !== localToken) {
            await signOut(auth);
            throw new Error('Access Denied: This Branch Admin account is bound to another device. Please contact the Owner.');
          }
        }
      }
    } else {
      user = {
        uid: result.user.uid,
        email: result.user.email!,
        role: 'admin',
        displayName: result.user.displayName || undefined,
        storeId: ENV_BRANCH_ID || undefined,
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
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const token = await user.getIdToken();
          Cookies.set('auth_token', token, {
            expires: 7,
            secure: true,
            sameSite: 'Strict'
          });

          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const isOwnerOrHq =
              userData.role === 'owner' ||
              userData.role === 'hq-admin' ||
              userData.role === 'hub-admin';

            if (!isOwnerOrHq && ENV_BRANCH_ID && userData.storeId && userData.storeId !== ENV_BRANCH_ID) {
              console.warn('Branch mismatch for user on this VITE_BRANCH_ID host. Signing out.');
              await signOut(auth);
              Cookies.remove('auth_token');
              setCurrentUser(null);
              setLoading(false);
              return;
            }

            if (userData.role === 'admin') {
              const storedToken = userData.allowedDeviceToken;
              const localToken = localStorage.getItem('admin_device_token');

              if (storedToken && storedToken !== localToken) {
                console.warn('Unauthorized Admin Device Detected. Logging out.');
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
              phone: userData.phone || undefined,
              address: userData.address || undefined,
              joiningDate: userData.joiningDate || undefined,
              allowedDeviceToken: userData.allowedDeviceToken,
              hubId: userData.hubId || undefined,
              storeId: ENV_BRANCH_ID || userData.storeId || undefined,
              storeName: userData.storeName || undefined,
              scope: userData.scope || undefined,
            });
          } else {
            setCurrentUser({
              uid: user.uid,
              email: user.email!,
              role: 'admin',
              displayName: user.displayName || undefined,
              storeId: ENV_BRANCH_ID || undefined,
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
