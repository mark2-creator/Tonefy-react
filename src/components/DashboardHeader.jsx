// src/components/DashboardHeader.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Sun, ArrowUpRight, HelpCircle, User } from "lucide-react";

const DashboardHeader = () => {
  const navigate = useNavigate();

  return (
    <header className="dashboard-header">
      {/* Left Section */}
      <div className="header-left">
        <span className="logo">Tonefy</span>
        <button className="upgrade-btn">
          <ArrowUpRight size={16} />
          <span>Upgrade</span>
        </button>
      </div>

      {/* Right Section */}
      <div className="header-right">
        <button className="icon-btn" title="Notifications">
          <Bell size={20} />
        </button>
        <button className="icon-btn" title="Toggle Theme">
          <Sun size={20} />
        </button>
        <button className="icon-btn" title="Help">
          <HelpCircle size={20} />
        </button>
        <button
          className="icon-btn"
          title="Accounts"
          onClick={() => navigate("/accounts")}
        >
          <User size={20} />
        </button>
        <div className="avatar">M</div>
      </div>
    </header>
  );
};

export default DashboardHeader;
