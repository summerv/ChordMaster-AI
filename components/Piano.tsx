import React, { useRef, useEffect } from 'react';

interface PianoProps {
  activeNotes: number[]; // MIDI numbers
  onNoteStart: (midi: number) => void;
  onNoteStop: () => void;
}

const Piano: React.FC<PianoProps> = ({ activeNotes, onNoteStart, onNoteStop }) => {
  // Expanded Range: C3 (48) to C6 (84) -> 3 Octaves
  const startNote = 48; 
  const endNote = 84; 
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const keys = [];

  const isBlackKey = (n: number) => {
    const i = n % 12;
    return i === 1 || i === 3 || i === 6 || i === 8 || i === 10;
  };

  for (let i = startNote; i <= endNote; i++) {
    keys.push({ midi: i, black: isBlackKey(i), isActive: activeNotes.includes(i) });
  }

  const whiteKeys = keys.filter(k => !k.black);
  const blackKeys = keys.filter(k => k.black);

  // Auto-scroll to middle or active notes on mount
  useEffect(() => {
    if (scrollContainerRef.current) {
        // Center the view initially (around C4/C5)
        const middle = scrollContainerRef.current.scrollWidth / 2 - scrollContainerRef.current.clientWidth / 2;
        scrollContainerRef.current.scrollLeft = middle;
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent, midi: number) => {
      e.preventDefault();
      onNoteStart(midi);
  };

  const handlePointerUpOrLeave = (e: React.PointerEvent) => {
      e.preventDefault();
      onNoteStop();
  };

  return (
    <div className="w-full bg-slate-900 rounded-lg shadow-xl border-t-8 border-slate-800 relative select-none">
      <div 
        ref={scrollContainerRef}
        className="overflow-x-auto overflow-y-hidden pb-2 scroll-smooth custom-scrollbar"
        style={{ cursor: 'grab' }}
      >
        <div className="relative h-48 min-w-max mx-auto px-4">
            <div className="flex h-full">
                {whiteKeys.map((key) => (
                <div
                    key={key.midi}
                    onPointerDown={(e) => handlePointerDown(e, key.midi)}
                    onPointerUp={handlePointerUpOrLeave}
                    onPointerLeave={handlePointerUpOrLeave}
                    className={`
                        w-12 border-r border-slate-300 h-full transition-colors duration-75 ease-out shrink-0 cursor-pointer
                        ${key.isActive ? 'bg-sky-400 !border-sky-500 shadow-[0_0_15px_rgba(56,189,248,0.5)] z-0' : 'bg-white hover:bg-slate-100 active:bg-slate-200'}
                        last:border-r-0 rounded-b-sm relative
                        flex items-end justify-center pb-2
                    `}
                >
                    {/* Note Label for C keys */}
                    {key.midi % 12 === 0 && (
                        <span className="text-slate-400 text-xs font-bold pointer-events-none">C{key.midi / 12 - 1}</span>
                    )}
                </div>
                ))}
            </div>
            
            {/* Black Keys Layer */}
            {blackKeys.map((key) => {
                // Calculate position relative to the sequence of white keys
                // We need to find the index of the white key just BEFORE this black key
                const whiteIndex = whiteKeys.findIndex(wk => wk.midi === key.midi - 1);
                // Each white key is w-12 (3rem). Black key sits between index and index+1.
                // Left = (index + 1) * w - (w_black / 2)
                // Using rem to match tailwind w-12 (3rem)
                const leftPos = (whiteIndex + 1) * 3 - 1; // 3rem per key, 2rem black key width -> -1rem offset

                return (
                    <div
                        key={key.midi}
                        onPointerDown={(e) => handlePointerDown(e, key.midi)}
                        onPointerUp={handlePointerUpOrLeave}
                        onPointerLeave={handlePointerUpOrLeave}
                        style={{ left: `${leftPos}rem` }}
                        className={`
                            absolute top-0 w-8 h-32 border border-slate-900 rounded-b-md z-10 transition-colors duration-75 cursor-pointer
                            ${key.isActive ? 'bg-sky-600 shadow-[0_0_15px_rgba(56,189,248,0.6)]' : 'bg-slate-800 bg-gradient-to-b from-black to-slate-800 hover:from-slate-700 active:from-slate-600'}
                        `}
                    />
                );
            })}
        </div>
      </div>
      <div className="absolute bottom-1 right-2 text-[10px] text-slate-500 pointer-events-none">
         Drag to scroll | Click keys to play
      </div>
    </div>
  );
};

export default Piano;