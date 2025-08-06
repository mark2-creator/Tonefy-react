import React from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Sun, ArrowUpRight, HelpCircle, User } from "lucide-react";

const DashboardHeader = () => {
  const navigate = useNavigate();

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
     <div className="px-6 max-w-7xl mx-auto flex items-center justify-between py-3">

        {/* Left Section */}
        <div className="flex items-center space-x-6">
          <span className="text-2xl font-extrabold text-[#2ecc71] select-none cursor-default">
            Tonefy
          </span>
          <button
            className="flex items-center space-x-1 text-[#2ecc71] font-semibold hover:underline"
            title="Upgrade"
          >
            <ArrowUpRight size={16} />
            <span>Upgrade</span>
          </button>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-4 ml-auto">
          <button
            className="p-2 rounded hover:bg-gray-100 transition"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={20} />
          </button>
          <button
            className="p-2 rounded hover:bg-gray-100 transition"
            title="Toggle Theme"
            aria-label="Toggle Theme"
          >
            <Sun size={20} />
          </button>
          <button
            className="p-2 rounded hover:bg-gray-100 transition"
            title="Help"
            aria-label="Help"
          >
            <HelpCircle size={20} />
          </button>
          <button
            className="p-2 rounded hover:bg-gray-100 transition"
            title="Accounts"
            aria-label="Accounts"
            onClick={() => navigate("/accounts")}
          >
            <User size={20} />
          </button>
          <div className="w-8 h-8 rounded-full bg-[#2ecc71] flex items-center justify-center text-white font-semibold select-none cursor-default">
            M
          </div>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
