import React from "react";
import SideBar from "../components/Sidebar";
import { Palette } from "lucide-react";

function BrandKits() {
  return (
  
    <div className="flex min-h-screen bg-gray-50">
      <SideBar />
      <div className="flex-1 flex flex-col">
      
        <main className="flex-1 p-8 max-w-5xl mx-auto">
          {/* Breadcrumb */}
          <nav
           className="text-sm text-gray-500 mb-6 select-none"
            aria-label="Breadcrumb"
          >
            <ol className="list-reset flex space-x-2">
              <li className="text-gray-900 font-semibold">Brand Kits</li>
            </ol>
          </nav>

          {/* Heading */}
          <h1 className="flex items-center text-3xl font-bold text-gray-900 mb-4 gap-3">
            <Palette size={28} className="text-[#2ecc71]" />
            <span>Uniform and on-brand look for your videos!</span>
          </h1>

          {/* Description */}
          <p className="text-gray-700 mb-8 max-w-2xl">
            Define your brand&apos;s fonts, colors, watermark and other brand details which can be applied to your video automatically.
          </p>

          {/* Action Button */}
          <div>
            <button
              type="button"
              className="bg-[#2ecc71] hover:bg-green-600 text-white font-semibold px-6 py-3 rounded-lg transition"
            >
              Add New Brand
            </button>
          </div>
        </main>
      </div>
    </div>
  
  );
}

export default BrandKits;
