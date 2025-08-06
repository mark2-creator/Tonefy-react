import React from "react";
import DashboardHeader from "../../components/DashboardHeader";
import AccountsSidebar from "../../components/AccountsSidebar";
const Affiliate = () => {
  return (
<>
<DashboardHeader/>
<AccountsSidebar/>
  <div className=" ml-40 mt-16 px-6 py-10 bg-white rounded-md shadow-md min-h-screen">  
      <h2 className="text-3xl font-bold text-gray-800 mb-4 px-6">
        Welcome to our Affiliate Program! 🤝
      </h2>

      <p className="text-gray-700 mb-6 px-6">
        Now, you have more reasons to love <span className="font-semibold text-black">Tonefy AI</span>.
        Just refer your friends, followers, and customers to earn{" "}
        <strong className="text-green-600">50% recurring commissions</strong> for a lifetime!
      </p>

      <h3 className="text-xl font-semibold text-gray-800 mb-2 px-6">
        Your rewards for referring new customers:
      </h3>

      <p className="text-gray-700 mb-6 px-6">
        You get <strong className="text-green-600">50% recurring commissions for lifetime</strong> for each
        referred customer.
      </p>

      <div className="px-6 mb-6">
        <button className="bg-[#2ecc71] text-white font-semibold py-2 px-6 rounded hover:bg-[#27ae60] transition">
          Join the program
        </button>
      </div>

      <h3 className="text-xl font-semibold text-gray-800 mb-2 px-6">
        If you are already an affiliate, login to your affiliate dashboard.
      </h3>

      <p className="text-gray-600 mt-2 px-6 pb-4">
        Feel free to reach out to us on{" "}
        <a href="mailto:support@tonefy.ai" className="text-[#2ecc71] font-medium hover:underline">
          support@tonefy.ai
        </a>{" "}
        if you have any query regarding affiliate program.
      </p>
    </div>
    </>
  );
};

export default Affiliate;
