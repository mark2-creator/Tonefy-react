// src/components/AccountsSidebar.jsx
import React from "react";
import { Link } from "react-router-dom";
import {
  User,
  BarChart,
  Gift,
  Users,
  DollarSign,
  LogOut,
} from "lucide-react";

const AccountsSidebar = () => {
  return (
    <div className="accounts-sidebar">
      <ul>
        <li>
          <BarChart size={30} />
          <Link to="/accounts/usage">Usage</Link>
        </li>
        <li>
          <User size={30} />
          <Link to="/accounts/profiles">Profile</Link>
        </li>
        <li>
          <Gift size={30} />
          <Link to="/accounts/rewards">Rewards</Link>
        </li>
        <li>
          <Users size={30} />
          <Link to="/accounts/referrals">Referrals</Link>
        </li>
        <li>
          <DollarSign size={30} />
          <Link to="/accounts/affiliate">Affiliate</Link>
        </li>
        <li>
          <LogOut size={30} />
        <Link to="/accounts/logout">Logout</Link>

        </li>
      </ul>
    </div>
  );
};

export default AccountsSidebar;
