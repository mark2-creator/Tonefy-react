// src/pages/Templates.jsx
import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/SideBar";

const Templates = () => {
  return (
    <div className="templates-wrapper">
      <SideBar />
      <div className="templates-full">
        <DashboardHeader />

        <div className="templates-main">
          <div className="templates-content">
            <div className="template-card">
              <div className="template-left">
                <h2 className="template-title">Templates</h2>
              </div>
              <div className="template-right">
                <button className="template-btn">
                  9:16
                  <br />
                  <small>(Portrait)</small>
                </button>
                <button className="template-btn">
                  1:1
                  <br />
                  <small>(Square)</small>
                </button>
                <button className="template-btn">
                  16:9
                  <br />
                  <small>(Landscape)</small>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Templates;
