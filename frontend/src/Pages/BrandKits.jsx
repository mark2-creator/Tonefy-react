import React from "react";
import SideBar from "../components/Sidebar";
import { Palette } from "lucide-react";
import DashboardHeader from "../components/DashboardHeader";

function BrandKits() {
  return (
    <>
  <SideBar />
  <DashboardHeader/>
    <div className=" ml-36 mt-16 px-6 py-10 bg-gray-300 mx-auto  rounded-md shadow-md min-h-screen">
      
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
          <h1 className="flex items-center text-3xl font-bold text-[#2ecc71] mb-4 gap-3">
            <Palette size={28} className="text-[#2ecc71]" />
            <span>Uniform and on-brand look for your videos!</span>
          </h1>

          {/* Description */}
         <p className="text-gray-700 text-center mb-4">
 Define your brand's fonts, colors, watermark, logo, and other essential brand assets to maintain visual consistency across all your videos. These settings will be automatically applied to ensure every video aligns perfectly with your brand identity.
</p>


          {/* Action Button */}
          <div>
            <button
              type="button"
              className="bg-[#2ecc71] hover:bg-green-600 text-[#2ecc71] font-semibold px-6 py-3 rounded-lg transition"
            >
              Add New Brand
            </button>
          </div>
        </main>
      </div>
    </div>
    </>
  
  );
}

export default BrandKits;
