import React, { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";

import { auth } from "../firebase";

const AuthModal = ({ isOpen, onClose, mode = "login" }) => {
  const [isLogin, setIsLogin] = useState(mode === "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");

  const navigate = useNavigate();

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setMessage("");
  };

  useEffect(() => {
    if (isOpen) {
      setIsLogin(mode === "login");
      resetForm();
    }
  }, [isOpen, mode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(isLogin ? "🔄 Logging in..." : "🔄 Creating account...");

    if (isLogin) {
      try {
        await signInWithEmailAndPassword(auth, email, password);
        setMessage("✅ Login successful! Redirecting...");
        setTimeout(() => {
          resetForm();
          onClose();
          navigate("/dashboard");
        }, 1000);
      } catch (error) {
        console.error("Login error:", error);
        setMessage("❌ Invalid email or password.");
      }
    } else {
      if (password !== confirmPassword) {
        setMessage("❌ Passwords do not match.");
        return;
      }

      try {
        await createUserWithEmailAndPassword(auth, email, password);
        setMessage("✅ Signup successful! Redirecting...");
        setTimeout(() => {
          resetForm();
          onClose();
          navigate("/dashboard");
        }, 1000);
      } catch (error) {
        console.error("Signup error:", error);
        setMessage(`❌ Signup failed: ${error.message}`);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setMessage("✅ Google sign-in successful! Redirecting...");
      setTimeout(() => {
        resetForm();
        onClose();
        navigate("/dashboard");
      }, 1000);
    } catch (error) {
      console.error("Google sign-in error:", error);
      setMessage("❌ Google sign-in failed.");
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setMessage("❌ Please enter your email first.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("✅ Password reset email sent!");
    } catch (error) {
      console.error("Reset error:", error);
      setMessage("❌ Failed to send reset email. Try again.");
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={handleClose} type="button">
          &times;
        </button>

        <form onSubmit={handleSubmit} autoComplete="off">
          <h2>{isLogin ? "Login to Tonefy" : "Sign Up for Tonefy"}</h2>

          {message && <p className="success">{message}</p>}

          <div className="input-group">
            <input
              type="email"
              placeholder="Email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-group password-input-wrapper">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="show-password-btn"
              onClick={() => setShowPassword((prev) => !prev)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>

          {isLogin && (
            <p
              className="forgot-password"
              onClick={handleForgotPassword}
              style={{ cursor: "pointer" }}
            >
              Forgot Password?
            </p>
          )}

          {!isLogin && (
            <div className="input-group">
              <input
                type="password"
                placeholder="Confirm Password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          )}

          <button
            type="submit"
            className={isLogin ? "login-button" : "signup-button"}
          >
            {isLogin ? "Login" : "Sign Up"}
          </button>

          <div className="divider">or</div>

          <button
            type="button"
            className="google-button"
            onClick={handleGoogleSignIn}
          >
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              alt="Google"
              className="google-icon"
            />
            Continue with Google
          </button>

          <p className="toggle-text">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <span
              className="toggle-link"
              onClick={() => {
                setIsLogin(!isLogin);
                resetForm();
              }}
            >
              {isLogin ? "Sign Up" : "Login"}
            </span>
          </p>
        </form>
      </div>
    </div>
  );
};

export default AuthModal;
