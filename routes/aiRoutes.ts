import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const router = Router();
let ai: GoogleGenAI | null = null;

if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// 1. AI Chat Assistant
router.post("/chat", async (req, res) => {
  try {
    if (!ai) {
      return res.status(503).json({ success: false, message: "AI not configured. Missing GEMINI_API_KEY." });
    }

    const { messages } = req.body; // Array of { role: "user" | "model", parts: [{text: "..."}] }
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, message: "Messages array is required." });
    }

    const systemPrompt = `You are MOTORA AI, an expert automotive assistant for the MOTORA premium car marketplace. 
    You help users find cars, answer questions about luxury vehicles, supercars, and hypercars, and guide them through the platform.
    Keep your answers concise, professional, and helpful.`;

    // Extract the latest message
    const latestMessage = messages[messages.length - 1];
    
    // We will just use generateContent with the system prompt and history formatted as text for simplicity
    // in this basic implementation to avoid complex Content type mapping.
    let promptContext = `${systemPrompt}\n\nConversation History:\n`;
    messages.forEach((msg: any) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const text = msg.parts?.[0]?.text || '';
      promptContext += `${role}: ${text}\n`;
    });
    
    promptContext += `\nAssistant:`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptContext,
    });

    res.json({
      success: true,
      data: {
        response: response.text
      }
    });
  } catch (error: any) {
    console.error("AI Chat Error:", error);
    res.status(500).json({ success: false, message: "Failed to generate AI response." });
  }
});

// 2. AI Content Generator (for Add Car Description)
router.post("/generate-description", async (req, res) => {
  try {
    if (!ai) {
      return res.status(503).json({ success: false, message: "AI not configured. Missing GEMINI_API_KEY." });
    }

    const { title, category } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, message: "Car title is required." });
    }

    const prompt = `Write a premium, engaging, and professional car listing description for a "${title}". 
    The car's category is "${category || 'luxury'}". 
    Make it sound appealing to high-end buyers. Include an introduction, performance highlights, and interior luxury notes. 
    Keep it around 2-3 short paragraphs. Output only the description text.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    res.json({
      success: true,
      data: {
        description: response.text
      }
    });
  } catch (error: any) {
    console.error("AI Description Error:", error);
    res.status(500).json({ success: false, message: "Failed to generate description." });
  }
});

export const aiRoutes = router;
