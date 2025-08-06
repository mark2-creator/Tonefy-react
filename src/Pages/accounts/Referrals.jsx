import React from "react";
import DashboardHeader from "../../components/DashboardHeader";
import AccountsSidebar  from "../../components/AccountsSidebar";
const Referrals = () => {
  const referralLink = "https://tonefy.ai?referral=ahumuza-mark-6eramj";

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink);
    alert("Referral link copied to clipboard!");
  };

  return (
    <>
    <DashboardHeader/>
    <AccountsSidebar/>
     <div className=" ml-40 mt-16 px-6 py-10 bg-gray-500 rounded-md shadow-md min-h-screen">
      
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Referrals</h1>
      <p className="text-lg text-gray-700 mb-6">Referral program ❤️</p>

      <div className="bg-white shadow rounded-lg p-6 mb-8">
        <p className="text-md text-gray-700 mb-4">
          Invite your friends to <span className="font-semibold text-[#2ecc71]">Tonefy</span> and earn up to <span className="font-bold">120 credits</span> 🤯😍!
        </p>

        <h2 className="text-xl font-semibold text-gray-800 mt-6 mb-2">How it works</h2>
        <ul className="list-disc list-inside text-gray-700 space-y-2">
          <li>
            <span className="font-medium">Share your referral link:</span> Copy your unique referral link below and share it with your friends.
          </li>
          <li>
            <span className="font-medium">Your friend signs up:</span> For each friend that signs up using your link, you’ll receive <span className="font-semibold">2 credits</span>!
          </li>
          <li>
            The more friends you refer, the more credits you can earn.
          </li>
        </ul>

        <div className="mt-6">
          <label className="block text-gray-800 font-medium mb-2">Your referral link:</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={referralLink}
              className="flex-1 px-4 py-2 border rounded-md bg-gray-50 text-gray-800"
            />
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-[#2ecc71] hover:bg-green-600 text-white rounded-md text-sm font-medium"
            >
              Copy link
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6 text-center">
          <p className="text-sm text-gray-500 mb-1">Total referrals</p>
          <p className="text-3xl font-bold text-gray-800">0</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6 text-center">
          <p className="text-sm text-gray-500 mb-1">Total credits earned</p>
          <p className="text-3xl font-bold text-gray-800">0</p>
        </div>
      </div>
    </div>
    </>
  );
};

export default Referrals;
