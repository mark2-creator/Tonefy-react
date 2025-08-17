import React from "react";

const BillingToggle = ({ isYearly, setIsYearly }) => {
  return (
    <div className="relative w-80 h-14 bg-[#2ecc71] rounded-full flex items-center justify-center px-1 gap-x-3">
     

     <button
  onClick={() => setIsYearly(false)}
  className={`relative z-10 w-[122px] h-10 flex items-center justify-center text-sm font-semibold rounded-full transition-colors duration-300
    ${!isYearly ? "bg-white text-[#2ecc71]" : "bg-transparent text-gray-700 hover:bg-[#2ecc71] hover:text-blue-700"}`}
  style={{ outline: "none", boxShadow: "none" }} // Optional: removes focus ring if needed
>
  Monthly
</button>


   {/* Yearly Button */}
<button
  onClick={() => setIsYearly(true)}
  className={`relative z-10 w-[140 px] h-10 flex items-center justify-center gap-1 text-sm font-semibold rounded-full transition-colors duration-300
    ${
      isYearly
        ? "bg-white text-[#2ecc71]"
        : "bg-transparent text-gray-700 hover:bg-[#2ecc71] hover:text-blue-700"
    }`}
  style={{ outline: "none", boxShadow: "none" }}
>
  Yearly <span className="text-xs font-semibold">⚡ 25% off</span>
</button>
</div>
  );
};

export default BillingToggle;
