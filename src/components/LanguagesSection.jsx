import React from "react";

function LanguagesSection() {
  return (
    <section className="languages-section">
     

      <div className="languages-text">
        <h2>No more waiting for voiceover artists and translators</h2>
        <p>
          With Tonefy’s AI voiceover, choose from 2500+ ultra-realistic voices,
          translate into 80+ languages with one click, and even clone your own voice.
        </p>
        <div className="video-placeholder">
          <span>Video Placeholder</span>
        </div>
         <div className="languages-grid">
        <div className="language-item">🇺🇸 <span>English</span></div>
        <div className="language-item">🇩🇪 <span>German</span></div>
        <div className="language-item">🇫🇷 <span>French</span></div>
        <div className="language-item">🇪🇸 <span>Spanish</span></div>
        <div className="language-item">🇧🇷 <span>Portuguese</span></div>
        <div className="language-item">🇦🇪 <span>Arabic</span></div>
      </div>
        <button className="explore-button">Explore all voices</button>
      </div>
    </section>
  );
}

export default LanguagesSection;
