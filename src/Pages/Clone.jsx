// src/pages/Clone.jsx
import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/SideBar";
import { Wand2 } from "lucide-react";
import "./Clone.css"; // Optional custom styles

function Clone() {
  return (
    <>
      <DashboardHeader />
      <SideBar />
      <main className="clone-page">
        <div className="clone-container">
          <div className="breadcrumb-box">
  <span className="breadcrumb-text">Voices</span>
  <span className="breadcrumb-separator">/</span>
  <span className="breadcrumb-text">Clone</span>
</div>

          <h1 className="clone-heading">
            <Wand2 size={24} color="#2ecc71" />
            <span>Create a clone of your voice that sounds just like you</span>
          </h1>

          <p className="clone-description">
            Record two minutes of your voice, then generate any number of voice-overs in your own voice using just text.
          </p>

          <div className="clone-upload-section">
            <button className="clone-upload-btn">Upload Voice Sample</button>
            <p className="clone-note">Supported formats: MP3, WAV • Max size: 5MB</p>
          </div>
        </div>
      </main>
    </>
  );
}

export default Clone;
