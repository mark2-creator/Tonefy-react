import React from "react";

const AffiliateCard = () => {
  return (
    <section className="w-full px-4 py-12 bg-gray-50 flex justify-center">
      <div className="bg-gray-200 shadow-md rounded-lg p-8 max-w-xl w-full text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-800 mb-4">
          Earn 50% commission as a Tonefy Affiliate Partner
        </h2>
        <p className="text-gray-700 mb-6">
          Just refer your friends, followers, and customers to earn 50% in recurring commissions for a lifetime!
        </p>
        <button className="bg-green-500 text-white font-semibold py-3 px-6 rounded-md hover:bg-green-600 transition duration-300">
          Start earning
        </button>
      </div>
    </section>
  );
};

export default AffiliateCard;
