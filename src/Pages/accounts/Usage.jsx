import React from "react";
import DashboardHeader from "../../components/DashboardHeader";
import AccountsSidebar from "../../components/AccountsSidebar";

const Usage = () => {
  return (
    <>
      <DashboardHeader />
      <AccountsSidebar />
      <div className="px-6 pt-20 ml-40 max-w-[calc(100%-160px)] overflow-x-hidden space-y-8">
        <h2 className="text-2xl font-bold">Usage</h2>

        {/* Credits Section */}
        <section className="bg-white shadow rounded-lg p-4 space-y-1">
          <h3 className="text-lg font-semibold">Credits</h3>
          <p>
            Usage: <span className="font-medium">0/5 minutes (0%)</span>
          </p>
          <p className="text-sm text-gray-500">
            (credits will reset on Aug 3, 2025)
          </p>
        </section>

        {/* Usage Graph */}
        <section className="bg-white shadow rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-2">Usage Graph</h3>
          <div className="border border-dashed border-gray-400 text-center py-8 text-gray-500">
            [Graph Placeholder]
          </div>
        </section>

        {/* Credits Info */}
        <section className="bg-white shadow rounded-lg p-4">
          <h3 className="text-lg font-semibold">How credits work</h3>
          <p>
            Plan: <strong>Free monthly</strong>
            <span className="text-gray-500"> (active since Jul 4, 2024)</span>
          </p>
        </section>

        {/* Promo Box */}
        <section className="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
          <p className="font-bold">⚡️ Summer special sale!</p>
          <p>
            Use code <span className="font-bold">FLIKISUMMER50</span> for 50% off all annual plans.
          </p>
        </section>

        {/* Plans Section */}
        <section className="bg-white shadow rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-4">Subscribe to Tonefy</h3>

          <div className="flex gap-3 mb-6">
            <button className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100">
              Monthly
            </button>
            <button className="px-4 py-2 border border-gray-300 rounded bg-green-500 text-white hover:bg-green-600">
              Yearly ⚡️ 50% off
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <h4 className="text-xl font-bold">Standard</h4>
              <p className="text-lg font-semibold">$28/month</p>
              <p className="text-gray-600">
                For creators venturing into AI video production.
              </p>
              <button className="mt-4 w-full bg-green-500 text-white py-2 rounded hover:bg-green-600">
                Subscribe now
              </button>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="text-xl font-bold">Premium</h4>
              <p className="text-lg font-semibold">$88/month</p>
              <p className="text-gray-600">
                For teams and experienced video creators.
              </p>
              <button className="mt-4 w-full bg-green-500 text-white py-2 rounded hover:bg-green-600">
                Subscribe now
              </button>
            </div>
          </div>
        </section>

        {/* Credits Table */}
        <section className="bg-white shadow rounded-lg p-4 overflow-x-auto">
          <h3 className="text-lg font-semibold mb-4">Credits Comparison</h3>
          <table className="w-full border-collapse border border-gray-300">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-gray-300 p-2 text-left">Feature</th>
                <th className="border border-gray-300 p-2 text-left">Standard</th>
                <th className="border border-gray-300 p-2 text-left">Premium</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Minutes", "180", "600"],
                ["Export length", "15 min", "40 min"],
                ["Standard voices", "1000", "2000+"],
                ["Ultra-Realistic voices", "150", "1000+"],
                ["Studio-Quality voices", "50", "350+"],
                ["AI Video clips", "﹣", "✔"],
                ["Brand kits", "1", "3"],
                ["Scene limits", "100", "150"],
                ["AI Avatar", "Limited", "✔"],
                ["Voice cloning", "1", "3"],
                ["Custom voices", "1", "3"],
                ["Templates", "✔", "✔"],
                ["Web research", "✔", "✔"],
                ["Custom fonts", "﹣", "✔"],
                ["Faster exports", "﹣", "✔"],
                ["Team collaboration", "﹣", "﹣"],
              ].map(([feature, standard, premium], idx) => (
                <tr key={idx}>
                  <td className="border border-gray-300 p-2">{feature}</td>
                  <td className="border border-gray-300 p-2">{standard}</td>
                  <td className="border border-gray-300 p-2">{premium}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
};

export default Usage;
