import React, { useMemo } from 'react';
import { InstrumentType } from '../types';

interface StringInstrumentProps {
  type: InstrumentType.Guitar | InstrumentType.Violin;
  activeNotes: number[]; // MIDI numbers
}

const StringInstrument: React.FC<StringInstrumentProps> = ({ type, activeNotes }) => {
  // Tuning
  // Guitar: E2(40) A2(45) D3(50) G3(55) B3(59) E4(64)
  // Violin: G3(55) D4(62) A4(69) E5(76)
  const stringBaseNotes = useMemo(() => {
    return type === InstrumentType.Guitar 
      ? [64, 59, 55, 50, 45, 40] // Top to bottom visually (high pitch to low pitch)
      : [76, 69, 62, 55]; 
  }, [type]);

  const frets = type === InstrumentType.Guitar ? 12 : 10; // Violin doesn't have frets but we visualize positions
  
  // Calculate positions of active notes
  const positions = useMemo(() => {
    const pos: { stringIdx: number; fret: number }[] = [];
    
    // Naive algorithm to find best position for note
    activeNotes.forEach(noteMidi => {
      // Try to find on strings
      for (let s = 0; s < stringBaseNotes.length; s++) {
        const base = stringBaseNotes[s];
        const fret = noteMidi - base;
        if (fret >= 0 && fret <= frets) {
          pos.push({ stringIdx: s, fret });
          // Break here to only show one position per note (simplified for visualization)
          // In reality, notes can be played in multiple places. 
          // We prefer lower strings (higher index in our array usually) or first position.
          break;
        }
      }
    });
    return pos;
  }, [activeNotes, stringBaseNotes, frets]);

  return (
    <div className="w-full h-48 bg-slate-900 rounded-lg p-4 shadow-xl flex flex-col justify-center relative overflow-hidden">
        {/* Wood Texture / Background */}
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-amber-900 via-stone-900 to-black pointer-events-none"></div>

        <div className="relative z-10 flex flex-col h-full justify-between py-2">
            {/* Frets (Vertical Lines) */}
            <div className="absolute inset-0 flex">
                <div className="w-12 border-r-4 border-stone-400 bg-stone-800"></div> {/* Nut */}
                {Array.from({ length: frets }).map((_, i) => (
                    <div key={i} className="flex-1 border-r border-stone-600 relative flex justify-center">
                       {/* Fret Markers */}
                       {(type === InstrumentType.Guitar && [3, 5, 7, 9].includes(i + 1)) && (
                           <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-stone-700/50"></div>
                       )}
                       {(type === InstrumentType.Guitar && i + 1 === 12) && (
                           <div className="absolute top-1/2 -translate-y-1/2 flex gap-1">
                               <div className="w-3 h-3 rounded-full bg-stone-700/50"></div>
                               <div className="w-3 h-3 rounded-full bg-stone-700/50"></div>
                           </div>
                       )}
                    </div>
                ))}
            </div>

            {/* Strings (Horizontal Lines) */}
            {stringBaseNotes.map((_, i) => (
                <div key={i} className="relative w-full h-px bg-yellow-100/50 shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                     {/* Active Notes (Dots) */}
                     {positions.filter(p => p.stringIdx === i).map((p, pIdx) => (
                        <div 
                            key={pIdx}
                            className={`absolute w-5 h-5 rounded-full bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.8)] border-2 border-white -top-2.5 z-20 flex items-center justify-center`}
                            style={{ 
                                left: p.fret === 0 
                                    ? '1.5rem' // At Nut
                                    : `calc(3rem + ${(p.fret - 1) * (100 - 5) / frets}%)` // Approximate fret spacing linear for simplicity
                            }}
                        >
                            <div className="w-1.5 h-1.5 bg-white rounded-full" />
                        </div>
                     ))}
                </div>
            ))}
        </div>
    </div>
  );
};

export default StringInstrument;