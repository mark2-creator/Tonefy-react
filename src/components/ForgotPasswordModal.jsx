import React, { useState, useEffect } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase";

const ForgotPasswordModal = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isOpen) {
      setEmail("");
      setMessage("");
    }
  }, [isOpen]);

  const handleReset = async (e) => {
    e.preventDefault();
    if (!email) {
      setMessage("❌ Please enter your email.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("✅ Password reset email sent!");
    } catch (error) {
      console.error("Password reset error:", error);
      setMessage("❌ Failed to send reset email.");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-2 right-4 text-2xl text-gray-500 hover:text-red-500"
          onClick={onClose}
        >
          &times;
        </button>

        <form onSubmit={handleReset} className="space-y-5">
          <h2 className="text-2xl font-bold text-center">Reset Your Password</h2>

          {message && (
            <p
              className={`text-sm text-center ${
                message.startsWith("✅") ? "text-green-600" : "text-red-600"
              }`}
            >
              {message}
            </p>
          )}

          <div>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2ecc71]"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[#2ecc71] hover:bg-green-600 text-white font-semibold py-2 rounded-lg transition"
          >
            Send Reset Email
          </button>
        </form>
      </div>
    </div>
  );
};

export default ForgotPasswordModal;
