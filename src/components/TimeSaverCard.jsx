import React, { useState } from "react";

const TimeSaverCard = () => {
  const [hours, setHours] = useState(4);
  const savedHours = hours * 24;
  const savedMoney = hours * 1200;

  return (
    <section className="w-full px-4 py-12 bg-gray-50 flex justify-center">
      <div className="bg-pink-300 shadow-xl rounded-lg p-8 max-w-2xl w-full text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-800 mb-6">
          Stop wasting time, effort and money creating videos
        </h2>

        <div className="text-lg md:text-xl text-green-600 font-semibold mb-6">
          Save <strong>{savedHours}</strong> hours &{" "}
          <strong>${savedMoney.toLocaleString()}</strong> per month
        </div>

        <div className="mb-6 text-left">
          <label htmlFor="content-hours" className="block text-gray-700 font-medium mb-2">
            Hours of content you create per month:{" "}
            <span className="font-semibold">{hours} hour{hours !== 1 ? "s" : ""}</span>
          </label>
          <input
            id="content-hours"
            type="range"
            min="1"
            max="20"
            step="1"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
        </div>

        <button className="bg-green-500 text-white font-semibold py-3 px-6 rounded-md hover:bg-green-600 transition duration-300">
          Start using Tonefy now
        </button>

        <p className="text-sm text-gray-600 mt-4">
          No technical skills or software download required.
        </p>
      </div>
    </section>
  );
};

export default TimeSaverCard;
