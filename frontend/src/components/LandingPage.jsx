import React, { useState, useEffect, useRef } from "react";

import Header from "./Header";
import LovedBySection from "./LovedBySection";
import MakeVideosSection from "./MakeVideosSection";
import CloneYourselfSection from "./CloneYourselfSection";
import LanguagesSection from "./LanguagesSection";
import EnterpriseSection from "./EnterpriseSection";
import FaqSection from "./FaqSection";
import TimeSaverCard from "./TimeSaverCard";
import FooterSection from "./FooterSection";
import AffiliateCard from "./AffiliateCard";
import AvatarSection from "./AvatarSection";

function LandingPage({ openModal }) {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef(null);

  const words = ["text", "blog", "product", "idea", "PPT"];
  const companyLogos = [
    "amazon", "apple", "camcast", "facebook", "google",
    "ibm", "instagram", "linkedin", "microsoft", "netflix",
    "shopify", "tata svg", "tiktok", "twitter", "youtube"
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % words.length);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;

    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div className="app overflow-x-hidden">
      <Header openModal={openModal} />

      <main>
        <div className="px-4 sm:px-6 md:px-12 lg:px-16 max-w-screen-xl mx-auto">
          {/* HERO SECTION */}
          <section className="text-center py-12">
            <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6">
              Turn <span className="text-[#2ecc71]">{words[index]}</span> into videos with AI voices
            </h1>
            <p className="text-base sm:text-lg md:text-xl max-w-2xl mx-auto text-gray-700 mb-8">
              Transform your ideas into stunning videos with our AI video generator. Easy to use Text to Video editor featuring lifelike voiceovers, dynamic AI video clips, and a wide range of AI-powered features.
            </p>

            <div className="flex flex-col items-center gap-3 mb-10">
              <button
                onClick={openModal}
                className="bg-[#2ecc71] hover:bg-[#27ae60] text-white font-semibold px-6 py-3 rounded-lg transition-colors"
              >
                Start for free
              </button>
              <p className="text-sm text-gray-600">credit card not required</p>
            </div>

            {/* Video with play button overlay */}
            <div className="relative w-full max-w-4xl mx-auto aspect-video max-h-[450px] rounded-lg shadow-md overflow-hidden">
  <video
    ref={videoRef}
    className="w-full h-full object-cover rounded-lg"
    muted
    loop
    autoPlay
    playsInline
    controls={isPlaying} // controls shown only when playing
    onClick={togglePlay} // toggle play on video click
    src="/avatars/Tonefy1.mp4"
  >
    Your browser does not support the video tag.
  </video>

  {/* Optional: remove this if autoplay means no button needed */}
  {!isPlaying && (
    <button
      onClick={togglePlay}
      aria-label="Play video"
      className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40 text-white text-6xl cursor-pointer rounded-lg"
    >
      ►
    </button>
  )}
</div>


          </section>

          {/* LOGO MARQUEE */}
          <section className="py-12 bg-white">
            <div className="bg-white rounded-2xl shadow-md p-8 max-w-7xl mx-auto text-center">
              <h2 className="text-2xl font-semibold mb-6">
                Trusted by over <span className="text-[#2ecc71] font-bold">50,000</span> companies of all sizes
              </h2>

              <div className="overflow-hidden">
                <div
                  className="flex gap-12 whitespace-nowrap animate-marquee"
                  style={{ animationDuration: "40s" }}
                >
                  {[...companyLogos, ...companyLogos].map((company, index) => (
                    <img
                      key={index}
                      src={`/logos/${company}.png`}
                      alt={company}
                      className="h-10 object-contain inline-block"
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* USE CASE BUTTONS */}
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            {[
              "Training and L&D",
              "HR & Internal Communications",
              "Content Creation",
              "Education",
              "Marketing",
            ].map((text, i) => (
              <button
                key={i}
                className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-full text-sm font-medium"
              >
                {text}
              </button>
            ))}
          </div>

          {/* VIDEO SAMPLE CARDS */}
           
<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
  {/* First video card */}
  <div className="bg-gray-100 rounded-lg p-6 text-center w-full h-80">
    <video
      className="w-full h-full object-cover rounded-lg"
       muted
    loop
    autoPlay
    playsInline
    controls={isPlaying} // controls shown only when playing
    onClick={togglePlay} // toggle play on video click
      src="/avatars/Tonefy2.mp4"
      type="video/mp4"
    >
      Your browser does not support the video tag.
    </video>
  </div>

  {/* Second video placeholder */}
  <div className="bg-gray-100 rounded-lg p-6 text-center w-full h-80 flex items-center justify-center">
    <span>
      training-video-sample-2 <br /> Play Video
    </span>
  </div>
</div>



          <button className="bg-[#2ecc71] hover:bg-[#27ae60] text-white px-6 py-3 rounded-lg font-semibold mb-16">
            Explore these use cases
          </button>

          {/* 4 STEPS SECTION */}
          <section className="py-16 text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-10">
              Discover effortless content creation in 4 simple steps
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
              {[
                "Start with your text, ideas, ppt, blogs or product urls",
                "Choose and personalise your AI voice",
                "Select media or let AI create",
                "Preview instantly and perfect your creation",
              ].map((title, i) => (
                <div key={i} className="p-4 border rounded-lg">
                  <div className="bg-gray-200 h-32 mb-4 flex items-center justify-center rounded">
                    Image {i + 1}
                  </div>
                  <h3 className="font-medium">{i + 1}. {title}</h3>
                </div>
              ))}
            </div>

            <button className="bg-[#2ecc71] hover:bg-[#27ae60] text-white px-6 py-3 rounded-lg font-semibold">
              Start creating
            </button>
          </section>
        </div>
      </main>

      {/* Additional Sections */}
      <MakeVideosSection />
      <LovedBySection />
      <EnterpriseSection />
      <AvatarSection />
      <CloneYourselfSection />
      <LanguagesSection />
      <TimeSaverCard />
      <AffiliateCard />
      <FaqSection />
      <FooterSection />
    </div>
  );
}

export default LandingPage;
