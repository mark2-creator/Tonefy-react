import React from "react";
import DashboardHeader from "../../components/DashboardHeader";
import AccountsSidebar from "../../components/AccountsSidebar"


const Rewards = () => {
  return (
    <>
      <DashboardHeader />
      <AccountsSidebar/>
     <div className=" ml-40 mt-16 px-6 py-10 bg-white rounded-md shadow-md min-h-screen">

      <div>
        <h2 className="text-2xl font-bold text-gray-800">Rewards</h2>
        <p className="text-gray-600 mt-1">Want to increase your credits? 🚀</p>
        <p className="text-gray-600">
          Earn up to 18 minutes of credits by spreading a word about Tonefy!
        </p>
      </div>

      {/* Video Sharing Section */}
      <section className="bg-gray-50 p-4 rounded-md shadow-sm space-y-3">
        <h3 className="text-xl font-semibold text-gray-700">
          🎥 Share videos created with Tonefy on socials
        </h3>
        <p className="text-gray-600">
          Earn <strong>2 credits</strong> for each video you share on the following platforms:
        </p>
        <ul className="list-disc list-inside text-gray-600 grid grid-cols-2 sm:grid-cols-3 gap-1">
          <li>YouTube</li>
          <li>TikTok</li>
          <li>Instagram</li>
          <li>Facebook</li>
          <li>LinkedIn</li>
          <li>Twitter</li>
        </ul>
        <p className="text-sm text-gray-500">Make sure to tag Tonefy in your post or description.</p>

        <div className="space-y-1">
          <h4 className="text-md font-medium text-gray-700">Submit your posts</h4>
          <p className="text-gray-600">
            Upload screenshots or provide links to your posts here. We'll verify and add credits to your account.
            Verification typically takes up to 24 hours, and we'll notify you via email once it's complete.
          </p>
          <button className="mt-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm font-semibold">
            Start submitting
          </button>
        </div>
      </section>

      {/* Review Sharing Section */}
      <section className="bg-gray-50 p-4 rounded-md shadow-sm space-y-3">
        <h3 className="text-xl font-semibold text-gray-700">⭐️ Give genuine reviews about Tonefy</h3>
        <p className="text-gray-600">
          Earn <strong>1 credit</strong> for each genuine review you post on the following platforms:
        </p>
        <ul className="list-disc list-inside text-gray-600 grid grid-cols-2 sm:grid-cols-3 gap-1">
          <li>Facebook</li>
          <li>LinkedIn</li>
          <li>Twitter</li>
          <li>G2 Crowd</li>
          <li>Trustpilot</li>
          <li>Capterra</li>
        </ul>

        <div className="space-y-1">
          <h4 className="text-md font-medium text-gray-700">Submit your posts</h4>
          <p className="text-gray-600">
            Upload screenshots or provide links to your posts here. We'll verify and add credits to your account.
            Verification typically takes up to 24 hours, and we'll notify you via email once it's complete.
          </p>
          <button className="mt-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm font-semibold">
            Start submitting
          </button>
        </div>
      </section>

      <p className="text-center text-gray-700 font-medium">That's it! Help us, help you! ❤️</p>
    </div>
    </>
  );
};

export default Rewards;
