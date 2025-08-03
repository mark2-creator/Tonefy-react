import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/SideBar";
import "./Team.css";

function Team() {
  return (
    <>
      <DashboardHeader />
      <SideBar />
      <main className="team-page">
        <div className="team-container">
          <h1>Create content, together!</h1>
          <p className="team-description">
            Bring your team together and effortlessly create high-quality videos, audio and design content at scale, perfect for teams of any size and in any industry.
          </p>
          <p className="team-info">
            Create team to add members and manage their billing from one account.
            Additional seat follows same pricing and payment cycle as active on team owner account, more details here.
          </p>
          <button className="team-button">Create team</button>
        </div>
      </main>
    </>
  );
}

export default Team;
