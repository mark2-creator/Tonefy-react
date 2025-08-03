// src/pages/accounts/Accounts.jsx
import React from "react";
import { Outlet } from "react-router-dom";
import DashboardHeader from "../../components/DashboardHeader";
import AccountsSidebar from "../../components/AccountsSidebar";

import "./AccountsLayout.css";

const Accounts = () => {
  return (
    <div className="accounts-layout">
      <DashboardHeader />

      <div className="accounts-container">
        <AccountsSidebar />

        <div className="accounts-main">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Accounts;
