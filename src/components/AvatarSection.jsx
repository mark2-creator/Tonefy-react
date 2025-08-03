import React from "react";

function AvatarSection() {
  return (
    <section className="avatar-section">
      <div className="avatar-videos">
        <div className="video-box">Video 1</div>
        <div className="video-box">Video 2</div>
        <div className="video-box">Video 3</div>
        <div className="video-box">Video 4</div>
      </div>

      <div className="avatar-content">
        <h2>Add personality to your videos with engaging AI avatars</h2>
        <p>
          With Tonefy’s AI avatars, you don’t need to be on camera or cast anyone
          to add a face and personality to your videos.
        </p>
        <button className="cta-button">Start creating with 70+ avatars</button>
      </div>
    </section>
  );
}

export default AvatarSection;
