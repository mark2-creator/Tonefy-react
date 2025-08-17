import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Sun, Moon, ArrowUpRight, HelpCircle,Star, User } from "lucide-react";
import UpgradeModal from "./UpgradeModal";
import WhatsNewModal from "./WhatsNewModal";




const DashboardHeader = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);

const navigate = useNavigate();


   // Load dark mode preference from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
      setDarkMode(true);
    }
  }, []);

  // Toggle dark mode
  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    if (!darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };
    

  return (
    <>
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
  onClick={() => setIsUpgradeOpen(true)} // ← THIS opens the modal
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
         {/* Dark Mode Toggle */}
            <button
              className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title="Toggle Theme"
              onClick={toggleDarkMode}
            >
              {darkMode ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          {/* Help Button */}
      <button
        className="p-2 rounded hover:bg-gray-100 transition"
        title="What's New"
        aria-label="What's New"
        onClick={() => setIsWhatsNewOpen(true)}
      >
        <Star size={20} />
      </button>
          <button
            className="p-2 rounded hover:bg-gray-100 transition"
            title="Accounts"
            aria-label="Accounts"
            onClick={() => navigate("/accounts")}
          >
            <User size={20} />
            </button>
            <button
  onClick={() => navigate("/help")}
  aria-label="Help"
  className="rounded p-2 bg-white flex items-center justify-center text-black font-semibold select-none cursor-pointer"
>
  <HelpCircle size={20} />
</button>

        

        </div>
      </div>
    </header>
     <UpgradeModal isOpen={isUpgradeOpen} onClose={() => setIsUpgradeOpen(false)} />

      {/* Whats New Modal */}
      <WhatsNewModal isOpen={isWhatsNewOpen} onClose={() => setIsWhatsNewOpen(false)} />
    
      </>
      
  );
};

export default DashboardHeader;
