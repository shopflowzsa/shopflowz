import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAgHP9tMFFiZJjT86pcanHrAS2aN4VmRvw",
  authDomain: "shopflowz.firebaseapp.com",
  projectId: "shopflowz",
  storageBucket: "shopflowz.firebasestorage.app",
  messagingSenderId: "42929223606",
  appId: "1:42929223606:web:0a1d7448bacb6f5b3a3317",
  measurementId: "G-QX21MM2R3C",
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);

// Remaining Firebase services are handled by Supabase — these stubs prevent
// import errors in files not yet migrated.
export const auth = null as any;
export const db = null as any;
export const storage = null as any;
export const functions = null as any;
