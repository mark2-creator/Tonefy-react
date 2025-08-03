// src/pages/Custom.jsx
import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/SideBar";
import { UserPlus } from "lucide-react";
import "./Custom.css"; // optional

function Custom() {
  return (
    <>
      <DashboardHeader />
      <SideBar />
      <main className="custom-page">
        <div className="breadcrumb">
  <span className="breadcrumb-parent">Voices</span>
  <span className="breadcrumb-separator">/</span>
  <span className="breadcrumb-current">Custom</span>
</div>

        <h1 className="custom-heading">
          <UserPlus size={24} color="#2ecc71" />
          <span>Create Custom Voice</span>
        </h1>
        <p className="custom-description">
          Define a unique voice by customizing pitch, speed, and tone. Great for brand personalization.
        </p>

        <div className="custom-config-section">
          <button className="custom-config-btn">Start Customization</button>
          <p className="custom-note">More settings coming soon!</p>
        </div>
      </main>
    </>
  );
}

export default Custom;
