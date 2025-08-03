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
    <div className="modal-overlay" onClick={onClose}>
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose} type="button">
          &times;
        </button>

        <form onSubmit={handleReset}>
          <h2>Reset Your Password</h2>

          {message && <p className="success">{message}</p>}

          <div className="input-group">
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="login-button">
            Send Reset Email
          </button>
        </form>
      </div>
    </div>
  );
};

export default ForgotPasswordModal;
