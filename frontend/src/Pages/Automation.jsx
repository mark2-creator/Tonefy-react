import React from "react";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/Sidebar";

function Automation() {
  return (
    <>
   <DashboardHeader />
     <SideBar />
    <div className=" ml-36 mt-16 px-6 py-10 bg-gray-300 mx-auto  rounded-md shadow-md min-h-screen">
    
      <div className="flex-1 flex flex-col">
       
        <main className="flex-1 p-8 max-w-5xl mx-auto">
          <div className="automation-container space-y-6">
            <h1 className="text-3xl font-bold text-[#2ecc71]">Create content at scale!</h1>
            <p className="text-gray-700 text-center mb-4 ">
              Use Zapier, Make, or the API to automatically generate content in Fliki - no manual work needed. To get started, create an automation key for the platform you want to connect.
            </p>
            <button
              type="button"
              className="bg-[#2ecc71] hover:bg-green-600 text-[#2ecc71] font-semibold px-6 py-3 rounded-lg transition"
            >
              Create key
            </button>

            <section className="resource-guides space-y-4">
              <h2 className="text-2xl font-semibold text-gray-900">Resource Guides</h2>
              <p className="text-gray-600">Learn how to set up automation with popular platforms</p>

              <div className="guide-cards grid gap-6 md:grid-cols-2">
                <a
                  href="https://zapier.com/apps/google-sheets/integrations/youtube"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="guide-card block p-6 bg-white rounded-lg shadow hover:shadow-lg transition"
                >
                  <h3 className="text-lg font-semibold mb-2">Zapier Integration</h3>
                  <p className="text-gray-700">
                    Turn Google Sheets rows into videos and auto-publish to YouTube.
                  </p>
                </a>

                <a
                  href="https://www.make.com/en/integrations/blog/youtube"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="guide-card block p-6 bg-white rounded-lg shadow hover:shadow-lg transition"
                >
                  <h3 className="text-lg font-semibold mb-2">Make Integration</h3>
                  <p className="text-gray-700">
                    Convert blog posts into videos and auto-upload to YouTube.
                  </p>
                </a>
              </div>

              <p className="support-note text-gray-600">
                Need help? Reach out to us at{" "}
                <a href="mailto:ahumuzamark21213@gmail.com" className="text-[#2ecc71] underline">
                  ahumuzamark21213@gmail.com
                </a>
              </p>
            </section>
          </div>
        </main>
      </div>
    </div>
  </>
  );
}

export default Automation;
