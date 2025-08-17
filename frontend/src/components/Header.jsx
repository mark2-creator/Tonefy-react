import React from "react";

export default function Header({ openModal }) {
  return (
    <header className="w-full bg-white shadow-sm sticky top-0 z-50 h-16 flex items-center justify-between px-6">

      {/* Logo */}
      <div className="text-2xl font-bold text-black">Tonefy AI</div>

      {/* Navigation */}
      <nav className="hidden md:flex items-center gap-6 text-gray-700 text-sm font-medium">
        <a href="#" className="hover:text-[#2ecc71] transition">Features</a>
        <a href="#" className="hover:text-[#2ecc71] transition">Use cases</a>
        <a href="#" className="hover:text-[#2ecc71] transition">Explore</a>
        <a href="#" className="hover:text-[#2ecc71] transition">Pricing</a>
        <span className="bg-[#2ecc71] text-white text-xs font-semibold px-2 py-1 rounded-full">
          50% off!
        </span>
      </nav>

      {/* Auth Buttons */}
      <div className="flex items-center gap-5">
        <button
          onClick={() => openModal("login")}
          className="text-blue-700 font-medium hover:underline"
        >
          Login
        </button>
        <button
          onClick={() => openModal("signup")}
          className="bg-gray-100 text-blue-700 px-4 py-2 rounded-lg font-medium hover:underline transition"
        >
          Signup
        </button>
      </div>
    </header>
  );
}
