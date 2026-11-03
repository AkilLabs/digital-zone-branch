import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore } from 'firebase/firestore';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyCsUSlHjZb8-wVXcAg1RsonzeNil6_q8u8",
  authDomain: "tallyon-2501d.firebaseapp.com",
  projectId: "tallyon-2501d",
  storageBucket: "tallyon-2501d.firebasestorage.app",
  messagingSenderId: "307830976053",
  appId: "1:307830976053:web:a083fc08fc4d65724a0b7c",
  measurementId: "G-7VTEF13MKY"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Set persistence to browserLocalPersistence (localStorage) for consistent session retention
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Error setting auth persistence:", error);
});

// Initialize Cloud Firestore with offline persistence
// Try-catch allows Vite HMR (Hot Module Replacement) to gracefully fall back to the existing instance without crashing

let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()}),
    experimentalForceLongPolling: true,
    ignoreUndefinedProperties: true
  });
} catch (error) {
  firestoreInstance = getFirestore(app);
}

export const db = firestoreInstance;

// Initialize Firebase Storage and get a reference to the service
export const storage = getStorage(app);

// Initialize Firebase Functions and get a reference to the service
export const functions = getFunctions(app);

export default app;
