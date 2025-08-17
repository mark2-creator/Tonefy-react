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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={handleClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-2 right-4 text-2xl text-gray-500 hover:text-red-500"
          onClick={handleClose}
        >
          &times;
        </button>

        <form onSubmit={handleSubmit} className="space-y-5">
          <h2 className="text-2xl font-bold text-center mb-2">
            {isLogin ? "Login to Tonefy" : "Sign Up for Tonefy"}
          </h2>

          {message && <p className="text-sm text-center text-gray-600">{message}</p>}

          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2ecc71]"
            />
          </div>

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg pr-10 focus:outline-none focus:ring-2 focus:ring-[#2ecc71]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute inset-y-0 right-3 flex items-center bg-transparent text-[#2ecc71]"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>

          {isLogin && (
            <p
              className="text-sm text-right text-blue-600 hover:underline cursor-pointer"
              onClick={handleForgotPassword}
            >
              Forgot Password?
            </p>
          )}

          {!isLogin && (
            <div>
              <input
                type="password"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2ecc71]"
              />
            </div>
          )}

          <button
            type="submit"
 className="w-full flex items-center justify-center gap-2 border border-gray-300 py-2 rounded-lg hover:bg-gray-100 transition"
          >
            {isLogin ? "Login" : "Sign Up"}
          </button>

          <div className="text-center text-gray-500 my-2">or</div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-2 border border-gray-300 py-2 rounded-lg hover:bg-gray-100 transition"
          >
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              alt="Google"
              className="w-5 h-5"
            />
            <span className="font-medium">Continue with Google</span>
          </button>

          <p className="text-sm text-center mt-4">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <span
              className="text-[#2ecc71] font-medium hover:underline cursor-pointer"
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
