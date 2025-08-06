// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBoSKk1ksYQwRkyLBPtKIaxiHIZQWTra_A",
  authDomain: "tonefy-ai.firebaseapp.com",
  projectId: "tonefy-ai",
  storageBucket: "tonefy-ai.firebasestorage.app",
  messagingSenderId: "470341006022",
  appId: "1:470341006022:web:b5d770a96a2f70bf25ddc7",
  measurementId: "G-LGB9Z3HBNW",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// ✅ Export the auth instance for use in AuthModal
export const auth = getAuth(app);
