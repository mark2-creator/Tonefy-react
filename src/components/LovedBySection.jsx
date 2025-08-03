import React from "react";
import { Users, Star, Zap } from "lucide-react";

export default function LovedBySection() {
  const stats = [
    {
      icon: <Users className="w-10 h-10 text-[#2ecc71]" />,
      stat: "8,750,000+",
      desc: "people creating videos for social media, training, courses and much more.",
    },
    {
      icon: <Star className="w-10 h-10 text-yellow-400" />,
      stat: "4.8/5",
      desc: "satisfaction from 5,500+ reviews from G2 and Capterra",
    },
    {
      icon: <Zap className="w-10 h-10 text-blue-500" />,
      stat: "5x",
      desc: "productivity improvement and create videos faster than traditional methods.",
    },
  ];

  return (
    <section className="bg-white py-16 px-4 md:px-12 max-w-7xl mx-auto">
  <h2 className="text-4xl font-bold text-center mb-6 text-gray-900">
    Loved by <span className="text-[#2ecc71]">content creators</span> around the world
  </h2>
  <p className="text-center text-gray-600 max-w-2xl mx-auto mb-12 text-lg">
    Our customers are using Tonefy to create engaging content, streamline communication, and boost productivity.
  </p>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
    {stats.map((item, index) => (
      <div
        key={index}
        className="bg-white border border-gray-100 rounded-2xl shadow-md p-6 text-center hover:shadow-lg transition"
      >
        <div className="flex justify-center mb-4">{item.icon}</div>
        <h3 className="text-3xl font-bold text-gray-900">{item.stat}</h3>
        <p className="text-sm text-gray-600 mt-2">{item.desc}</p>
      </div>
    ))}
  </div>
</section>

  );
}
