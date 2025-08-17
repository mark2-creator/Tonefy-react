import React, { useState, useEffect } from "react"; // added useEffect
import DashboardHeader from "../components/DashboardHeader";
import Sidebar from "../components/Sidebar";
import IdeaToVideoModal from "../components/IdeaToVideoModal";

import {
  Sparkles,
  FileText,
  Link2,
  Layout,
  Scissors,
  Mic,
  FilePlus,
  Music,
  Mic2,
  Volume2,
  MessageSquare,
  Image,
  Users,
  Presentation,
} from "lucide-react";

const iconColorMap = {
  "icon-purple": "text-purple-600",
  "icon-blue": "text-blue-600",
  "icon-teal": "text-teal-600",
  "icon-orange": "text-orange-500",
  "icon-red": "text-red-500",
  "icon-green": "text-green-600",
  "icon-gray": "text-gray-500",
  "icon-pink": "text-pink-500",
  "icon-yellow": "text-yellow-500",
  "icon-lightblue": "text-sky-400",
  "icon-cyan": "text-cyan-500",
};

const iconMap = {
  sparkles: <Sparkles size={36} />,
  fileText: <FileText size={36} />,
  link: <Link2 size={36} />,
  layout: <Layout size={36} />,
  scissors: <Scissors size={36} />,
  mic: <Mic size={36} />,
  filePlus: <FilePlus size={36} />,
  music: <Music size={36} />,
  podcast: <Mic2 size={36} />,
  voice: <Volume2 size={36} />,
  dialogue: <MessageSquare size={36} />,
  thumbnail: <Image size={36} />,
  social: <Users size={36} />,
  presentation: <Presentation size={36} />,
};

const dashboardSections = [
  {
    title: "Video",
    cards: [
      { title: "Idea (prompt)", desc: "Transform your ideas into stunning videos.", icon: "sparkles", color: "icon-purple" },
      { title: "Script", desc: "Transform your scripts into engaging videos.", icon: "fileText", color: "icon-blue" },
      { title: "URL", desc: "Convert articles, web pages, or listings into videos easily.", icon: "link", color: "icon-teal" },
      { title: "PPT", desc: "Transform your presentations into stunning videos.", icon: "layout", color: "icon-orange" },
      { title: "Edit", desc: "Add subtitles and B-rolls to your existing video recordings.", icon: "scissors", color: "icon-red" },
      { title: "Record", desc: "Turn recordings into polished videos with subtitles.", icon: "mic", color: "icon-green" },
      { title: "Empty", desc: "Start creating video from a blank file.", icon: "filePlus", color: "icon-gray" },
    ],
  },
  {
    title: "Audio",
    cards: [
      { title: "Idea (prompt)", desc: "Transform your ideas into stunning audio.", icon: "sparkles", color: "icon-purple" },
      { title: "Script", desc: "Transform your scripts into engaging audio.", icon: "fileText", color: "icon-blue" },
      { title: "Blog (URL)", desc: "Convert blog articles or web pages into engaging audio.", icon: "link", color: "icon-teal" },
      { title: "Empty", desc: "Start creating audio from a blank file.", icon: "filePlus", color: "icon-gray" },
      { title: "Music", desc: "Generate background music for your videos.", icon: "music", color: "icon-pink" },
      { title: "Podcast", desc: "Turn text or scripts into podcast episodes.", icon: "podcast", color: "icon-yellow" },
      { title: "Voiceover", desc: "Create voiceovers using AI voices.", icon: "voice", color: "icon-lightblue" },
      { title: "Dialogue", desc: "Generate character dialogues or interviews.", icon: "dialogue", color: "icon-cyan" },
    ],
  },
  {
    title: "Design",
    cards: [
      { title: "Thumbnail", desc: "Create stunning thumbnails for your videos.", icon: "thumbnail", color: "icon-purple" },
      { title: "Social", desc: "Create engaging social posts.", icon: "social", color: "icon-blue" },
      { title: "Presentation", desc: "Create engaging presentations.", icon: "presentation", color: "icon-orange" },
      { title: "Empty", desc: "Start from a blank file.", icon: "filePlus", color: "icon-gray" },
    ],
  },
];

const Dashboard = () => {
  // modal open state
  const [isIdeaModalOpen, setIdeaModalOpen] = useState(false);

  // Search videos example — calls your backend
  const searchVideos = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/search-pexels-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "nature" }),
      });

      if (!res.ok) throw new Error("Failed to fetch videos");

      const data = await res.json();
      console.log("Pexels videos:", data.videos);
    } catch (error) {
      console.error(error);
    }
  };

  // Run once on mount
  useEffect(() => {
    searchVideos();
  }, []);

  // open modal only for "Idea (prompt)" card
  const handleCardClick = (title) => {
    if (title === "Idea (prompt)") {
      setIdeaModalOpen(true);
    }
  };

  return (
    <>
      <DashboardHeader />
      <Sidebar />
      <div className="ml-36 mt-16 px-6 py-10 bg-gray-300 mx-auto rounded-md shadow-md min-h-screen">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900">Welcome!</h1>
          <p className="text-gray-700 mt-2">Choose a workflow or start with an empty file</p>
        </div>

        {dashboardSections.map((section, idx) => (
          <section key={idx} className="mb-12">
            <h2 className="text-2xl font-semibold mb-6 text-gray-800">{section.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {section.cards.map((card, cidx) => (
                <div
                  key={cidx}
                  onClick={() => handleCardClick(card.title)}
                  className="bg-white rounded-lg p-6 shadow hover:shadow-lg transition cursor-pointer flex flex-col items-center text-center"
                >
                  {React.cloneElement(iconMap[card.icon], {
                    className: `mb-4 ${iconColorMap[card.color]} mx-auto`,
                    size: 48,
                  })}
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{card.title}</h3>
                  <p className="text-gray-600 text-sm">{card.desc}</p>
                </div>
              ))}
            </div>
          </section>
        ))}

        

        <IdeaToVideoModal
          isOpen={isIdeaModalOpen}
          onClose={() => setIdeaModalOpen(false)}
        />
      </div>
    </>
  );
};

export default Dashboard;
