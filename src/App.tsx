/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Search, 
  PenTool, 
  Image as ImageIcon, 
  Mic, 
  Play, 
  Download, 
  Loader2, 
  Sparkles,
  User,
  FileText,
  Database,
  ChevronDown,
  ChevronUp,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const RESEARCH_PROMPT = `You are a biographical research expert. Given a founder's name, return a detailed JSON object about their life.

RULES:
- All dates must be EXACT. Use YYYY-MM-DD, YYYY-MM, or YYYY (number). NEVER write "circa", "around", "approx", or any text with a date.
- Write all descriptions in a punchy, blunt style: short sentences, real numbers, no fluff.
- Use ALL CAPS to emphasize surprising facts.
- Include the failures, the broke years, the rejection. Don't sanitize.
- For money: always give the original amount + what it's worth today + context.
- For quiet periods: describe what they were actually doing day-to-day.

WRITING TONE EXAMPLES:
- "He cold-called 80 people a day and got hung up on 79 times. For THREE YEARS."
- "That's about 40 average annual salaries at the time."
- "Look, nobody talks about the 6 years between his first company failing and his second one working."

INPUT: A founder's name.

OUTPUT: A JSON object matching this exact structure:

{
  "subject": {
    "name": "Full name",
    "birthDate": 1970,                  // YYYY-MM-DD, YYYY-MM, or YYYY (number only)
    "deathDate": "2011-10-05",          // optional, same formats
    "shortBio": "Max 280 chars. Who they are and why they matter."
  },
  "overview": {
    "isDropout": true,
    "majorSchool": "Stanford",
    "firstSuccessfulYear": 1995,
    "companies": [
      { "name": "PayPal", "role": "Co-founder", "impactScore": 9 }
    ],
    "industries": [
      { "name": "Fintech", "impactScore": 10 }
    ],
    "peopleEmployed": "Over 50,000 employees",
    "knownFor": [
      { "name": "Tesla", "relevanceScore": 10 }
    ]
  },
  "timeline": [
    {
      "exactDate": "1995-06",
      "title": "Dropped out of Stanford",
      "shortDescription": "One or two sentences.",
      "detailedDescription": "Full context and significance.",
      "shortie": "Stanford dropout",
      "category": "education",         // career | personal | education | setback | breakthrough | financial | relationship | inactivity
      "duration": "1 week",
      "financialDetails": {            // optional
        "originalAmount": "$18,500 in 1995",
        "context": "Why this amount mattered at the time"
      },
      "relationships": [
        {
          "name": "Peter Thiel",
          "relationship": "Co-founder",
          "impact": "Provided seed funding and strategic direction",
          "timeframe": "1998-2002",
          "keyRelationshipScore": 9
        }
      ],
      "significance": "Why this event changed everything that came after.",
      "sources": [
        { "title": "Source title", "url": "https://..." }
      ]
    }
  ],
  "inactivityPeriods": [
    {
      "startYear": 2003,
      "endYear": 2008,
      "description": "What they were actually doing during this quiet period.",
      "significance": "What this period taught them or set up later."
    }
  ],
  "keyRelationships": [
    {
      "name": "Full name",
      "relationship": "Mentor",
      "impact": "Specific ways they helped",
      "timeframe": "2001-2008",
      "keyRelationshipScore": 8
    }
  ],
  "financialJourney": {
    "startingPoint": "Grew up middle class. First job paid $X in YYYY.",
    "peakNetWorth": {
      "originalAmount": "$180B in 2021",
      "context": "Why this was extraordinary"
    },
    "notableTransactions": [
      {
        "originalAmount": "$250M raised in 2004",
        "context": "Series B, valued the company at $500M"
      }
    ]
  }
}`;

const SCRIPT_PROMPT = `You are writing a solo podcast episode script. One narrator, no guests, no interviews.

STYLE: Sam Parr (My First Million podcast). That means:
- Short punchy sentences. No academic language.
- Blunt and direct. Call out the ugly truth.
- Use real numbers. Specific years. Specific dollar amounts.
- Rhetorical questions: "Can you imagine getting rejected 48 times in a row?"
- Casual openers: "Look,", "Here's the thing,", "Let me tell you,"
- ALL CAPS for shocking facts.
- No fluff intro. Get into the story immediately.

INPUT: A JSON biographical timeline (from the researcher step).

OUTPUT: A complete podcast script for ONE narrator that tells the founder's full life story.

STRUCTURE:
1. Cold open — drop the most shocking fact first (no intro, just start with the wildest thing)
2. Early life — where they came from, what they had (or didn't)
3. The grind years — the boring, brutal, unglamorous period
4. First breakthrough — what changed and why
5. The setbacks — what almost ended it
6. The peak — what they built, with real numbers
7. Legacy — what they actually changed

FORMAT:
- Plain text, no stage directions, no headers in the final script
- Write exactly what the narrator says, word for word
- Length: 1000-1500 words
- End with a punchy one-liner that wraps the whole story`;

const IMAGE_PROMPT = `Create a highly detailed horizontal timeline infographic poster for [FOUNDER NAME] - Phase: [PHASE_TITLE].

CRITICAL REQUIREMENT: You MUST draw a data point for EVERY SINGLE EVENT listed below. Do not summarize, omit, or skip any events.

EVENTS TO SHOW IN THIS PHASE:
[EVENTS]

DESIGN SPECS:
- Layout: Horizontal, left to right, chronological
- Background: Warm cream (#FDF6E3)
- Text and timeline line: Dark charcoal (#2D2D2D)
- Highlights and accents: Sage green (#87A878)
- Secondary labels: Stone gray (#8B8B8B)
- Font style: Monospace / typewriter aesthetic
- Each event MUST have a circular dot marker on the timeline + year label below + title above
- Founder's name: large, prominent, at the top
- Style: clean, minimalist, professional biographical poster
- Bottom right corner: small text reading "Created with founderpod.com"`;

type AppStatus = "idle" | "researching" | "writing" | "generating_media" | "done" | "error";

export default function App() {
  const [founderName, setFounderName] = useState("");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(true);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const has = await window.aistudio.hasSelectedApiKey();
        setHasKey(has);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const [researchData, setResearchData] = useState<any | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  const audioRef = useRef<HTMLAudioElement>(null);

  const addWavHeader = (pcmData: Uint8Array, sampleRate: number, numChannels: number, bitsPerSample: number) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
    view.setUint16(32, numChannels * bitsPerSample / 8, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.length, true);

    const wavData = new Uint8Array(header.byteLength + pcmData.length);
    wavData.set(new Uint8Array(header), 0);
    wavData.set(pcmData, header.byteLength);
    return wavData;
  };

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const handleGenerate = async () => {
    if (!founderName.trim()) {
      setError("Please enter a founder's name.");
      return;
    }

    setStatus("researching");
    setError(null);
    setResearchData(null);
    setScript(null);
    setAudioUrl(null);
    setImageUrls([]);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });

      // Agent 1: Research
      const researchResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: `Founder Name: ${founderName}\n\n${RESEARCH_PROMPT}`,
        config: {
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }],
        }
      });

      const researchJsonText = researchResponse.text || "{}";
      const researchJson = JSON.parse(researchJsonText);
      setResearchData(researchJson);

      // Agent 2: Script
      setStatus("writing");
      const scriptResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `JSON Data:\n${JSON.stringify(researchJson, null, 2)}\n\n${SCRIPT_PROMPT}`,
      });

      const generatedScript = scriptResponse.text || "";
      setScript(generatedScript);

      // Agent 3 & 4: Media Generation (Parallel)
      setStatus("generating_media");

      // Split the timeline into phases (chunks of 3 events)
      const timeline = researchJson.timeline || [];
      const chunkSize = 3;
      const phases = [];
      for (let i = 0; i < timeline.length; i += chunkSize) {
        phases.push(timeline.slice(i, i + chunkSize));
      }

      // If no events, create an empty phase to avoid breaking
      if (phases.length === 0) {
        phases.push([]);
      }

      const imagePromises = phases.map((phaseEvents: any, index: number) => {
        const eventsText = phaseEvents.map((e: any) => `${e.exactDate} — ${e.title}`).join('\n') || "No events";
        const phaseTitle = `Part ${index + 1} of ${phases.length}`;
        
        const finalImagePrompt = IMAGE_PROMPT
          .replace("[FOUNDER NAME]", researchJson.subject?.name || founderName)
          .replace("[PHASE_TITLE]", phaseTitle)
          .replace("[EVENTS]", eventsText);

        console.log(`----- FULL IMAGE PROMPT FOR PHASE ${index + 1} -----`);
        console.log(finalImagePrompt);
        console.log("-----------------------------------------------");

        return ai.models.generateContent({
          model: "gemini-3.1-flash-image-preview",
          contents: finalImagePrompt,
          config: {
            imageConfig: {
              aspectRatio: "16:9"
            }
          }
        }).catch(err => {
          console.error(`Image generation error for phase ${index + 1}:`, err);
          return null; // Prevent image failure from breaking the audio generation
        });
      });

      const audioPromise = ai.models.generateContent({
        model: "gemini-2.5-pro-preview-tts",
        contents: [{ parts: [{ text: `[Tone: Blunt, punchy, direct, conversational, fast-paced, Sam Parr style]\n\n${generatedScript}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Schedar" }
            }
          }
        }
      });

      const [audioRes, ...imageResponses] = await Promise.all([audioPromise, ...imagePromises]);

      // Parse Images
      const newImageUrls: string[] = [];
      for (const imageRes of imageResponses) {
        if (imageRes) {
          for (const part of imageRes.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
              newImageUrls.push(`data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`);
              break;
            }
          }
        }
      }
      setImageUrls(newImageUrls);

      // Parse Audio
      const base64Audio = audioRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binaryString = window.atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const wavData = addWavHeader(bytes, 24000, 1, 16);
        const blob = new Blob([wavData], { type: 'audio/wav' });
        setAudioUrl(URL.createObjectURL(blob));
      }

      setStatus("done");
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes("Requested entity was not found.")) {
        setHasKey(false);
        setError("API Key error. Please select your API key again.");
      } else {
        setError(err.message || "An unexpected error occurred.");
      }
      setStatus("error");
    }
  };

  const downloadAudio = () => {
    if (audioUrl) {
      const a = document.createElement('a');
      a.href = audioUrl;
      a.download = `${founderName.replace(/\s+/g, '_')}_podcast.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  if (!hasKey) {
    return (
      <div className="min-h-screen bg-[#FDF6E3] text-[#2D2D2D] font-mono flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white/50 border border-[#8B8B8B]/30 rounded-3xl p-8 text-center shadow-xl">
          <div className="w-16 h-16 bg-[#87A878] rounded-2xl flex items-center justify-center shadow-lg shadow-[#87A878]/20 mx-auto mb-6">
            <Key className="text-[#FDF6E3] w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-4">API Key Required</h2>
          <p className="text-[#8B8B8B] mb-8">
            To use the high-quality Gemini 3.1 Flash Image model, you need to select a paid Google Cloud API key.
          </p>
          <button
            onClick={handleSelectKey}
            className="bg-[#87A878] text-[#FDF6E3] px-8 py-4 rounded-2xl font-semibold hover:bg-[#759666] transition-all w-full shadow-lg shadow-[#87A878]/20"
          >
            Select API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDF6E3] text-[#2D2D2D] font-mono selection:bg-[#87A878]/30 pb-20">
      {/* Background Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-[#87A878]/10 blur-[120px] rounded-full" />
        <div className="absolute top-[60%] -right-[10%] w-[30%] h-[30%] bg-[#8B8B8B]/10 blur-[120px] rounded-full" />
      </div>

      <div className="relative max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="flex flex-col items-center text-center mb-12">
          <div className="w-16 h-16 bg-[#87A878] rounded-2xl flex items-center justify-center shadow-lg shadow-[#87A878]/20 mb-6">
            <Sparkles className="text-[#FDF6E3] w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-2 text-[#2D2D2D]">Founder Pod</h1>
          <p className="text-sm text-[#8B8B8B] uppercase tracking-widest font-medium">Multi-Agent Studio</p>
        </header>

        {/* Input Section */}
        <div className="max-w-2xl mx-auto mb-12">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-[#8B8B8B]">
                <User className="w-5 h-5" />
              </div>
              <input
                type="text"
                value={founderName}
                onChange={(e) => setFounderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                placeholder="Enter a founder's name (e.g., Steve Jobs, Sara Blakely)"
                className="w-full bg-white/50 border border-[#8B8B8B]/30 rounded-2xl py-4 pl-12 pr-4 text-lg focus:outline-none focus:border-[#87A878] focus:ring-1 focus:ring-[#87A878] transition-colors placeholder:text-[#8B8B8B]/70 text-[#2D2D2D]"
                disabled={status !== "idle" && status !== "done" && status !== "error"}
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={status !== "idle" && status !== "done" && status !== "error"}
              className="bg-[#87A878] text-[#FDF6E3] px-8 rounded-2xl font-semibold hover:bg-[#759666] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-[#87A878]/20"
            >
              {status !== "idle" && status !== "done" && status !== "error" ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Play className="w-5 h-5" />
              )}
              Generate
            </button>
          </div>
          
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center"
            >
              {error}
            </motion.div>
          )}
        </div>

        {/* Status Indicators */}
        <AnimatePresence mode="wait">
          {status !== "idle" && status !== "done" && status !== "error" && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto bg-white/50 border border-[#8B8B8B]/30 rounded-2xl p-6 backdrop-blur-sm"
            >
              <div className="space-y-6">
                <StatusItem 
                  icon={<Search />} 
                  title="Agent 1: Grounded Research" 
                  isActive={status === "researching"} 
                  isDone={status === "writing" || status === "generating_media"} 
                />
                <StatusItem 
                  icon={<PenTool />} 
                  title="Agent 2: Script Writing" 
                  isActive={status === "writing"} 
                  isDone={status === "generating_media"} 
                />
                <StatusItem 
                  icon={<ImageIcon />} 
                  title="Agents 3 & 4: Media Generation (Audio & Image)" 
                  isActive={status === "generating_media"} 
                  isDone={false} 
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Section */}
        <AnimatePresence>
          {status === "done" && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              {/* Audio Player */}
              {audioUrl && (
                <div className="bg-[#87A878]/10 border border-[#87A878]/30 rounded-3xl p-8 backdrop-blur-sm text-center">
                  <h2 className="text-[#87A878] text-sm font-bold uppercase tracking-widest mb-6 flex items-center justify-center gap-2">
                    <Mic className="w-4 h-4" />
                    Final Podcast
                  </h2>
                  <audio 
                    ref={audioRef}
                    src={audioUrl} 
                    controls 
                    className="w-full max-w-2xl mx-auto h-12 rounded-xl mb-6"
                  />
                  <button
                    onClick={downloadAudio}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#2D2D2D] text-[#FDF6E3] hover:bg-[#1a1a1a] rounded-xl transition-colors text-sm font-medium"
                  >
                    <Download className="w-4 h-4" />
                    Download Episode
                  </button>
                </div>
              )}

              <div className="space-y-8">
                {/* Timeline Images */}
                {imageUrls.length > 0 && (
                  <div className="bg-white/50 border border-[#8B8B8B]/30 rounded-3xl overflow-hidden flex flex-col">
                    <div className="p-6 border-b border-[#8B8B8B]/30 flex items-center gap-2 text-[#8B8B8B]">
                      <ImageIcon className="w-5 h-5" />
                      <h3 className="font-medium">Timeline Posters</h3>
                    </div>
                    <div className="p-6 flex flex-col gap-8 items-center justify-center bg-[#FDF6E3]">
                      {imageUrls.map((url, idx) => (
                        <div key={idx} className="w-full flex flex-col items-center">
                          <span className="text-[#8B8B8B] font-mono text-sm mb-4 uppercase tracking-widest">Phase {idx + 1} of {imageUrls.length}</span>
                          <img src={url} alt={`Timeline Phase ${idx + 1}`} className="w-full max-w-4xl h-auto rounded-xl shadow-2xl" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Script */}
                {script && (
                  <CollapsibleSection title="Podcast Script" icon={<FileText className="w-5 h-5" />} defaultOpen={true}>
                    <div className="font-mono text-lg leading-relaxed text-[#2D2D2D] whitespace-pre-wrap">
                      {script}
                    </div>
                  </CollapsibleSection>
                )}

                {/* Research Data */}
                {researchData && (
                  <CollapsibleSection title="Raw Research Data" icon={<Database className="w-5 h-5" />}>
                    <div className="overflow-x-auto">
                      <pre className="text-xs font-mono text-[#8B8B8B]">
                        {JSON.stringify(researchData, null, 2)}
                      </pre>
                    </div>
                  </CollapsibleSection>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StatusItem({ icon, title, isActive, isDone }: { icon: React.ReactNode, title: string, isActive: boolean, isDone: boolean }) {
  return (
    <div className={`flex items-center gap-4 transition-opacity duration-300 ${isActive ? 'opacity-100' : isDone ? 'opacity-50' : 'opacity-30'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isActive ? 'bg-[#87A878]/20 text-[#87A878]' : isDone ? 'bg-[#8B8B8B]/20 text-[#8B8B8B]' : 'bg-[#8B8B8B]/10 text-[#8B8B8B]/70'}`}>
        {isActive ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}
      </div>
      <span className={`font-medium ${isActive ? 'text-[#87A878]' : isDone ? 'text-[#8B8B8B]' : 'text-[#8B8B8B]/70'}`}>
        {title}
      </span>
    </div>
  );
}

function CollapsibleSection({ title, icon, children, defaultOpen = false }: { title: string, icon: React.ReactNode, children: React.ReactNode, defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-white/50 border border-[#8B8B8B]/30 rounded-3xl flex flex-col overflow-hidden">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-6 flex items-center justify-between text-[#2D2D2D] hover:bg-[#8B8B8B]/10 transition-colors w-full"
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-medium">{title}</h3>
        </div>
        {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }} 
            animate={{ height: 'auto', opacity: 1 }} 
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-6 border-t border-[#8B8B8B]/30">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
