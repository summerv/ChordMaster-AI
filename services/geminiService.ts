import { GoogleGenAI } from "@google/genai";
import { Chord, InstrumentType } from "../types";

const getGeminiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API_KEY is not set. Gemini features will be disabled.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const getChordTheory = async (chord: Chord, instrument: InstrumentType): Promise<string> => {
  const client = getGeminiClient();
  if (!client) return "Please configure your API Key to use the AI Tutor.";

  try {
    const prompt = `
      As a music theory expert, briefly explain the ${chord.displayName} chord.
      1. What notes constitute this chord?
      2. How is it typically used in a progression?
      3. Give a specific tip for playing it on a ${instrument}.
      Keep the response concise (under 100 words) and encouraging.
    `;

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "Could not retrieve theory information.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error connecting to AI Tutor. Please try again later.";
  }
};
