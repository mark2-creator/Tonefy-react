import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Home,
  FileText,
  Layers,
  Mic,
  Palette,
  Users,
  Zap,
  ChevronDown,
  ChevronUp,
  Wand2,
  UserPlus,
} from "lucide-react";

function SideBar() {
  const [voicesOpen, setVoicesOpen] = useState(false);

  return (
    <aside className="sidebar">
      <ul className="sidebar-nav">
        <li className="sidebar-item">
         <Link to="/dashboard" className="sidebar-link">
  <Home className="icon" size={28} color="#2ecc71" />
  <span>Home</span>
</Link>
        </li>

        <li className="sidebar-item">
          <Link to="/files" className="sidebar-link">
            <FileText className="icon" size={28} color="#3498db" />
            <span>Files</span>
          </Link>
        </li>

        <li className="sidebar-item">
          <Link to="/templates" className="sidebar-link">
            <Layers className="icon" size={28} color="#e67e22" />
            <span>Templates</span>
          </Link>
        </li>

        {/* Voices with Dropdown */}
        <li className="sidebar-item">
          <div className="sidebar-dropdown">
            <div
              className="sidebar-item dropdown-toggle voices-toggle"
              onClick={() => setVoicesOpen(!voicesOpen)}
            >
              <Mic className="icon" size={28} color="#1026e9" />
              <span>Voices</span>
              {voicesOpen ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </div>

            {voicesOpen && (
              <div className="dropdown-items">
                <Link to="/voices/clone" className="sidebar-subitem">
                  <Wand2 size={16} color="#2ecc71" />
                  Clone
                </Link>
                <Link to="/voices/custom" className="sidebar-subitem">
                  <UserPlus size={16} color="#2ecc71" />
                  Custom
                </Link>
              </div>
            )}
          </div>
        </li>

        <li className="sidebar-item">
          <Link to="/brand-kits" className="sidebar-link">
            <Palette className="icon" size={28} color="#1abc9c" />
            <span>Brand Kits</span>
          </Link>
        </li>

        <li className="sidebar-item">
          <Link to="/team" className="sidebar-link">
            <Users className="icon" size={28} color="#e74c3c" />
            <span>Team</span>
          </Link>
        </li>

        <li className="sidebar-item">
          <Link to="/automation" className="sidebar-link">
            <Zap className="icon" size={28} color="#f1c40f" />
            <span>Automation</span>
          </Link>
        </li>
      </ul>
    </aside>
  );
}

export default SideBar;
