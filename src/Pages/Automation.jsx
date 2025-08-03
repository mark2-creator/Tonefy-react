import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/SideBar";
import "./Automation.css";

function Automation() {
  return (
    <>
      <DashboardHeader />
      <SideBar />
      <main className="automation-page">
        <div className="automation-container">
          <h1>Create content at scale!</h1>
          <p className="automation-description">
            Use Zapier, Make, or the API to automatically generate content in Fliki - no manual work needed. To get started, create an automation key for the platform you want to connect.
          </p>
          <button className="automation-button">Create key</button>

          <div className="resource-guides">
            <h2>Resource Guides</h2>
            <p className="guide-subtext">Learn how to set up automation with popular platforms</p>

            <div className="guide-cards">
  <a
    href="https://zapier.com/apps/google-sheets/integrations/youtube"
    target="_blank"
    rel="noopener noreferrer"
    className="guide-card"
  >
    <h3>Zapier Integration</h3>
    <p>
      Turn Google Sheets rows into videos and auto-publish to YouTube.
    </p>
  </a>

  <a
    href="https://www.make.com/en/integrations/blog/youtube"
    target="_blank"
    rel="noopener noreferrer"
    className="guide-card"
  >
    <h3>Make Integration</h3>
    <p>
      Convert blog posts into videos and auto-upload to YouTube.
    </p>
  </a>
</div>

            <p className="support-note">
              Need help? Reach out to us at <a href="mailto:ahumuzamark21213@gmail.com">ahumuzamark21213@gmail.com</a>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

export default Automation;
