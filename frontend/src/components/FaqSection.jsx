import React, { useState } from "react";

const faqs = [
  {
    question: "Can I use Tonefy AI Video generator for free?",
    answer:
      "Yes, Tonefy offers a free plan so you can explore its features without needing a credit card.",
  },
  {
    question: "How does Tonefy differ from other text-to-video and text-to-speech tools in the market?",
    answer:
      "Tonefy stands out with lifelike AI voices, rich media libraries, and an intuitive interface tailored for fast content creation.",
  },
  {
    question: "Which languages are supported?",
    answer:
      "Tonefy supports over 75 languages and 100+ regional dialects for both text and speech.",
  },
  {
    question: "Do I need any special software or equipment to use this tool?",
    answer:
      "No, Tonefy runs entirely in your browser—no installations or special equipment required.",
  },
  {
    question: "How does the text to speech feature in Tonefy work?",
    answer:
      "You enter text, choose a voice, and Tonefy instantly generates high-quality voiceovers using advanced AI models.",
  },
  {
    question: "What kinds of videos can I make using Tonefy's platform?",
    answer:
      "You can create explainer videos, social media content, training videos, podcasts, and more.",
  },
  {
    question: "Which languages are supported by Tonefy for text-to-speech conversion?",
    answer:
      "Tonefy supports a wide range of languages including English, Spanish, French, Hindi, Mandarin, and more.",
  },
  {
    question: "Can I export the videos I make with Tonefy? If so, what formats are available?",
    answer:
      "Yes, you can export videos in MP4 format with different quality options depending on your plan.",
  },
  {
    question: "Do I need any other software or technical tools to use Tonefy’s text-to-speech feature?",
    answer:
      "No, everything is integrated into the platform. Just your browser is enough.",
  },
  {
    question: "How does Tonefy differ from other text-to-video and text-to-speech tools in the market?",
    answer:
      "Tonefy focuses on ease of use, fast rendering, and studio-quality voiceovers, which makes it unique.",
  },
  {
    question: "Does Tonefy offer support if I run into problems or have questions?",
    answer:
      "Absolutely! You can reach out to Tonefy’s support team via live chat or email anytime.",
  },
  {
    question: "Does Tonefy support Voice Cloning? How can it help me?",
    answer:
      "Yes, Tonefy supports voice cloning for premium users, allowing you to create content in your own voice.",
  },
  {
    question: "Should I have prior experience as a designer or video editor to use this tool?",
    answer:
      "No experience is required. The interface is beginner-friendly and built for anyone to use.",
  },
  {
    question: "What if I only need Tonefy for a short amount of time?",
    answer:
      "You can choose a monthly plan or use the free version for basic needs.",
  },
  {
    question: "How do I pay?",
    answer:
      "Tonefy accepts major credit/debit cards and offers secure online payments.",
  },
  {
    question: "How does Tonefy's payment system work?",
    answer:
      "You choose a plan—monthly or yearly—and can upgrade, downgrade, or cancel anytime.",
  },
];

const FaqSection = () => {
  const [openIndex, setOpenIndex] = useState(null);

  const toggle = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-white">
      <section className="max-w-4xl w-full">
        <h2 className="text-3xl font-bold text-center mb-10">
          Frequently Asked Questions
        </h2>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg shadow-sm p-4"
            >
              <div
                className="flex justify-between items-center cursor-pointer"
                onClick={() => toggle(index)}
              >
                <h3 className="text-lg font-medium text-gray-800">
                  {faq.question}
                </h3>
                <span className="text-2xl font-bold text-[#2ecc71]">
                  {openIndex === index ? "−" : "+"}
                </span>
              </div>
              {openIndex === index && (
                <p className="mt-3 text-gray-600">{faq.answer}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 text-center text-gray-700">
          <p>
            Have another question?{" "}
            <a href="#contact" className="text-[#2ecc71] font-medium underline">
              Write to us
            </a>
          </p>
        </div>
      </section>
    </div>
  );
};

export default FaqSection;
