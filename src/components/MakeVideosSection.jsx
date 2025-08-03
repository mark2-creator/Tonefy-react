import React from "react";
import "@fortawesome/fontawesome-free/css/all.min.css";

export default function MakeVideosSection() {
  return (
    <section className="makevideos-section">
      <div className="content">
        <h1 className="makevideos-heading">Make videos in minutes with AI</h1>

       <div className="feature-cards">
  <div className="feature-card">
    <i className="fas fa-lightbulb icon idea"></i>
    <div>
      <h3>Idea to video</h3>
      <p>Transform your ideas into stunning videos with AI voices</p>
    </div>
  </div>
  <div className="feature-card">
    <i className="fas fa-blog icon blog"></i>
    <div>
      <h3>Blog to video</h3>
      <p>Convert blog articles into engaging video content</p>
    </div>
  </div>
  <div className="feature-card">
    <i className="fas fa-file-powerpoint icon ppt"></i>
    <div>
      <h3>PPT to video</h3>
      <p>Transform your PowerPoint presentations into videos</p>
    </div>
  </div>
  <div className="feature-card">
    <i className="fas fa-user-circle icon avatar"></i>
    <div>
      <h3>Avatar video</h3>
      <p>Create stunning avatar videos in just one click</p>
    </div>
  </div>
  <div className="feature-card">
    <i className="fas fa-box icon product"></i>
    <div>
      <h3>Product to video</h3>
      <p>Turn Amazon & Airbnb product listings into videos</p>
    </div>
  </div>
  <div className="feature-card">
    <i className="fas fa-magic icon edit"></i>
    <div>
      <h3>Magic edit</h3>
      <p>Polish raw footage with auto-subtitles and b-rolls</p>
    </div>
  </div>
  <div className="feature-card">
    <i className="fas fa-video icon record"></i>
    <div>
      <h3>Magic record</h3>
      <p>Record video updates with captions for team/client</p>
    </div>
  </div>
</div> 
  <div className="MakeVideosSection-video-placeholder">
  <div className="MakeVideosSection-video-box">
    <p>Video Placeholder</p>
  </div>
</div>

        <button className="cta-btn">Create videos with AI</button>
      </div>

    

      
    </section>
  );
}
