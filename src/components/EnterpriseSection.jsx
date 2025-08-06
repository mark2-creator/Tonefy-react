import React from "react";

export default function EnterpriseSection() {
  return (
    <section className="w-full bg-white py-16 px-6 md:px-12 lg:px-24">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
          Tonefy for enterprise
        </h2>
        <p className="text-lg text-gray-600 font-medium mb-2">
          Create branded videos with security and privacy
        </p>
        <p className="text-base md:text-lg text-gray-700 mb-8">
          Tonefy is GDPR & CCPA compliant, working with 73% of Fortune 500 companies and
          empowering enterprises to use AI for high-quality video production safely and quickly.
        </p>
        <div className="w-full bg-gray-100 text-gray-500 h-40 flex items-center justify-center mb-8">
          <p>enterprise_image</p>
        </div>
        <button className="bg-[#2ecc71] hover:bg-[#27ae60] text-white font-semibold py-3 px-6 rounded-lg transition">
          Contact sales
        </button>
      </div>
    </section>
  );
}
