import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  User,
  BarChart,
  Gift,
  Users,
  DollarSign,
  LogOut,
} from "lucide-react";

const menuItems = [
  { icon: BarChart, label: "Usage", to: "/accounts/usage" },
  { icon: User, label: "Profile", to: "/accounts/profiles" },
  { icon: Gift, label: "Rewards", to: "/accounts/rewards" },
  { icon: Users, label: "Referrals", to: "/accounts/referrals" },
  { icon: DollarSign, label: "Affiliate", to: "/accounts/affiliate" },
  { icon: LogOut, label: "Logout", to: "/accounts/logout" },
];

const AccountsSidebar = () => {
  const location = useLocation();

  return (
    <nav className="w-44 fixed top-0 left-0 h-screen bg-white border-r border-gray-200 mt-28 py-6 z-40">
      <ul className="space-y-6 px-4">
        {menuItems.map(({ icon: Icon, label, to }) => {
          const isActive = location.pathname === to;
          return (
            <li key={label}>
              <Link
                to={to}
                className={`flex items-center space-x-3 text-gray-700 hover:text-[#2ecc71] ${
                  isActive ? "font-semibold text-[#2ecc71]" : "font-medium"
                }`}
              >
                <Icon
                  size={24}
                  className={isActive ? "text-[#2ecc71]" : "text-gray-500"}
                />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default AccountsSidebar;
