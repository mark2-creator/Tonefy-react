import React from "react";

function CloneYourselfSection() {
  return (
    <section className="flex flex-col lg:flex-row items-center justify-between gap-10 px-6 py-16 max-w-6xl mx-auto">
      {/* Text Content */}
      <div className="lg:w-1/2 space-y-6 text-center lg:text-left">
        <h2 className="text-3xl md:text-4xl font-bold">
          Comfortable on camera but short on time?
        </h2>
        <p className="text-gray-700 text-lg">
          Easily clone yourself, your voice, and your personality to create
          videos that feel authentic with Tonefy's professional AI avatar and
          voice cloning features.
        </p>
        <button className="bg-[#2ecc71] hover:bg-green-600 text-white px-6 py-3 rounded-lg transition">
          Clone yourself now
        </button>
      </div>

      {/* Media Section */}
      <div className="lg:w-1/2 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-100 border rounded-lg h-84 flex items-center justify-center text-gray-500 font-semibold">
          Image Placeholder
        </div>
        <div className="bg-gray-100 border rounded-lg h-84 flex items-center justify-center text-gray-500 font-semibold">
          Video Placeholder
        </div>
      </div>
    </section>
  );
}

export default CloneYourselfSection;
