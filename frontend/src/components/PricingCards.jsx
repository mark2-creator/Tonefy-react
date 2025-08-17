import React from "react";

const PricingCards = ({ isYearly }) => {
  return (
    <div className="flex flex-col md:flex-row gap-6 justify-center items-start">
      {/* Standard Plan */}
      <div className="border rounded-lg p-6 shadow-md w-full md:w-1/2">
        <h3 className="text-xl font-bold mb-2 text-[#2ecc71]">Standard</h3>
        <p className="text-black mb-4">
          For creators venturing into AI video production.
        </p>
        <div className="text-3xl font-bold mb-2">
          ${isYearly ? "21" : "28"}{" "}
          {!isYearly ? (
            <span className="text-base font-normal text-black">per month</span>
          ) : (
            <>
              <span className="text-sm text-black line-through ml-2">$28</span>
              <div className="text-sm text-black">per month</div>
              <div className="text-xs text-black mt-1">
                Your card will be charged <strong>$252 per year</strong>.
              </div>
            </>
          )}
        </div>
        <button className="mt-4 bg-[#2ecc71] text-blue-800 px-4 py-2 rounded">
          Subscribe now
        </button>
      </div>

      {/* Premium Plan */}
      <div className="border rounded-lg p-6 shadow-md w-full md:w-1/2">
        <h3 className="text-xl font-bold mb-2 text-[#2ecc71]">Premium</h3>
        <p className="text-black mb-4">
          For emerging & experienced video creators, perfect for teams of any size.
        </p>
        <div className="text-3xl font-bold mb-2">
          ${isYearly ? "66" : "88"}{" "}
          {!isYearly ? (
            <span className="text-base font-normal text-black">per month</span>
          ) : (
            <>
              <span className="text-sm text-black line-through ml-2">$88</span>
              <div className="text-sm text-black">per month</div>
              <div className="text-xs text-black mt-1">
                Your card will be charged <strong>$792 per year</strong>.
              </div>
            </>
          )}
        </div>
        <button className="mt-4 bg-[#2ecc71] text-blue-800 px-4 py-2 rounded">
          Subscribe now
        </button>
      </div>
    </div>
  );
};

export default PricingCards;
