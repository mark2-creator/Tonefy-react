import React, { useState } from "react";
import SideBar from "../components/Sidebar";

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
  
      <div className="flex h-screen bg-gray-50">
        <SideBar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-auto max-w-5xl mx-auto">
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-gray-800">Files</h1>
              <p className="text-gray-600 mt-1">
                Manage your files and create new content
              </p>
            </div>

            <section>
              <h2 className="text-xl font-semibold text-gray-700 mb-4">Files</h2>

              {showSearch && (
                <div className="mb-5">
                  <input
                    type="text"
                    placeholder="Search your files..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-[#2ecc71] focus:border-[#2ecc71] focus:outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {fileCards.map((card, index) => (
                  <div
                    key={index}
                    onClick={() =>
                      card.title === "Search" ? setShowSearch(!showSearch) : null
                    }
                    className={`bg-white rounded-xl shadow-md p-5 transition hover:shadow-lg ${
                      card.title === "Search" ? "cursor-pointer" : ""
                    }`}
                  >
                    {React.cloneElement(iconMap[card.icon], {
                      className: "text-[#2ecc71] mb-3",
                      size: 32,
                    })}
                    <h3 className="text-lg font-semibold text-gray-800">
                      {card.title}
                    </h3>
                    <p className="text-sm text-gray-600">{card.desc}</p>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>

  );
};

export default Files;
