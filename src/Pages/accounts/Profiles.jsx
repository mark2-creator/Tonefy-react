import React, { useState } from "react";
import "./Profiles.css";

const Profiles = () => {
  const [email] = useState("ahumuzamark21213@gmail.com");
  const [name, setName] = useState("Ahumuza Mark");
  const [youtubeChannelId, setYoutubeChannelId] = useState("");

  const handleSave = (e) => {
    e.preventDefault();
    alert("Profile saved!");
  };

  return (
    <div className="profiles-container">
      <h2>Basic details</h2>

      <form onSubmit={handleSave} className="profile-form">
        <label>
          Email
          <input type="email" value={email} readOnly />
        </label>

        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label>
          YouTube channel ID(s)
          <input
            type="text"
            maxLength={24}
            placeholder="Enter your 24 character YouTube channel ID"
            value={youtubeChannelId}
            onChange={(e) => setYoutubeChannelId(e.target.value)}
          />
          <small className="info-text">
            Add your YouTube channel ID to prevent copyright claims.{" "}
            <a
              href="https://support.google.com/youtube/answer/3250431"
              target="_blank"
              rel="noopener noreferrer"
            >
              Click here to find your YouTube channel ID.
            </a>{" "}
            If you're still facing copyright claims on Youtube for your videos
            you can follow the steps to dispute the copyright claim.
          </small>
        </label>

        <label>
          Change password
          <input type="password" placeholder="Enter new password" />
        </label>

        <button type="submit" className="save-button">
          Save
        </button>
      </form>
    </div>
  );
};

export default Profiles;
