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

function Sidebar() {
  const [voicesOpen, setVoicesOpen] = useState(false);

  return (
    <aside className="fixed top-30 left-0 h-[calc(100vh-64px)] w-64 bg-white border-r border-gray-200 shadow-sm p-6 z-50">
      <ul className="space-y-4 text-gray-800">
        <li>
          <Link to="/dashboard" className="flex items-center gap-3 hover:text-green-500">
            <Home size={24} color="#2ecc71" />
            <span>Home</span>
          </Link>
        </li>

        <li>
          <Link to="/files" className="flex items-center gap-3 hover:text-green-500">
            <FileText size={24} color="#3498db" />
            <span>Files</span>
          </Link>
        </li>

        <li>
          <Link to="/templates" className="flex items-center gap-3 hover:text-green-500">
            <Layers size={24} color="#e67e22" />
            <span>Templates</span>
          </Link>
        </li>

        {/* Voices Dropdown */}
        <li>
          <button
            className="flex items-center gap-3 w-full text-left hover:text-green-500"
            onClick={() => setVoicesOpen(!voicesOpen)}
          >
            <Mic size={24} color="#1026e9" />
            <span>Voices</span>
            <span className="ml-auto">
              {voicesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>

          {voicesOpen && (
            <div className="ml-7 mt-2 space-y-2">
              <Link to="/voices/clone" className="flex items-center gap-2 text-sm hover:text-green-500">
                <Wand2 size={16} color="#2ecc71" />
                Clone
              </Link>
              <Link to="/voices/custom" className="flex items-center gap-2 text-sm hover:text-green-500">
                <UserPlus size={16} color="#2ecc71" />
                Custom
              </Link>
            </div>
          )}
        </li>

        <li>
          <Link to="/brand-kits" className="flex items-center gap-3 hover:text-green-500">
            <Palette size={24} color="#1abc9c" />
            <span>Brand Kits</span>
          </Link>
        </li>

        <li>
          <Link to="/team" className="flex items-center gap-3 hover:text-green-500">
            <Users size={24} color="#e74c3c" />
            <span>Team</span>
          </Link>
        </li>

        <li>
          <Link to="/automation" className="flex items-center gap-3 hover:text-green-500">
            <Zap size={24} color="#f1c40f" />
            <span>Automation</span>
          </Link>
        </li>
      </ul>
    </aside>
  );
}

export default Sidebar;
