import React, { useState, useEffect } from "react";

import Header from "./Header";
import LovedBySection from "./LovedBySection";
import MakeVideosSection from "./MakeVideosSection";
import CloneYourselfSection from "./CloneYourselfSection"
import LanguagesSection from "./LanguagesSection"
import EnterpriseSection from "./EnterpriseSection";
import FaqSection from "./FaqSection";
import TimeSaverCard from "./TimeSaverCard";
import FooterSection from "./FooterSection";
import AffiliateCard from "./AffiliateCard";
import AvatarSection from "./AvatarSection"; 
function LandingPage({ openModal }) {
  const [index, setIndex] = useState(0);
  const words = ["text", "blog", "product", "idea", "PPT"];

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % words.length);
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      <Header openModal={openModal} />
      <LovedBySection />
      <main className="hero">
       <h1 className="text-7xl font-bold text-center my-8">
  Turn <span className="text-[#2ecc71]">{words[index]}</span> into videos with AI voices
</h1>
<div className="text-4xl text-green-500 font-bold p-10">
      If you see this styled, Tailwind is working! ✅
    </div>

        <p className="subheadline">
          Transform your ideas into stunning videos with our AI video generator.
          Easy to use Text to Video editor featuring lifelike voiceovers,
          dynamic AI video clips, and a wide range of AI-powered features.
        </p>

        <div className="cta-buttons">
          <button className="start-button" onClick={openModal}>
            Start for free
          </button>
          <p className="no-card-needed">credit card not required</p>

 <div className="ppt-to-video-section-video-placeholder">
  <p>Video Preview Placeholder (16:9)</p>
</div>




<section className="bg-white py-12">
  <h2 className="text-center text-2xl md:text-3xl font-semibold text-gray-800 mb-8">
    Trusted by over <span className="text-[#2ecc71] font-bold">50,000 companies</span> of all sizes
  </h2>

  <div className="overflow-hidden">
    <div className="flex gap-12 animate-scroll w-max whitespace-nowrap">
      {[
        "amazon", "apple", "camcast", "facebook", "google", "ibm", "instagram",
        "linkedin", "microsoft", "netflix", "shopify", "tata svg", "tiktok",
        "twitter", "x", "youtube",
      ]
        .flatMap((logo) => [logo, logo]) // Repeat for seamless scroll
        .map((logo, index) => (
          <img
            key={index}
            src={`/logos/${logo}.png`}
            alt={logo}
            className="h-10 md:h-12 object-contain"
          />
        ))}
    </div>
  </div>
</section>



<section className="usecase-section">
 <div className="usecase-section">
  <h2 className="usecase-heading">
    Create professional and engaging videos for every use case
  </h2>

  <div className="usecase-buttons">
    <button>Training and L&D</button>
    <button>HR & Internal Communications</button>
    <button>Content Creation</button>
    <button>Education</button>
    <button>Marketing</button>
  </div>

  <div className="usecase-video-pair">
    <div className="usecase-video-block">
      <div className="usecase-video-placeholder">training-video-sample-1<br />Play Video</div>
    </div>
    <div className="usecase-video-block">
      <div className="usecase-video-placeholder">training-video-sample-2<br />Play Video</div>
    </div>
  </div>

  <div className="explore-button-container">
    <button className="explore-button">Explore these use cases</button>
  </div>
</div>

</section>

<section className="steps-section">
  <h2 className="steps-heading">Discover effortless content creation in 4 simple steps</h2>

  <div className="steps-grid">
    <div className="step">
      <div className="step-image">Image 1</div>
      <h3 className="step-title">1. Start with your text, ideas, ppt, blogs or product urls</h3>
    </div>

    <div className="step">
      <div className="step-image">Image 2</div>
      <h3 className="step-title">2. Choose and personalise your AI voice</h3>
    </div>

    <div className="step">
      <div className="step-image">Image 3</div>
      <h3 className="step-title">3. Select media or let AI create</h3>
    
    </div>

    <div className="step">
      <div className="step-image">Image 4</div>
      <h3 className="step-title">4. Preview instantly and perfect your creation</h3>
    </div>
  </div>

  <div className="start-button-container">
    <button className="start-creating-button">Start creating</button>
  </div>
</section>



        </div>
      </main>

      <MakeVideosSection />
      <EnterpriseSection />
       <AvatarSection />
      
      <CloneYourselfSection/>
      <LanguagesSection/>
      <TimeSaverCard />
      <AffiliateCard />
      <FaqSection />
      <FooterSection />
    </div>
  );
}

export default LandingPage;
