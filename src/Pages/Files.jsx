// src/pages/Files.jsx
import React, { useState } from "react";
import "./Files.css";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/SideBar";
import {
  FileText,
  Search,
  Trash2,
  Layers,
  FolderPlus,
  FilePlus,
} from "lucide-react";

const iconMap = {
  fileText: <FileText />,
  search: <Search />,
  trash: <Trash2 />,
  layers: <Layers />,
  folderPlus: <FolderPlus />,
  filePlus: <FilePlus />,
};

const fileCards = [
  { title: "Files", icon: "fileText", desc: "All your created files." },
  { title: "Search", icon: "search", desc: "Find files quickly." },
  { title: "Trash", icon: "trash", desc: "Deleted files go here." },
  { title: "Bulk Create", icon: "layers", desc: "Create many at once." },
  { title: "New Folder", icon: "folderPlus", desc: "Organize your files." },
  { title: "New File", icon: "filePlus", desc: "Start a fresh file." },
];

const Files = () => {
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");

  return (
    <div className="dashboard-wrapper">
      <SideBar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="main-content">
          <div className="dashboard-welcome">
            <h1>Files</h1>
            <p>Manage your files and create new content</p>
          </div>

          <div className="dashboard-container">
            <div className="dashboard-section">
              <h2>Files</h2>

              {showSearch && (
                <div style={{ marginBottom: "20px" }}>
                  <input
                    type="text"
                    placeholder="Search your files..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px",
                      fontSize: "16px",
                      borderRadius: "8px",
                      border: "1px solid #ccc",
                    }}
                  />
                </div>
              )}

              <div className="dashboard-cards">
                {fileCards.map((card, index) => (
                  <div
                    key={index}
                    className="dashboard-card"
                    onClick={() =>
                      card.title === "Search" ? setShowSearch(!showSearch) : null
                    }
                    style={{ cursor: card.title === "Search" ? "pointer" : "default" }}
                  >
                    {React.cloneElement(iconMap[card.icon], {
                      className: "icon icon-blue",
                      size: 32,
                    })}
                    <h3>{card.title}</h3>
                    <p>{card.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Files;
