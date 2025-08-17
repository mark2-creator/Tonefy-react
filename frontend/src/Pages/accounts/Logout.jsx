import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";

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

  if (!showModal) return null;

  return (
    <div className="fixed inset-0 bg-gray-300 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full text-center">
        <h2 className="text-xl font-semibold mb-6">Are you sure you want to logout?</h2>
        <div className="flex justify-center gap-4">
          <button
            onClick={handleCancel}
            className="px-6 py-2 rounded-md bg-blue-500 border-black hover:bg-[#2ecc71] transition"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmLogout}
            className="px-6 py-2 rounded-md bg-blue-500 text-black hover:bg-[#2ecc71] transition"
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
};

export default Logout;
