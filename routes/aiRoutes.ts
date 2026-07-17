import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const router = Router();
let genAI: GoogleGenerativeAI | null = null;

if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// 1. AI Chat Assistant
router.post("/chat", async (req, res) => {
  try {
    if (!genAI) {
      return res.status(503).json({ success: false, message: "AI not configured. Missing GEMINI_API_KEY." });
    }

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, message: "Messages array is required." });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: `You are MOTORA AI, an expert automotive assistant for the MOTORA premium car marketplace. 
      You help users find cars, answer questions about luxury vehicles, supercars, and hypercars, and guide them through the platform.
      Keep your answers concise, professional, and helpful.`,
    });

    // Build chat history (exclude last message since we send it separately)
    const history = messages.slice(0, -1).map((msg: any) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.parts?.[0]?.text || "" }],
    }));

    const chat = model.startChat({ history });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.parts?.[0]?.text || "Hello");
    const text = result.response.text();

    res.json({ success: true, data: { response: text } });
  } catch (error: any) {
    console.error("AI Chat Error:", error?.message || error);
    res.status(500).json({ success: false, message: "Failed to generate AI response." });
  }
});

// 2. AI Content Generator (for Add Car Description)
router.post("/generate-description", async (req, res) => {
  try {
    if (!genAI) {
      return res.status(503).json({ success: false, message: "AI not configured. Missing GEMINI_API_KEY." });
    }

    const { title, category } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: "Car title is required." });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Write a premium, engaging, and professional car listing description for a "${title}". 
    The car category is "${category || "luxury"}". 
    Make it sound appealing to high-end buyers. Include an introduction, performance highlights, and interior luxury notes. 
    Keep it around 2-3 short paragraphs. Output only the plain text description, no markdown or bullet points.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    res.json({ success: true, data: { description: text } });
  } catch (error: any) {
    console.error("AI Description Error:", error?.message || error);
    res.status(500).json({ success: false, message: "Failed to generate description." });
  }
});

export const aiRoutes = router;
