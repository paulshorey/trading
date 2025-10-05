"use client";

import { useState } from "react";
import { TextInput, Textarea, Alert, Loader } from "@mantine/core";
import { IconMail, IconUser, IconAlertCircle, IconCheck } from "@tabler/icons-react";

export default function Home() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      setStatus("success");
      setFormData({ name: "", email: "", message: "" });
    } catch (error) {
      setStatus("error");
      setErrorMessage("Failed to send message. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl shadow-xl rounded-lg p-4 sm:p-8 bg-white/95 backdrop-blur-lg">
        {/* Coming Soon Badge */}
        <div className="text-center mb-3">
          <span
            className="text-lg inline-block rounded-full px-4 pt-2 font-semibold text-gray-400"
            style={
              {
                // textDecoration: "underline",
              }
            }
          >
            facts.news
          </span>
        </div>

        {/* Main Title */}
        <div className="text-center mb-1">
          <span className="inline-block text-2xl font-extrabold mb-3 bg-gradient-to-br from-violet-500 to-sky-500 bg-clip-text text-transparent">
            Coming Soon!
          </span>
        </div>

        {/* Subtitle */}
        <p className="text-lg text-center text-gray-700 leading-relaxed font-semibold bg-gradient-to-br from-violet-500 to-sky-500 bg-clip-text text-transparent">
          &nbsp;No&nbsp;pandering.&nbsp;
          <wbr />
          No&nbsp;paywalls.
          <br />
          &nbsp;Just lists of policies and statistics,
          <br />
          &nbsp;uniquely visualized, easy to understand,
          <br className="hidden sm:block" />
          &nbsp;to share with whomever needs to know the facts.
        </p>
        {/* <p className="text-lg text-center mb-8 text-gray-400 leading-relaxed font-semibold">Plus the obligatory TikTok/YouTube channels.</p> */}

        {/* Contact Section */}
        <div
          className="mt-9"
          style={{
            borderTop: "1px solid #e0e0e0",
            paddingTop: "1.5rem",
          }}
        >
          <div className="text-center mb-6">
            <span className="inline-block text-xl font-semibold mt-2 mb-4 bg-gradient-to-br from-violet-500 to-sky-500 bg-clip-text text-transparent">
              Unfortunately,
            </span>
            <p className="text-sm text-center mb-6 text-gray-500">
              I don't have enough time or money to work on this right now. If you can contribute ideas, writing, video editing, or investment, please reach out.
              Together we can make the world a more intelligent and understanding place by sharing fun sized educational content.
            </p>
          </div>

          {/* Success Message */}
          {status === "success" && (
            <Alert icon={<IconCheck size={16} />} title="Message sent!" color="green" mb="md" onClose={() => setStatus("idle")} withCloseButton>
              Thank you for reaching out. I'll get back to you soon!
            </Alert>
          )}

          {/* Error Message */}
          {status === "error" && (
            <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" mb="md" onClose={() => setStatus("idle")} withCloseButton>
              {errorMessage}
            </Alert>
          )}

          {/* Contact Form */}
          <form onSubmit={handleSubmit}>
            <TextInput
              placeholder="Your name"
              required
              mb="md"
              leftSection={<IconUser size={16} />}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={status === "loading"}
            />

            <TextInput
              placeholder="your@email.com"
              required
              type="email"
              mb="md"
              leftSection={<IconMail size={16} />}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              disabled={status === "loading"}
            />

            <Textarea
              placeholder="How we can work together..."
              required
              minRows={4}
              mb="md"
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              disabled={status === "loading"}
            />
            <p className="text-sm text-center mb-6 text-gray-500">I'm Paul Shorey. Software engineer and artist from USA. More about me coming soon.</p>

            <div className="flex justify-center mt-8">
              <button
                type="submit"
                disabled={status === "loading"}
                className="bg-gradient-to-br from-violet-500 to-sky-500 text-white px-4 py-2 rounded-md font-bold flex items-center gap-2"
              >
                {status === "loading" && <Loader size="sm" color="white" />}
                Send Inquiry
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
