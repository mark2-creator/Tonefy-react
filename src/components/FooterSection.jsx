import React from "react";

const FooterSection = () => {
  return (
    <footer className="footer">
      <div className="footer-top">
        <div className="branding">
          <h2 className="brand-name">Tonefy – Best text-to-speech and text-to-video software.</h2>
          <div className="ratings">
            <p>G2 Crowd <strong>4.8/5</strong></p>
            <p>Capterra <strong>4.8/5</strong></p>
          </div>
        </div>
        <div className="footer-columns">
          <div>
            <h4>Features</h4>
            <ul>
              <li>Text to video</li>
              <li>AI voiceover</li>
              <li>Idea to video</li>
              <li>AI avatar</li>
              <li>Text to speech</li>
              <li>PPT to video</li>
              <li>Image to video</li>
              <li>Translator</li>
              <li>Thumbnail maker</li>
              <li>Screen recorder</li>
              <li><a href="#">View all features →</a></li>
            </ul>
          </div>
          <div>
            <h4>Use-cases</h4>
            <ul>
              <li>Content Creation</li>
              <li>Business and Corporate</li>
              <li>Training Videos</li>
              <li>Internal Communication</li>
              <li>Marketing and Social Media</li>
              <li>Education and E-Learning</li>
              <li>eCommerce</li>
              <li>Localization and Translation</li>
            </ul>
          </div>
          <div>
            <h4>Resources</h4>
            <ul>
              <li>Guide</li>
              <li>Pricing</li>
              <li>Blog</li>
              <li>Tutorials</li>
              <li>Webinars</li>
              <li>FAQs</li>
              <li>What's new</li>
              <li>Voice samples</li>
              <li>Languages & dialects</li>
              <li>Alternatives</li>
              <li>Tools</li>
              <li>Affiliate program</li>
            </ul>
          </div>
          <div>
            <h4>Connect with us</h4>
            <ul className="socials">
              <li>Email</li>
              <li>Twitter</li>
              <li>Facebook</li>
              <li>LinkedIn</li>
              <li>Instagram</li>
              <li>YouTube</li>
              <li>Community</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <p>© 2025 Nine Thirty Five</p>
        <ul>
          <li>Privacy Policy</li>
          <li>Terms of Use</li>
          <li>About</li>
          <li>Media kit</li>
          <li>Light mode</li>
          <li>Cookie settings</li>
        </ul>
      </div>
    </footer>
  );
};

export default FooterSection;
