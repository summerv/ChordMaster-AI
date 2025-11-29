import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { InstrumentType, ChordQuality, Chord, PracticeSession, PianoTimbre, PracticeFilter, HistoryEntry } from './types';
import { audioEngine } from './services/audioEngine';
import { getChordTheory } from './services/geminiService';
import Piano from './components/Piano';
import StringInstrument from './components/StringInstrument';

// --- Data Constants ---
// Roots ordered Chromatically starting at C
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROOT_MIDI_MAP: Record<string, number> = {
  'C': 0, 'C#': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11
};

const QUALITIES: Record<ChordQuality, number[]> = {
  [ChordQuality.Major]: [0, 4, 7],
  [ChordQuality.Minor]: [0, 3, 7],
  [ChordQuality.Dominant7]: [0, 4, 7, 10],
  [ChordQuality.Major7]: [0, 4, 7, 11],
  [ChordQuality.Minor7]: [0, 3, 7, 10],
};

// Helper to get note name from root index + interval
const getNoteName = (rootIndex: number, interval: number): string => {
  const normIndex = (rootIndex + interval) % 12;
  return ROOTS[normIndex];
};

// Helper to generate inversions for a specific chord definition
const generateVariations = (root: string, quality: ChordQuality, baseIntervals: number[]): Chord[] => {
  const rootIndex = ROOT_MIDI_MAP[root];
  const variations: Chord[] = [];

  // Root Position (Inversion 0)
  variations.push({
    root,
    quality,
    inversion: 0,
    displayName: `${root}${quality === ChordQuality.Major ? '' : quality === ChordQuality.Minor ? 'm' : quality}`,
    intervals: baseIntervals
  });

  // 1st Inversion (Inversion 1)
  // Move lowest note (0) up 12 semitones
  const firstInvIntervals = [...baseIntervals.slice(1), baseIntervals[0] + 12];
  // Calculate bass note for Slash Chord name (the new lowest note)
  // Original intervals were relative to root.
  // [0, 4, 7] -> [4, 7, 12]. Lowest is 4 (the 3rd).
  const bassNote1 = getNoteName(rootIndex, baseIntervals[1]); 
  variations.push({
    root,
    quality,
    inversion: 1,
    displayName: `${root}${quality === ChordQuality.Major ? '' : quality === ChordQuality.Minor ? 'm' : quality}/${bassNote1}`,
    intervals: firstInvIntervals
  });

  // 2nd Inversion (Inversion 2)
  // Move the new lowest (originally the 3rd) up 12 semitones
  // From 1st: [4, 7, 12] -> [7, 12, 16]
  const secondInvIntervals = [...firstInvIntervals.slice(1), firstInvIntervals[0] + 12];
  const bassNote2 = getNoteName(rootIndex, baseIntervals[2]);
  variations.push({
    root,
    quality,
    inversion: 2,
    displayName: `${root}${quality === ChordQuality.Major ? '' : quality === ChordQuality.Minor ? 'm' : quality}/${bassNote2}`,
    intervals: secondInvIntervals
  });

  // 3rd Inversion (Inversion 3) - Only for 7th chords (4 notes)
  if (baseIntervals.length === 4) {
    // Move the new lowest (originally the 5th) up 12 semitones
    // From 2nd: [7, 10, 12, 16] -> [10, 12, 16, 19]
    const thirdInvIntervals = [...secondInvIntervals.slice(1), secondInvIntervals[0] + 12];
    const bassNote3 = getNoteName(rootIndex, baseIntervals[3]);
    variations.push({
      root,
      quality,
      inversion: 3,
      displayName: `${root}${quality === ChordQuality.Major ? '' : quality === ChordQuality.Minor ? 'm' : quality}/${bassNote3}`,
      intervals: thirdInvIntervals
    });
  }

  return variations;
};

// Generate all Chords Grouped by Root
const CHORD_GROUPS: { root: string, chords: Chord[] }[] = ROOTS.map(root => {
    // Flatten all qualities and their inversions into one list for this root
    const chords = Object.values(ChordQuality).flatMap(quality => 
        generateVariations(root, quality, QUALITIES[quality])
    );
    return { root, chords };
});

const ALL_CHORDS_FLAT = CHORD_GROUPS.flatMap(g => g.chords);

const PIANO_TIMBRES: PianoTimbre[] = ['Grand', 'Electric', 'HonkyTonk'];

const App: React.FC = () => {
  // State
  const [instrument, setInstrument] = useState<InstrumentType>(InstrumentType.Piano);
  const [pianoTimbre, setPianoTimbre] = useState<PianoTimbre>('Grand');
  const [currentChord, setCurrentChord] = useState<Chord | null>(null);
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  
  // Settings
  const [practiceFilter, setPracticeFilter] = useState<PracticeFilter>('All');
  const [showInversions, setShowInversions] = useState<boolean>(false);
  
  // Practice State
  const [practice, setPractice] = useState<PracticeSession>({
    isActive: false,
    targetChord: null,
    revealed: false,
    timer: 10,
    timerSetting: 10,
    hasMadeMistake: false
  });

  // Score & History
  const [isScoreMode, setIsScoreMode] = useState(false);
  const [currentScore, setCurrentScore] = useState({ correct: 0, wrong: 0, startTime: 0 });
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
      const saved = localStorage.getItem('chordMasterHistory');
      return saved ? JSON.parse(saved) : [];
  });
  
  // Feedback State
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'correct' | 'wrong' | 'timeout'>('idle');
  const [pressedChordName, setPressedChordName] = useState<string | null>(null);
  
  // AI Logic
  const [aiTip, setAiTip] = useState<string>("");
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // Timer Ref
  const timerRef = useRef<number | null>(null);

  // Save history to local storage
  useEffect(() => {
      localStorage.setItem('chordMasterHistory', JSON.stringify(history));
  }, [history]);

  // Helper to calculate MIDI notes for a chord
  const getChordNotes = useCallback((chord: Chord): number[] => {
    const baseRoot = ROOT_MIDI_MAP[chord.root];
    
    // Shifted Ranges Upwards as requested
    let baseOctave = 60; // C4 (Middle C) for Piano
    if (instrument === InstrumentType.Violin) baseOctave = 67; // G4 range
    if (instrument === InstrumentType.Guitar) baseOctave = 52; // E3 (Mid-range guitar)

    let rootMidi = baseOctave + baseRoot;
    
    // Adjust to ensure we stay within a reasonable listening range if it gets too high
    // Especially important for inversions which push notes up +12 or +16 semitones
    // If the base note is too high, shift the whole chord down an octave
    // Increased threshold slightly for 3rd inversions
    if (rootMidi > 76) rootMidi -= 12;

    return chord.intervals.map(interval => rootMidi + interval);
  }, [instrument]);

  // --- Piano Interactive Playback ---
  const handleNoteStart = (midi: number) => {
    // If playing piano manually, show the note and play it
    setActiveNotes([midi]);
    audioEngine.startChord([midi], instrument, pianoTimbre);
  };

  const handleNoteStop = () => {
    // Only stop if we are not currently holding a chord or showing an answer
    if (!pressedChordName && !practice.revealed) {
        audioEngine.stopChord();
        // Don't clear active notes if it's the target chord being shown
        if (!practice.targetChord || !practice.revealed) {
            setActiveNotes([]);
        }
    }
  };


  // --- Chord Playback Logic ---

  // Long Press Start
  const handleChordPress = (chord: Chord) => {
    if (practice.isActive && !practice.revealed) {
        // In guessing mode, we treat press as a guess attempt
        handlePracticeGuess(chord);
        return;
    }

    const notes = getChordNotes(chord);
    setCurrentChord(chord);
    setActiveNotes(notes);
    setPressedChordName(chord.displayName);
    audioEngine.startChord(notes, instrument, pianoTimbre);
    setAiTip(""); 
  };

  // Long Press End
  const handleChordRelease = () => {
    setPressedChordName(null);
    audioEngine.stopChord();
  };

  // Practice Guess Logic
  const handlePracticeGuess = (chord: Chord) => {
    // If answer already revealed, ignore
    if (practice.revealed) return;

    if (chord.displayName === practice.targetChord?.displayName) {
        setFeedbackStatus('correct');
        // Only count as correct if they haven't made a mistake in this round yet
        if (isScoreMode && !practice.hasMadeMistake) {
            setCurrentScore(prev => ({ ...prev, correct: prev.correct + 1 }));
        }
        revealAnswer(true);
    } else {
        // Wrong guess
        setFeedbackStatus('wrong');
        
        // Only count the FIRST mistake in a round
        if (isScoreMode && !practice.hasMadeMistake) {
             setCurrentScore(prev => ({ ...prev, wrong: prev.wrong + 1 }));
             setPractice(prev => ({ ...prev, hasMadeMistake: true }));
        }
        
        // Reset 'wrong' status after animation triggers (short delay) so user can try again
        setTimeout(() => setFeedbackStatus('idle'), 800);
        
        const notes = getChordNotes(chord);
        audioEngine.playNotes(notes, instrument, pianoTimbre); 
    }
  };

  // Practice Mode Logic
  const startPracticeRound = useCallback(() => {
    // Filter logic
    let pool = ALL_CHORDS_FLAT;

    // 1. Filter by Practice Type (Triads, Sevenths, All)
    if (practiceFilter === 'Triads') {
        pool = pool.filter(c => c.quality === ChordQuality.Major || c.quality === ChordQuality.Minor);
    } else if (practiceFilter === 'Sevenths') {
        pool = pool.filter(c => c.quality === ChordQuality.Dominant7 || c.quality === ChordQuality.Major7 || c.quality === ChordQuality.Minor7);
    }

    // 2. Filter by Inversion Setting
    if (!showInversions) {
        pool = pool.filter(c => c.inversion === 0);
    }

    const randomChord = pool[Math.floor(Math.random() * pool.length)];
    
    setPractice(prev => ({
      ...prev,
      targetChord: randomChord,
      revealed: false,
      timer: prev.timerSetting,
      hasMadeMistake: false // Reset mistake flag for new round
    }));
    setFeedbackStatus('idle');
    setCurrentChord(null); // Hide current chord display
    
    // Play the target sound
    const notes = getChordNotes(randomChord);
    audioEngine.playNotes(notes, instrument, pianoTimbre);

    // Start Timer
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setPractice(prev => {
        if (prev.timer <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setFeedbackStatus('timeout');
          
          // Timeout counts as a mistake if score mode is on, unless already marked wrong
          if (isScoreMode && !prev.hasMadeMistake) {
               setCurrentScore(prevScore => ({ ...prevScore, wrong: prevScore.wrong + 1 }));
          }
          
          return { ...prev, timer: 0, revealed: true };
        }
        return { ...prev, timer: prev.timer - 1 };
      });
    }, 1000);
  }, [getChordNotes, instrument, pianoTimbre, practiceFilter, isScoreMode, showInversions]);

  const togglePracticeMode = () => {
    if (practice.isActive) {
      // STOPPING PRACTICE
      
      // Save History if in Score Mode or just general tracking
      const totalAttempts = currentScore.correct + currentScore.wrong;
      if (totalAttempts > 0) {
          const newEntry: HistoryEntry = {
              id: Date.now().toString(),
              timestamp: currentScore.startTime,
              durationSeconds: Math.floor((Date.now() - currentScore.startTime) / 1000),
              mode: practiceFilter,
              isScored: isScoreMode,
              correctCount: currentScore.correct,
              totalAttempts: totalAttempts,
              accuracy: Math.round((currentScore.correct / totalAttempts) * 100)
          };
          setHistory(prev => [newEntry, ...prev]);
      }

      setPractice(prev => ({ ...prev, isActive: false, targetChord: null, revealed: false, hasMadeMistake: false }));
      if (timerRef.current) clearInterval(timerRef.current);
      setCurrentChord(null);
      setActiveNotes([]);
      setFeedbackStatus('idle');
      audioEngine.stopChord();
    } else {
      // STARTING PRACTICE
      setCurrentScore({ correct: 0, wrong: 0, startTime: Date.now() });
      setPractice(prev => ({ ...prev, isActive: true, hasMadeMistake: false }));
      startPracticeRound();
    }
  };

  const revealAnswer = (correct: boolean) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPractice(prev => ({ ...prev, revealed: true, timer: 0 }));
    if (practice.targetChord) {
      setCurrentChord(practice.targetChord);
      const notes = getChordNotes(practice.targetChord);
      setActiveNotes(notes);
      audioEngine.playNotes(notes, instrument, pianoTimbre); 
    }
  };

  const handleReplay = () => {
    if (practice.targetChord) {
      audioEngine.playNotes(getChordNotes(practice.targetChord), instrument, pianoTimbre);
    }
  };

  const handleAskAI = async () => {
    if (!currentChord) return;
    setIsLoadingAi(true);
    const tip = await getChordTheory(currentChord, instrument);
    setAiTip(tip);
    setIsLoadingAi(false);
  };

  // Cleanup
  useEffect(() => {
    const globalUp = () => audioEngine.stopChord();
    window.addEventListener('mouseup', globalUp);
    return () => {
      window.removeEventListener('mouseup', globalUp);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Update visuals if instrument changes
  useEffect(() => {
    if (currentChord) {
      setActiveNotes(getChordNotes(currentChord));
    }
  }, [instrument, getChordNotes, currentChord]);

  // Effect to handle timeout reveal visual sync
  useEffect(() => {
      if (practice.isActive && practice.revealed && practice.targetChord && feedbackStatus === 'timeout' && !currentChord) {
           setCurrentChord(practice.targetChord);
           setActiveNotes(getChordNotes(practice.targetChord));
           audioEngine.playNotes(getChordNotes(practice.targetChord), instrument, pianoTimbre);
      }
  }, [practice.revealed, practice.isActive, practice.targetChord, feedbackStatus, currentChord, getChordNotes, instrument, pianoTimbre]);

  // Calculate Best Record
  const bestRecordId = useMemo(() => {
      if (history.length === 0) return null;
      // Filter for sessions with reasonable attempts to avoid 1/1 100% winning against 50/50 100%
      // Simple logic: sort by accuracy descending, then total attempts descending
      const sorted = [...history].sort((a, b) => {
          if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
          return b.totalAttempts - a.totalAttempts;
      });
      return sorted[0].id;
  }, [history]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center py-6 px-2 sm:px-4">
      <header className="mb-6 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-sky-400 to-indigo-500">
          ChordMaster AI
        </h1>
      </header>

      <main className="w-full max-w-6xl space-y-6">
        
        {/* Top Controls: Instruments */}
        <div className="flex flex-col md:flex-row justify-center items-center bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm gap-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
              {/* Instrument Toggle */}
              <div className="flex space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-700">
                {Object.values(InstrumentType).map(t => (
                  <button
                    key={t}
                    onClick={() => setInstrument(t)}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                      instrument === t 
                        ? 'bg-sky-600 text-white shadow-md' 
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Piano Timbre Toggle */}
              {instrument === InstrumentType.Piano && (
                  <div className="flex space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-700 animate-fade-in">
                      {PIANO_TIMBRES.map(timbre => (
                          <button
                            key={timbre}
                            onClick={() => setPianoTimbre(timbre)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                pianoTimbre === timbre
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                            }`}
                          >
                              {timbre}
                          </button>
                      ))}
                  </div>
              )}
          </div>
        </div>

        {/* Instrument Visualizer */}
        <div className="relative">
             {instrument === InstrumentType.Piano ? (
               <Piano activeNotes={activeNotes} onNoteStart={handleNoteStart} onNoteStop={handleNoteStop} />
             ) : (
               <StringInstrument type={instrument} activeNotes={activeNotes} />
             )}
        </div>

        {/* AI Tutor Info - Below Instrument */}
        {currentChord && !practice.isActive && (
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
             <div className="flex justify-between items-center mb-2">
               <span className="text-sm font-semibold text-indigo-400">AI Theory Tutor</span>
               {!aiTip && (
                <button 
                  onClick={handleAskAI}
                  disabled={isLoadingAi}
                  className="text-xs bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 px-3 py-1 rounded transition-colors"
                >
                  {isLoadingAi ? 'Asking Gemini...' : `Explain ${currentChord.displayName}`}
                </button>
               )}
             </div>
             {aiTip && <p className="text-slate-300 text-sm animate-fade-in">{aiTip}</p>}
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
           
           {/* Sidebar: Control Center */}
           <div className="lg:col-span-1 space-y-6 order-2 lg:order-1">
              
              {/* Practice Settings & Controls */}
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Practice Settings</span>
                </div>
                
                {/* Score Mode Toggle */}
                <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Score Mode</span>
                    <button 
                        onClick={() => !practice.isActive && setIsScoreMode(!isScoreMode)}
                        disabled={practice.isActive}
                        className={`w-10 h-5 rounded-full relative transition-colors ${isScoreMode ? 'bg-sky-500' : 'bg-slate-700'} ${practice.isActive ? 'opacity-50' : ''}`}
                    >
                        <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${isScoreMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>
                
                 {/* Inversions Toggle */}
                <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Include Inversions</span>
                    <button 
                        onClick={() => !practice.isActive && setShowInversions(!showInversions)}
                        disabled={practice.isActive}
                        className={`w-10 h-5 rounded-full relative transition-colors ${showInversions ? 'bg-indigo-500' : 'bg-slate-700'} ${practice.isActive ? 'opacity-50' : ''}`}
                    >
                        <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${showInversions ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Timer Control */}
                <div>
                    <label className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Timer</span>
                        <span className="text-sky-400 font-bold">{practice.timerSetting}s</span>
                    </label>
                    <input 
                    type="range" min="1" max="60" 
                    value={practice.timerSetting}
                    onChange={(e) => setPractice(p => ({...p, timerSetting: parseInt(e.target.value)}))}
                    disabled={practice.isActive}
                    className={`w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500 ${practice.isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                </div>

                {/* Range Filters */}
                <div className="flex flex-col gap-2">
                   {(['All', 'Triads', 'Sevenths'] as PracticeFilter[]).map((f) => (
                      <label key={f} className={`flex items-center space-x-3 cursor-pointer group ${practice.isActive ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <div className={`w-3 h-3 rounded-full border flex items-center justify-center transition-colors ${practiceFilter === f ? 'border-sky-500 bg-sky-500/20' : 'border-slate-600'}`}>
                           {practiceFilter === f && <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
                        </div>
                        <input 
                           type="radio" 
                           name="practiceFilter"
                           value={f}
                           checked={practiceFilter === f}
                           onChange={() => !practice.isActive && setPracticeFilter(f)}
                           disabled={practice.isActive}
                           className="hidden"
                        />
                        <span className={`text-xs transition-colors ${practiceFilter === f ? 'text-white' : 'text-slate-400'}`}>
                           {f === 'All' ? 'All Chords' : f === 'Triads' ? 'Major & Minor' : '7th Chords Only'}
                        </span>
                      </label>
                   ))}
                </div>

                {/* Start Button */}
                <button
                    onClick={togglePracticeMode}
                    className={`w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                        practice.isActive
                        ? 'bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20'
                        : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg hover:from-emerald-600 hover:to-emerald-700'
                    }`}
                >
                    {practice.isActive ? (
                        <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            Stop Practice
                        </>
                    ) : (
                        <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            Start Practice
                        </>
                    )}
                </button>
              </div>

              {/* Status & Feedback Panel */}
              <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 text-center flex flex-col items-center justify-center min-h-[200px] relative overflow-hidden">
                 
                 {/* IDLE MODE (Not Practicing) */}
                 {!practice.isActive && (
                    <>
                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Current Selection</div>
                        <div className="text-5xl font-bold text-sky-400 h-16 flex items-center justify-center tracking-tight">
                            {currentChord ? currentChord.displayName : '--'}
                        </div>
                        <div className="text-xs text-slate-600 mt-2">Select a chord to play</div>
                    </>
                 )}

                 {/* PRACTICE ACTIVE: LISTENING */}
                 {practice.isActive && !practice.revealed && (
                    <div className="flex flex-col items-center w-full animate-fade-in">
                        <div className="relative mb-4">
                            <div className="w-20 h-20 rounded-full border-4 border-sky-500/30 flex items-center justify-center animate-pulse">
                                <span className={`text-3xl font-mono font-bold ${practice.timer < 3 ? 'text-red-400' : 'text-sky-400'}`}>
                                    {practice.timer}
                                </span>
                            </div>
                        </div>
                        <div className="text-sm font-semibold text-slate-300 mb-2">Listening...</div>
                        {isScoreMode && (
                             <div className="flex gap-4 text-xs font-mono">
                                 <div className="text-emerald-400">Correct: {currentScore.correct}</div>
                                 <div className="text-red-400">Wrong: {currentScore.wrong}</div>
                             </div>
                        )}
                        
                        <button 
                            onClick={handleReplay}
                            className="mt-4 text-xs flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            Replay Sound
                        </button>

                        {/* Wrong Guess Feedback Shake */}
                        {feedbackStatus === 'wrong' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-20 animate-shake rounded-xl">
                                <div className="bg-red-500/20 text-red-400 border border-red-500/50 px-4 py-2 rounded-lg text-sm font-bold backdrop-blur-md">
                                    Not quite, try again! 😔
                                </div>
                            </div>
                        )}
                    </div>
                 )}

                 {/* PRACTICE ACTIVE: REVEALED (Result) */}
                 {practice.isActive && practice.revealed && (
                    <div className="flex flex-col items-center w-full animate-pop-in relative z-10">
                        {feedbackStatus === 'correct' && (
                            <>
                                {/* Confetti Particles (CSS only for simplicity) */}
                                <div className="absolute -top-10 left-10 confetti-piece bg-yellow-400" style={{ animationDelay: '0.1s', left: '20%' }}></div>
                                <div className="absolute -top-10 right-10 confetti-piece bg-sky-400" style={{ animationDelay: '0.3s', left: '80%' }}></div>
                                <div className="absolute -top-10 left-20 confetti-piece bg-pink-400" style={{ animationDelay: '0.0s', left: '40%' }}></div>
                                <div className="absolute -top-10 right-20 confetti-piece bg-emerald-400" style={{ animationDelay: '0.2s', left: '60%' }}></div>

                                <div className="text-emerald-400 mb-2 font-bold text-lg flex items-center gap-2">
                                    <span>Correct!</span>
                                    <span className="text-2xl">🎉</span>
                                </div>
                            </>
                        )}
                        
                        {feedbackStatus === 'timeout' && (
                             <div className="text-slate-400 mb-2 font-bold text-lg">Time's Up! ⏰</div>
                        )}

                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Answer</div>
                        <div className={`text-5xl font-bold mb-4 h-16 flex items-center justify-center tracking-tight ${feedbackStatus === 'correct' ? 'text-emerald-400' : 'text-slate-200'}`}>
                            {practice.targetChord?.displayName}
                        </div>

                         {isScoreMode && (
                             <div className="flex gap-4 text-xs font-mono mb-4">
                                 <div className="text-emerald-400">Correct: {currentScore.correct}</div>
                                 <div className="text-red-400">Wrong: {currentScore.wrong}</div>
                             </div>
                        )}

                        <button 
                            onClick={startPracticeRound}
                            className="w-full bg-sky-600 hover:bg-sky-500 text-white py-2 rounded-lg shadow-lg text-sm font-bold transition-transform active:scale-95 flex items-center justify-center gap-2"
                        >
                            Next Round
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                        </button>
                    </div>
                 )}
              </div>

              {/* History List */}
              {history.length > 0 && (
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                      <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-bold text-slate-400 uppercase">Session History</h3>
                          <button onClick={() => {setHistory([]); localStorage.removeItem('chordMasterHistory');}} className="text-[10px] text-red-400 hover:underline">Clear</button>
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                          {history.map((entry) => (
                              <div key={entry.id} className={`p-2 rounded border text-xs flex justify-between items-center ${entry.id === bestRecordId ? 'bg-amber-500/10 border-amber-500/50' : 'bg-slate-800 border-slate-700'}`}>
                                  <div>
                                      <div className="text-slate-300 font-semibold flex items-center gap-1">
                                          {entry.isScored && entry.id === bestRecordId && <span>🏆 </span>}
                                          {new Date(entry.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                      </div>
                                      <div className="text-[10px] text-slate-500">{entry.mode} • {entry.durationSeconds}s</div>
                                  </div>
                                  <div className="text-right">
                                      <div className={`font-bold ${entry.accuracy >= 80 ? 'text-emerald-400' : entry.accuracy >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                                          {entry.accuracy}%
                                      </div>
                                      <div className="text-[10px] text-slate-500">{entry.correctCount}/{entry.totalAttempts}</div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              )}
           </div>

           {/* Chord Selector Grid */}
           <div className="lg:col-span-3 bg-slate-900 p-4 rounded-xl border border-slate-800 max-h-[600px] overflow-y-auto chord-grid order-1 lg:order-2">
              <div className="space-y-6">
                {CHORD_GROUPS.map((group) => {
                    // Filter chords for display based on showInversions toggle
                    const chordsToDisplay = group.chords.filter(c => showInversions ? true : c.inversion === 0);
                    if (chordsToDisplay.length === 0) return null;

                    return (
                        <div key={group.root} className="space-y-2">
                            {/* Root Header */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{group.root} Chords</span>
                                <div className="h-px bg-slate-800 flex-grow"></div>
                            </div>
                            {/* Chord Buttons */}
                            <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                                {chordsToDisplay.map((chord) => {
                                    const isCurrent = currentChord?.displayName === chord.displayName;
                                    const isPressed = pressedChordName === chord.displayName;
                                    
                                    return (
                                    <button
                                        key={chord.displayName}
                                        onPointerDown={(e) => {
                                            e.preventDefault(); 
                                            handleChordPress(chord);
                                        }}
                                        onPointerUp={handleChordRelease}
                                        onPointerLeave={handleChordRelease}
                                        onPointerCancel={handleChordRelease}
                                        disabled={practice.isActive && practice.revealed}
                                        className={`
                                            relative px-1 py-2 rounded-md text-sm font-bold border transition-all duration-75 select-none touch-none break-all flex items-center justify-center
                                            ${(isPressed || isCurrent)
                                                ? 'bg-sky-600 border-sky-400 text-white scale-95 ring-2 ring-sky-900 z-10' 
                                                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:border-slate-500'
                                            }
                                            ${(practice.isActive && practice.revealed && practice.targetChord?.displayName === chord.displayName)
                                                ? '!bg-emerald-600 !border-emerald-400 !text-white ring-2 ring-emerald-500 animate-pulse'
                                                : ''
                                            }
                                            ${chord.inversion > 0 ? 'text-[11px] bg-slate-800/50' : ''}
                                        `}
                                    >
                                        {chord.displayName}
                                    </button>
                                )})}
                            </div>
                        </div>
                    );
                })}
              </div>
           </div>
        </div>

      </main>
    </div>
  );
};

export default App;