import React from "react";

function AvatarSection() {
  return (
    <section className="py-16 px-6 max-w-6xl mx-auto flex flex-col-reverse lg:flex-row items-center gap-12">
      {/* Text Content */}
      <div className="w-full lg:w-1/2 text-center lg:text-left">
        <h2 className="text-3xl md:text-4xl font-bold mb-5">
          Add personality to your videos with engaging AI avatars
        </h2>
        <p className="text-lg text-gray-700 mb-6">
          With Tonefy’s AI avatars, you don’t need to be on camera or cast anyone
          to add a face and personality to your videos.
        </p>
        <button className="bg-[#2ecc71] hover:bg-green-600 text-white font-semibold px-6 py-3 rounded-lg transition">
          Start creating with 70+ avatars
        </button>
      </div>

      {/* Video Boxes */}
      <div className="w-full lg:w-1/2 grid grid-cols-2 gap-6">
        <div className="bg-gray-100 text-gray-600 font-semibold h-84 md:h-84 flex items-center justify-center rounded-lg shadow">
          Video 1
        </div>
        <div className="bg-gray-100 text-gray-600 font-semibold h-84 md:h-84 flex items-center justify-center rounded-lg shadow">
          Video 2
        </div>
        <div className="bg-gray-100 text-gray-600 font-semibold h-84 md:h-84 flex items-center justify-center rounded-lg shadow">
          Video 3
        </div>
        <div className="bg-gray-100 text-gray-600 font-semibold h-84 md:h-84 flex items-center justify-center rounded-lg shadow">
          Video 4
        </div>
      </div>
    </section>
  );
}

export default AvatarSection;
