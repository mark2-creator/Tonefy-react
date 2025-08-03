import React, { useState } from "react";
import "./Rewards.css";

const Referrals = () => {
  const referralLink = "https://fliki.ai?referral=ahumuza-mark-6eramj";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="referrals-container">
      <h2>Referral program ❤️</h2>
      <p>Invite your friends to Fliki and earn up to 120 credits 🤯😍!</p>

      <section>
        <h3>How it works</h3>
        <ol>
          <li>
            <strong>Share your referral link:</strong> Copy your unique referral link below and share it with your friends.
          </li>
          <li>
            <strong>Your friend signs up:</strong> For each friend that signs up using your link, you'll receive 2 credits! The more friends you refer, the more credits you can earn.
          </li>
        </ol>
      </section>

      <section>
        <h3>Your referral link:</h3>
        <div className="referral-link-box">
          <input type="text" value={referralLink} readOnly />
          <button onClick={handleCopy}>{copied ? "Copied!" : "Copy link"}</button>
        </div>
      </section>

      <section className="stats">
        <div>
          <h4>Total referrals</h4>
          <p>0</p>
        </div>
        <div>
          <h4>Total credits earned</h4>
          <p>0</p>
        </div>
      </section>
    </div>
  );
};

export default Referrals;
