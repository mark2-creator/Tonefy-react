 import React from "react";




const CreditsTable = () => {
  return (
 // Credits Table 
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
        );
}
 export default CreditsTable;