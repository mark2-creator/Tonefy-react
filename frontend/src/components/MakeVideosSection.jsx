import React from "react";

export default function MakeVideosSection() { 
  return (
    <section className="py-16 px-4 max-w-7xl mx-auto">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="text-4xl font-bold mb-12">
          Make videos in minutes with AI
        </h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8 mb-16">
          <div className="flex items-start space-x-4">
            <i className="fas fa-lightbulb text-4xl text-green-500 mt-1"></i>
            <div>
              <h3 className="text-xl font-semibold mb-1">Idea to video</h3>
              <p className="text-gray-600">
                Transform your ideas into stunning videos with AI voices
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <i className="fas fa-blog text-4xl text-blue-500 mt-1"></i>
            <div>
              <h3 className="text-xl font-semibold mb-1">Blog to video</h3>
              <p className="text-gray-600">
                Convert blog articles into engaging video content
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <i className="fas fa-file-powerpoint text-4xl text-red-500 mt-1"></i>
            <div>
              <h3 className="text-xl font-semibold mb-1">PPT to video</h3>
              <p className="text-gray-600">
                Transform your PowerPoint presentations into videos
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <i className="fas fa-user-circle text-4xl text-purple-500 mt-1"></i>
            <div>
              <h3 className="text-xl font-semibold mb-1">Avatar video</h3>
              <p className="text-gray-600">
                Create stunning avatar videos in just one click
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <i className="fas fa-box text-4xl text-yellow-500 mt-1"></i>
            <div>
              <h3 className="text-xl font-semibold mb-1">Product to video</h3>
              <p className="text-gray-600">
                Turn Amazon & Airbnb product listings into videos
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-4">
            <i className="fas fa-magic text-4xl text-pink-500 mt-1"></i>
            <div>
              <h3 className="text-xl font-semibold mb-1">Magic edit</h3>
              <p className="text-gray-600">
                Polish raw footage with auto-subtitles and b-rolls
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-4 col-span-full md:col-span-1">
            <i className="fas fa-video text-4xl text-indigo-500 mt-1"></i>
            <div>
              <h3 className="text-xl font-semibold mb-1">Magic record</h3>
              <p className="text-gray-600">
                Record video updates with captions for team/client
              </p>
            </div>
          </div>
        </div>

        <div className="mb-16">
          <div className="w-full h-48 border-4 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 text-lg">
            Video Placeholder
          </div>
        </div>

        <button className="bg-[#2ecc71] hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition">
          Create videos with AI
        </button>
      </div>
    </section>
  );
}
