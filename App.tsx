
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LANGUAGES, Language, TranscriptEntry } from './types';
import { decode, decodeAudioData, createBlob } from './audioUtils';

// Constants
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const SAMPLE_RATE_IN = 16000;
const SAMPLE_RATE_OUT = 24000;

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [langA, setLangA] = useState<Language>(LANGUAGES[0]); // Default Vietnamese
  const [langB, setLangB] = useState<Language>(LANGUAGES[1]); // Default English
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Audio Contexts & Refs
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const transcriptListEndRef = useRef<HTMLDivElement>(null);

  // Accumulators for transcription
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  // Scroll to bottom helper
  useEffect(() => {
    transcriptListEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close();
      outputAudioCtxRef.current = null;
    }
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    setIsActive(false);
  }, []);

  const startSession = async () => {
    try {
      setError(null);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

      // Initialize Audio
      inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_IN });
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUT });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: `You are a professional simultaneous interpreter. 
          Translate continuously between ${langA.name} and ${langB.name}. 
          If you hear ${langA.name}, translate to ${langB.name}. 
          If you hear ${langB.name}, translate to ${langA.name}.
          Speak ONLY the translation. Do not add conversational filler unless the user asks you a direct question.
          Keep the output professional and accurate.`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live session opened');
            setIsActive(true);
            
            // Start streaming mic input
            const source = inputAudioCtxRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioCtxRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcription
            if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = currentInputTranscription.current.trim();
              const modelText = currentOutputTranscription.current.trim();

              if (userText) {
                setTranscripts(prev => [...prev, {
                  id: Math.random().toString(),
                  role: 'user',
                  text: userText,
                  timestamp: Date.now()
                }]);
              }
              if (modelText) {
                setTranscripts(prev => [...prev, {
                  id: Math.random().toString(),
                  role: 'model',
                  text: modelText,
                  timestamp: Date.now()
                }]);
              }

              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }

            // Handle Audio Playback
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioCtxRef.current) {
              const ctx = outputAudioCtxRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                ctx,
                SAMPLE_RATE_OUT,
                1
              );

              const sourceNode = ctx.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.connect(ctx.destination);
              sourceNode.addEventListener('ended', () => {
                sourcesRef.current.delete(sourceNode);
              });

              sourceNode.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(sourceNode);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => {
                try { s.stop(); } catch (e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Session error:', e);
            setError('Đã xảy ra lỗi kết nối. Vui lòng thử lại.');
            stopSession();
          },
          onclose: () => {
            console.log('Session closed');
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error(err);
      setError('Không thể khởi động micro hoặc kết nối API: ' + err.message);
      setIsActive(false);
    }
  };

  const toggleSession = () => {
    if (isActive) stopSession();
    else startSession();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      <div className="max-w-4xl w-full bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[85vh] border border-slate-100">
        
        {/* Header */}
        <header className="p-6 bg-gradient-to-r from-blue-600 to-indigo-700 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Gemini Translator</h1>
            <p className="text-blue-100 text-sm opacity-90">Dịch thuật trực tuyến liên tục</p>
          </div>
          
          <div className="flex items-center gap-2 bg-white/20 p-2 rounded-xl backdrop-blur-md">
            <select 
              disabled={isActive}
              value={langA.code}
              onChange={(e) => setLangA(LANGUAGES.find(l => l.code === e.target.value)!)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer p-1"
            >
              {LANGUAGES.map(l => <option key={l.code} value={l.code} className="text-black">{l.flag} {l.name}</option>)}
            </select>
            <span className="text-blue-200">⟷</span>
            <select 
              disabled={isActive}
              value={langB.code}
              onChange={(e) => setLangB(LANGUAGES.find(l => l.code === e.target.value)!)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer p-1"
            >
              {LANGUAGES.map(l => <option key={l.code} value={l.code} className="text-black">{l.flag} {l.name}</option>)}
            </select>
          </div>
        </header>

        {/* Transcript Area */}
        <main className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
          {transcripts.length === 0 && !isActive && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center space-y-4">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
              </div>
              <p>Nhấn "Bắt đầu dịch" và nói để bắt đầu</p>
            </div>
          )}

          {transcripts.map((entry) => (
            <div 
              key={entry.id} 
              className={`flex ${entry.role === 'user' ? 'justify-start' : 'justify-end'}`}
            >
              <div className={`max-w-[80%] rounded-2xl p-4 ${
                entry.role === 'user' 
                ? 'bg-white border border-slate-200 text-slate-800 rounded-bl-none' 
                : 'bg-indigo-600 text-white rounded-br-none'
              } shadow-sm transition-all duration-300 animate-in fade-in slide-in-from-bottom-2`}>
                <p className="text-sm font-semibold opacity-70 mb-1">
                  {entry.role === 'user' ? 'Gốc' : 'Dịch'}
                </p>
                <p className="text-base leading-relaxed">{entry.text}</p>
              </div>
            </div>
          ))}
          <div ref={transcriptListEndRef} />
        </main>

        {/* Footer / Controls */}
        <footer className="p-6 border-t border-slate-100 bg-white flex flex-col items-center gap-4">
          {error && (
            <div className="w-full p-3 rounded-lg bg-red-50 text-red-600 text-sm flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
              {error}
            </div>
          )}

          <div className="flex items-center gap-6">
            <button
              onClick={toggleSession}
              className={`group relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-500 shadow-xl ${
                isActive 
                ? 'bg-red-500 hover:bg-red-600 scale-110 ring-4 ring-red-100' 
                : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105'
              }`}
            >
              {isActive ? (
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"></path></svg>
              ) : (
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
              )}
              {isActive && (
                <span className="absolute -inset-2 rounded-full border-2 border-red-500 animate-ping opacity-25"></span>
              )}
            </button>
          </div>
          
          <div className="text-center">
            <p className={`font-medium transition-colors duration-300 ${isActive ? 'text-red-500' : 'text-slate-500'}`}>
              {isActive ? 'Đang lắng nghe & dịch...' : 'Sẵn sàng bắt đầu'}
            </p>
            <p className="text-xs text-slate-400 mt-1">Sử dụng Gemini-2.5-Flash Live</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
