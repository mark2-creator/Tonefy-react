import React, { useState } from "react";

const TimeSaverCard = () => {
  const [hours, setHours] = useState(4);
  const savedHours = hours * 24;
  const savedMoney = hours * 1200;

  return (
    <section className="timesaver-section">
      <div className="timesaver-card">
        <h2 className="timesaver-title">
          Stop wasting time, effort and money creating videos
        </h2>

        <div className="timesaver-highlight">
          Save <strong>{savedHours}</strong> hours & <strong>${savedMoney.toLocaleString()}</strong> per month
        </div>

        <div className="slider-container">
          <label htmlFor="content-hours">
            <strong>Hours of content you create per month:</strong> {hours} hour{hours !== 1 ? "s" : ""}
          </label>
          <input
            id="content-hours"
            type="range"
            min="1"
            max="20"
            step="1"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </div>

        <button className="timesaver-btn">Start using Tonefy now</button>
        <p className="timesaver-note">
          No technical skills or software download required.
        </p>
      </div>
    </section>
  );
};

export default TimeSaverCard;
