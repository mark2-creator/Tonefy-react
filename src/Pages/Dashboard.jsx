// src/pages/Dashboard.jsx

import React from "react";
import "./Dashboard.css";
import DashboardHeader from "../components/DashboardHeader";
import SideBar from "../components/SideBar";
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

const iconMap = {
  sparkles: <Sparkles />,
  fileText: <FileText />,
  link: <Link2 />,
  layout: <Layout />,
  scissors: <Scissors />,
  mic: <Mic />,
  filePlus: <FilePlus />,
  music: <Music />,
  podcast: <Mic2 />,
  voice: <Volume2 />,
  dialogue: <MessageSquare />,
  thumbnail: <Image />,
  social: <Users />,
  presentation: <Presentation />,
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
  return (
    <div className="dashboard-wrapper">
      <SideBar />
      <div className="dashboard-main">
        <DashboardHeader />
        <main className="main-content">
          <div className="dashboard-welcome">
            <h1>Welcome!</h1>
            <p>Choose a workflow or start with an empty file</p>
          </div>

          {dashboardSections.map((section, index) => (
            <div key={index} className="dashboard-container">
              <div className="dashboard-section">
                <h2>{section.title}</h2>
                <div className="dashboard-cards">
                  {section.cards.map((card, idx) => (
                    <div key={idx} className="dashboard-card">
                      {React.cloneElement(iconMap[card.icon], { className: `icon ${card.color}` })}
                      <h3>{card.title}</h3>
                      <p>{card.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
