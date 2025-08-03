import React, { useState } from "react";
import { Routes, Route } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Files from "./pages/Files";
import Templates from "./pages/Templates";
import Clone from "./pages/Clone";
import Custom from "./pages/Custom";
import BrandKits from "./pages/BrandKits";
import Team from "./pages/Team";
import Automation from "./pages/Automation";
import AccountsLayout from "./pages/accounts/AccountsLayout";
import Profiles from "./pages/accounts/Profiles";
import Usage from "./pages/accounts/Usage";
import Rewards from "./pages/accounts/Rewards";
import Referrals from "./pages/accounts/Referrals";
import Affiliate from "./pages/accounts/Affiliate";
import Logout from "./pages/Accounts/Logout";

import ProtectedRoute from "./components/ProtectedRoute"; // ✅ correct name used
import AuthModal from "./components/AuthModal";
import "@fortawesome/fontawesome-free/css/all.min.css"; // ✅ correct
import LandingPage from "./components/LandingPage";
import '@fortawesome/fontawesome-free/css/all.min.css';

import LovedBySection from "./components/LovedBySection";

import "./input.css";

function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("login");

  const openModal = (mode) => {
    setModalMode(mode);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  return (
    <>
      <Routes>
        {/* Public Route */}
        <Route path="/" element={<LandingPage openModal={openModal} />} />

        {/* Protected Routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/files"
          element={
            <ProtectedRoute>
              <Files />
            </ProtectedRoute>
          }
        />
        <Route
          path="/templates"
          element={
            <ProtectedRoute>
              <Templates />
            </ProtectedRoute>
          }
        />
        <Route
          path="/voices/clone"
          element={
            <ProtectedRoute>
              <Clone />
            </ProtectedRoute>
          }
        />
        <Route
          path="/voices/custom"
          element={
            <ProtectedRoute>
              <Custom />
            </ProtectedRoute>
          }
        />
        <Route
          path="/brand-kits"
          element={
            <ProtectedRoute>
              <BrandKits />
            </ProtectedRoute>
          }
        />
        <Route
          path="/team"
          element={
            <ProtectedRoute>
              <Team />
            </ProtectedRoute>
          }
        />
        <Route
          path="/automation"
          element={
            <ProtectedRoute>
              <Automation />
            </ProtectedRoute>
          }
        />
        <Route
          path="/logout"
          element={
            <ProtectedRoute>
              <Logout />
            </ProtectedRoute>
          }
        />

        {/* Nested Protected Account Routes */}
        <Route
          path="/accounts/*"
          element={
            <ProtectedRoute>
              <AccountsLayout />
            </ProtectedRoute>

          }
        >
          <Route index element={<Profiles />} />
          <Route path="profiles" element={<Profiles />} />
          <Route path="usage" element={<Usage />} />
          <Route path="rewards" element={<Rewards />} />
          <Route path="referrals" element={<Referrals />} />
          <Route path="affiliate" element={<Affiliate />} />
          <Route path="logout" element={<Logout />} />
        </Route>
      </Routes>

      {/* Global Auth Modal */}
      <AuthModal isOpen={modalOpen} onClose={closeModal} mode={modalMode} />
    </>
  );
}

export default App;
