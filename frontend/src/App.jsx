import React, { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import Dashboard from "./Pages/Dashboard";
import Files from "./Pages/Files";
import Templates from "./Pages/Templates";
import Clone from "./Pages/Clone";
import Custom from "./Pages/Custom";
import BrandKits from "./Pages/BrandKits";
import Team from "./Pages/Team";
import Automation from "./Pages/Automation";
import Profiles from "./Pages/accounts/Profiles";
import Usage from "./Pages/accounts/Usage";
import Rewards from "./Pages/accounts/Rewards";
import Referrals from "./Pages/accounts/Referrals";
import Affiliate from "./Pages/accounts/Affiliate";
import Logout from "./Pages/accounts/Logout";

import ProtectedRoute from "./components/ProtectedRoute";
import AuthModal from "./components/AuthModal";
import "@fortawesome/fontawesome-free/css/all.min.css";
import LandingPage from "./components/LandingPage";

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

        {/* Redirect /accounts to /accounts/profiles */}
        <Route path="/accounts" element={<Navigate to="/accounts/profiles" replace />} />


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

        {/* Account Routes */}
        <Route
          path="/accounts/profiles"
          element={
            <ProtectedRoute>
              <Profiles />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounts/usage"
          element={
            <ProtectedRoute>
              <Usage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounts/rewards"
          element={
            <ProtectedRoute>
              <Rewards />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounts/referrals"
          element={
            <ProtectedRoute>
              <Referrals />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounts/affiliate"
          element={
            <ProtectedRoute>
              <Affiliate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounts/logout"
          element={
            <ProtectedRoute>
              <Logout />
            </ProtectedRoute>
          }
        />
      </Routes>

      {/* Global Auth Modal */}
      <AuthModal isOpen={modalOpen} onClose={closeModal} mode={modalMode} />
       
    </>
   
  );
}

export default App;
