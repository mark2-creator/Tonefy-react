import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/Sidebar";
import { Wand2 } from "lucide-react";

function Clone() {
  return (
    <>
        <DashboardHeader />
 <SideBar />
  
    <div className=" ml-36 mt-16 px-6 py-10 bg-gray-300 mx-auto  rounded-md shadow-md min-h-screen">
     
      <div className="flex-1 flex flex-col">
        <main className="flex-1 p-8 max-w-5xl mx-auto">
          {/* Breadcrumb */}
          <nav
            className="text-sm text-gray-500 mb-6 select-none"
            aria-label="Breadcrumb"
          >
            <ol className="list-reset flex space-x-2">
              <li>
                <span className="cursor-pointer hover:text-green-600">Voices</span>
              </li>
              <li>
                <span className="mx-2">/</span>
              </li>
              <li className="text-gray-900 font-semibold">Clone</li>
            </ol>
          </nav>

          {/* Heading */}
          <h1 className="flex items-center text-3xl font-bold text-[#2ecc71] mb-4 gap-3">
            <Wand2 size={28} className="text-[#2ecc71]" />
            <span>Create a clone of your voice that sounds just like you</span>
          </h1>

          {/* Description */}
          <p className="text-gray-700 mb-8 max-w-2xl">
            Record two minutes of your voice, then generate any number of
            voice-overs in your own voice using just text.
          </p>

          {/* Upload Section */}
          <div className="flex flex-col items-start space-y-3">
            <button
              type="button"
              className="bg-[#2ecc71] hover:bg-green-600 text-white font-semibold px-6 py-3 rounded-lg transition"
            >
              Upload Voice Sample
            </button>
            <p className="text-sm text-gray-500 italic">
              Supported formats: MP3, WAV &bull; Max size: 5MB
            </p>
          </div>
        </main>
      </div>
    </div>
    </>
  );
}

export default Clone;
