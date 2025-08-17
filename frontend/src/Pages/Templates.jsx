import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import Sidebar from "../components/Sidebar";
import { SidebarIcon } from "lucide-react";

const Templates = () => {
  return (
    <>
    <DashboardHeader/>
    <Sidebar/>
    
      <div className=" ml-36 mt-16 px-6 py-10 bg-gray-300 w-[1100px] rounded-md shadow-md min-h-screen">
        <div className="w-full md:w-3/4 lg:w-1/2">
          <div className="w-full md:w-[500px] lg:w-[700px] flex justify-between items-start bg-gray-200 rounded-lg shadow p-6 mt-0">
            {/* Left side: heading */}
            <div className="self-start">
              <h2 className="text-2xl font-bold text-[#27ae60]">Templates</h2>
            </div>

            {/* Right side: buttons */}
            <div className="flex space-x-4">
              <button className="bg-[#2ecc71] hover:bg-[#27ae60] text-[#27ae60] font-semibold py-2 px-4 rounded transition text-left">
                9:16 <br />
                <small className="text-xs font-normal">(Portrait)</small>
              </button>

              <button className="bg-[#2ecc71] hover:bg-[#27ae60] text-[#27ae60] font-semibold py-2 px-4 rounded transition text-left">
                1:1 <br />
                <small className="text-xs font-normal">(Square)</small>
              </button>

              <button className="bg-[#2ecc71] hover:bg-[#27ae60] text-[#27ae60] font-semibold py-2 px-4 rounded transition text-left">
                16:9 <br />
                <small className="text-xs font-normal">(Landscape)</small>
              </button>
            </div>
          </div>
        </div>
      </div>
      </>
  );
};

export default Templates;
