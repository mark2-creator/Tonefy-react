// src/components/ProtectedRoute.jsx
import React from "react";
import { Navigate } from "react-router-dom";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import FullPageLoader from "./FullPageLoader"; // Ensure this file exists

const ProtectedRoute = ({ children }) => {
  const [user, loading] = useAuthState(auth);

  if (loading) {
    return <FullPageLoader />;
  }

  return user ? children : <Navigate to="/" replace />;
};

export default ProtectedRoute;
