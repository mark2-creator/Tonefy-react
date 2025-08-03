import React from "react";
import "./Affiliate.css";

const Affiliate = () => {
  return (
    <div className="affiliate-container">
      <h2>Welcome to our Affiliate Program! 🤝</h2>

      <p>
        Now, you have more reasons to love Tonefy AI. Just refer your friends,
        followers, and customers to earn <strong>50% recurring commissions</strong> for a lifetime!
      </p>

      <h3>Your rewards for referring new customers:</h3>
      <p>
        You get <strong>50% recurring commissions for lifetime</strong> for each
        referred customer.
      </p>

      <button className="join-button">Join the program</button>

      <h3>If you are already an affiliate, login to your affiliate dashboard.</h3>

      <p className="support-text">
        Feel free to reach out to us on{" "}
        <a href="mailto:support@Tonefy AI">support@Tonefy AI</a> if you have any query regarding affiliate program.
      </p>
    </div>
  );
};

export default Affiliate;
