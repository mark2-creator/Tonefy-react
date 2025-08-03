// src/pages/Accounts/Logout.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import "./Logout.css"; // Optional: style file

const Logout = () => {
  const [showModal, setShowModal] = useState(true);
  const navigate = useNavigate();

  const handleConfirmLogout = () => {
    signOut(auth)
      .then(() => {
        console.log("✅ User logged out");
        navigate("/");
      })
      .catch((error) => {
        console.error("❌ Logout error:", error);
      });
  };

  const handleCancel = () => {
    navigate(-1); // Go back to previous page
  };

  return (
    <>
      {showModal && (
        <div className="logout-modal-overlay">
          <div className="logout-modal">
            <h2>Are you sure you want to logout?</h2>
            <div className="logout-buttons">
              <button className="cancel-button" onClick={handleCancel}>
                Cancel
              </button>
              <button className="confirm-button" onClick={handleConfirmLogout}>
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Logout;
