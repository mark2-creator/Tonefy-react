import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/Sidebar";

function Team() {
  return (
    <>
     <DashboardHeader />
  <SideBar />
  
    <div className=" ml-36 mt-16 px-6 py-10 bg-gray-300 w-[1100px] rounded-md shadow-md min-h-screen">
    

      <div className="flex-1 flex flex-col overflow-hidden">
       

        <main className="flex-1 p-8 overflow-auto bg-gray-50">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-3xl font-bold text-[#2ecc71] mb-4">
              Create content, together!
            </h1>

            <p className="text-gray-600 text-lg mb-4">
              Bring your team together and effortlessly create high-quality videos, audio and design content at scale, perfect for teams of any size and in any industry.
            </p>

            <p className="text-gray-600 mb-6">
              Create a team to add members and manage their billing from one account.
              Additional seats follow the same pricing and payment cycle as the team owner's account. More details here.
            </p>

            <button className="bg-[#2ecc71] hover:bg-[#27ae60] text-[#2ecc71] font-semibold py-2 px-6 rounded shadow transition">
              Create team
            </button>
          </div>
        </main>
      </div>
    </div>
    </>
  );
}

export default Team;
