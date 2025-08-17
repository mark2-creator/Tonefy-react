import React, { useState } from "react";
import BillingToggle from "./BillingToggle";
import PricingCards from "./PricingCards";
import CreditsTable from "./CreditsTable";
const UpgradeModal = ({ isOpen, onClose }) => {
  const [isYearly, setIsYearly] = useState(false); // 💡 Add state to control billing period

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg max-w-4xl w-full p-6 overflow-y-auto max-h-[90vh]">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-[#2ecc71]">Upgrade your plan</h2>
          <button onClick={onClose} className="text-[#2ecc71] hover:text-black text-xl">&times;</button>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-6">
          <BillingToggle isYearly={isYearly} setIsYearly={setIsYearly} />
        </div>

        {/* Pricing Cards */}
        <PricingCards isYearly={isYearly} />

       
          {/* Credits Table Section */}
<div className="mt-6">
  <CreditsTable />
</div>
 {/* Footer */}
    <div className="mt-8">
  <div className="max-w-sm mx-auto mt-8 bg-gray-50 border border-[#2ecc71] shadow-sm rounded-lg p-6 text-center text-gray-700 text-sm">
      <img
        src="/avatars/italio.jpg"
        alt="Nicolai Grut"
        className="mx-auto mb-4 w-16 h-16 rounded-full object-cover border border-gray-300"
      />
      <p className="mb-2 font-medium">Powered by Stripe. Safe and secure. Cancel anytime.</p>
      <p className="italic text-gray-600">
        “I love how clean and fast the interface is, using Tonefy is fast and snappy and the content is rendered incredibly quickly.”<br />
        — Nicolai Grut
      </p>
    </div>
</div>
</div>

        </div>
    
   
  );
};

export default UpgradeModal;
