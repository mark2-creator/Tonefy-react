import React from "react";
import "./Usage.css"; // optional styling

const Usage = () => {
  return (
    <div className="usage-page">
      <h2>Usage</h2>

      <section>
        <h3>Credits</h3>
        <p>Usage: 0/5 minutes (0%)</p>
        <p><small>(credits will reset on Aug 3, 2025)</small></p>
      </section>

      <section>
        <h3>Usage Graph</h3>
        <div className="usage-graph">[Graph Placeholder]</div>
      </section>

      <section>
        <h3>How credits work</h3>
        <p>Plan: <strong>Free monthly</strong> (active since Jul 4, 2024)</p>
      </section>

      <section className="promo-box">
        <p>⚡️ <strong>Summer special sale!</strong></p>
        <p>Use code <strong>FLIKISUMMER50</strong> for 50% off all annual plans.</p>
      </section>

      <section className="plans">
        <h3>Subscribe to Tonefy</h3>
        <div className="billing-options">
          <button>Monthly</button>
          <button>Yearly ⚡️ 50% off</button>
        </div>

        <div className="plan">
          <h4>Standard</h4>
          <p>$28/month</p>
          <p>For creators venturing into AI video production.</p>
          <button>Subscribe now</button>
        </div>

        <div className="plan">
          <h4>Premium</h4>
          <p>$88/month</p>
          <p>For teams and experienced video creators.</p>
          <button>Subscribe now</button>
        </div>
      </section>

      <section className="credits-table">
        <h3>Credits Comparison</h3>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Standard</th>
              <th>Premium</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Minutes</td><td>180</td><td>600</td></tr>
            <tr><td>Export length</td><td>15 min</td><td>40 min</td></tr>
            <tr><td>Standard voices</td><td>1000</td><td>2000+</td></tr>
            <tr><td>Ultra-Realistic voices</td><td>150</td><td>1000+</td></tr>
            <tr><td>Studio-Quality voices</td><td>50</td><td>350+</td></tr>
            <tr><td>AI Video clips</td><td>﹣</td><td>✔</td></tr>
            <tr><td>Brand kits</td><td>1</td><td>3</td></tr>
            <tr><td>Scene limits</td><td>100</td><td>150</td></tr>
            <tr><td>AI Avatar</td><td>Limited</td><td>✔</td></tr>
            <tr><td>Voice cloning</td><td>1</td><td>3</td></tr>
            <tr><td>Custom voices</td><td>1</td><td>3</td></tr>
            <tr><td>Templates</td><td>✔</td><td>✔</td></tr>
            <tr><td>Web research</td><td>✔</td><td>✔</td></tr>
            <tr><td>Custom fonts</td><td>﹣</td><td>✔</td></tr>
            <tr><td>Faster exports</td><td>﹣</td><td>✔</td></tr>
            <tr><td>Team collaboration</td><td>﹣</td><td>﹣</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  );
};

export default Usage;
 