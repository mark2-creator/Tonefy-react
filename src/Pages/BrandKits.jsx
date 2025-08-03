// src/pages/BrandKits.jsx
import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/SideBar";
import { Palette } from "lucide-react";
import "./BrandKits.css"; // Optional styling

function BrandKits() {
  return (
    <>
      <DashboardHeader />
      <SideBar />
      <main className="brandkits-page">
        <div className="breadcrumb-box">
          <span className="breadcrumb-text">Brand Kits</span>
        </div>

        <h1 className="brandkits-heading">
          <Palette size={24} color="#2ecc71" />
          <span>Uniform and on-brand look for your videos!</span>
        </h1>

        <p className="brandkits-description">
          Define your brand's fonts, colors, watermark and other brand details which can be applied to your video automatically.
        </p>

        <div className="brandkits-action">
          <button className="brandkits-add-btn">Add New Brand</button>
        </div>
      </main>
    </>
  );
}

export default BrandKits;
