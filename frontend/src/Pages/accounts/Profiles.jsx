import React, { useState } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import AccountsSidebar from "../../components/AccountsSidebar";
const Profiles = () => {
  const [email] = useState("ahumuzamark21213@gmail.com");
  const [name, setName] = useState("Ahumuza Mark");
  const [youtubeChannelId, setYoutubeChannelId] = useState("");

  const handleSave = (e) => {
    e.preventDefault();
    alert("Profile saved!");
  };

  return (
    <>
    <DashboardHeader/>
    <AccountsSidebar/>
      <div className=" ml-36 mt-16 px-6 py-10 bg-gray-300 mx-auto  rounded-md shadow-md min-h-screen">
        <h2 className="text-2xl font-semibold mb-6">Basic details</h2>

        <form onSubmit={handleSave} className="space-y-6">
          <label className="block">
            <span className="block text-gray-700 font-medium mb-1">Email</span>
            <input
              type="email"
              value={email}
              readOnly
              className="w-full rounded border border-black bg-white px-3 py-2 cursor-not-allowed"
            />
          </label>

          <label className="block">
            <span className="block text-gray-700 font-medium mb-1">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded border border-black bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400"
            />
          </label>

          <label className="block">
            <span className="block text-gray-700 font-medium mb-1">YouTube channel ID(s)</span>
            <input
              type="text"
              maxLength={24}
              placeholder="Enter your 24 character YouTube channel ID"
              value={youtubeChannelId}
              onChange={(e) => setYoutubeChannelId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <small className="text-gray-500 block mt-2 text-sm">
              Add your YouTube channel ID to prevent copyright claims.{" "}
              <a
                href="https://support.google.com/youtube/answer/3250431"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-600 underline hover:text-green-700"
              >
                Click here to find your YouTube channel ID.
              </a>{" "}
              If you're still facing copyright claims on YouTube, you can follow the steps to dispute the copyright claim.
            </small>
          </label>

          <label className="block">
            <span className="block text-gray-700 font-medium mb-1">Change password</span>
            <input
              type="password"
              placeholder="Enter new password"
              className="w-full rounded bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400"
            />
          </label>

          <button
            type="submit"
            className="bg-green-500 hover:bg-green-600 text-green-500 font-semibold px-6 py-2 rounded transition"
          >
            Save
          </button>
        </form>
      </div>
    </>
  );
};

export default Profiles;
