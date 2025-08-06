import React from "react";

const FooterSection = () => {
  return (
    <footer className="bg-gray-100 text-gray-800 px-6 py-12">
      <div className="max-w-7xl mx-auto">
        {/* Top */}
        <div className="flex flex-col lg:flex-row justify-between gap-12 border-b border-gray-300 pb-10">
          {/* Branding */}
          <div className="flex-1">
            <h2 className="text-2xl font-semibold mb-4">
              Tonefy – Best text-to-speech and text-to-video software.
            </h2>
            <div className="space-y-1">
              <p>
                G2 Crowd <strong>4.8/5</strong>
              </p>
              <p>
                Capterra <strong>4.8/5</strong>
              </p>
            </div>
          </div>

          {/* Columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 flex-[2]">
            {/* Features */}
            <div>
              <h4 className="font-semibold text-lg mb-3">Features</h4>
              <ul className="space-y-1 text-sm">
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
                <li>
                  <a href="#" className="text-green-600 hover:underline">
                    View all features →
                  </a>
                </li>
              </ul>
            </div>

            {/* Use-cases */}
            <div>
              <h4 className="font-semibold text-lg mb-3">Use-cases</h4>
              <ul className="space-y-1 text-sm">
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

            {/* Resources */}
            <div>
              <h4 className="font-semibold text-lg mb-3">Resources</h4>
              <ul className="space-y-1 text-sm">
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

            {/* Socials */}
            <div>
              <h4 className="font-semibold text-lg mb-3">Connect with us</h4>
              <ul className="space-y-1 text-sm">
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

        {/* Bottom */}
        <div className="flex flex-col md:flex-row justify-between items-center text-sm text-gray-500 mt-8 pt-6 border-t border-gray-300 gap-4">
          <p>© 2025 Nine Thirty Five</p>
          <ul className="flex flex-wrap gap-4">
            <li>Privacy Policy</li>
            <li>Terms of Use</li>
            <li>About</li>
            <li>Media kit</li>
            <li>Light mode</li>
            <li>Cookie settings</li>
          </ul>
        </div>
      </div>
    </footer>
  );
};

export default FooterSection;
