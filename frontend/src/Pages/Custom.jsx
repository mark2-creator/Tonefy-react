import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/Sidebar";
import { UserPlus } from "lucide-react";

function Custom() {
  return (
    <>
     <DashboardHeader />
      <SideBar />
    <div className=" ml-36 mt-16 px-6 py-10 bg-gray-300 w-[1100px] rounded-md shadow-md min-h-screen">
     
      <div className="flex-1 flex flex-col">
       
        <main className="flex-1 p-8 max-w-5xl mx-auto">
          {/* Breadcrumb */}
          <nav className="text-sm text-gray-500 mb-6 select-none" aria-label="Breadcrumb">
            <ol className="list-reset flex space-x-2">
              <li>
                <span className="cursor-pointer hover:text-green-600">Voices</span>
              </li>
              <li>
                <span className="mx-2">/</span>
              </li>
              <li className="text-[#2ecc71] font-semibold">Custom</li>
            </ol>
          </nav>

          {/* Heading */}
          <h1 className="flex items-center text-3xl font-bold text-[#2ecc71] mb-4 gap-3">
            <UserPlus size={28} className="text-[#2ecc71]" />
            <span>Create Custom Voice</span>
          </h1>

          {/* Description */}
          <p className="text-gray-700 mb-8 max-w-2xl">
            Define a unique voice by customizing pitch, speed, and tone. Great for brand personalization.
          </p>

          {/* Config Section */}
          <div className="flex flex-col items-start space-y-3">
            <button
              type="button"
              className="bg-[#2ecc71] hover:bg-green-600 text-white font-semibold px-6 py-3 rounded-lg transition"
            >
              Start Customization
            </button>
            <p className="text-sm text-gray-500 italic">More settings coming soon!</p>
          </div>
        </main>
      </div>
    </div>
    </>
  );
}

export default Custom;
