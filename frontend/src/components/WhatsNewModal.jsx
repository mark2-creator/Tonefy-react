import React from "react";

export default function WhatsNewModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white max-w-3xl w-full max-h-[90vh] rounded-lg shadow-lg overflow-y-auto p-6 relative text-left">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 text-xl font-bold"
        >
          &times;
        </button>

        <h2 className="text-2xl font-bold mb-6 text-center">🚀 What’s New</h2>

        {/* Card: Custom video templates */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold">🎬 Custom video templates</h3>
          <p className="text-sm text-gray-500 mb-2">June 20, 2025</p>
          <p className="mb-2">
            Design once, scale forever. Tonefy’s new Custom video templates lets you build reusable video blueprints – perfect for automating high-quality content at scale while preserving your unique brand style.
          </p>
          <h4 className="font-medium mt-3 mb-1">How It Works</h4>
          <ol className="list-decimal list-inside space-y-1 text-gray-700 text-sm">
            <li>Convert a file to a template – Turn any video you've made in Tonefy into a smart template from the file menu.</li>
            <li>Define structure with keys and prompts – Label scenes as intro, body, outro, and guide Tonefy’s AI.</li>
            <li>Set up visuals, voice, and logic – Control narrator, lock assets, or let AI generate them per your rules.</li>
            <li>Use with automation – Combine with workflows, Zapier, Make, or CSV to auto-generate content.</li>
          </ol>
          <p className="mt-3 text-sm">
            Whether you're a business maintaining brand identity or a creator using custom effects – custom templates let you automate without sacrificing design.{" "}
            <a href="#" className="text-[#2ecc71] underline">Learn more</a>
          </p>
        </div>

        {/* Card: Zapier and Make */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold">🔄 Zapier and Make integration</h3>
          <p className="text-sm text-gray-500 mb-2">June 11, 2025</p>
          <p className="mb-2">
            Automate your content pipeline with Zapier and Make integrations – trigger Tonefy from any app you use.
          </p>
          <h4 className="font-medium mt-3 mb-1">How It Works</h4>
          <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
            <li>Connect Tonefy to Zapier/Make from the Automation tab.</li>
            <li>Set up a trigger → e.g., new row in Google Sheets.</li>
            <li>Define the action → Tonefy auto-generates content.</li>
            <li>Use additional steps to post or store your file.</li>
          </ol>
          <p className="mt-3 text-sm">
            Whether you're posting daily Instagram videos or automating onboarding – Tonefy + Zapier/Make gives hands-free automation.
          </p>
        </div>

        {/* Card: Editor Copilot */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold">✨ Editor Copilot</h3>
          <p className="text-sm text-gray-500 mb-2">June 03, 2025</p>
          <p className="text-sm">
            Meet Editor Copilot – your AI-powered editing assistant. Just describe your vision and let Copilot handle the rest. It understands your scene context, visual layers, and styles and applies precise edits for you.
          </p>
        </div>

        {/* Card: Video Embeds */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold">🎥 Video embeds</h3>
          <p className="text-sm text-gray-500 mb-2">May 29, 2025</p>
          <p className="text-sm">
            After exporting, you’ll now see an Embed Code option. Drop it into your site, blog, or LMS – embedding your content is now effortless.
          </p>
        </div>

        {/* Card: Bulk Create */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold">📦 Bulk create</h3>
          <p className="text-sm text-gray-500 mb-2">May 16, 2025</p>
          <p className="text-sm">
            Generate multiple videos or audios at once using a single CSV. Perfect for batch production at scale.
          </p>
          <h4 className="font-medium mt-3 mb-1">How It Works</h4>
          <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
            <li>Click Bulk create on the Files page.</li>
            <li>Prepare a CSV with templates, voices, prompts, etc.</li>
            <li>Upload and hit submit to batch create content.</li>
          </ol>
        </div>

        <div className="text-center">
          <button className="text-[#2ecc71] font-semibold hover:underline">Load more</button>
        </div>
      </div>
    </div>
  );
}
