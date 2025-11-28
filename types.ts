export enum InstrumentType {
  Piano = 'Piano',
  Guitar = 'Guitar',
  Violin = 'Violin',
}

export type PianoTimbre = 'Grand' | 'Electric' | 'HonkyTonk';

export type PracticeFilter = 'All' | 'Triads' | 'Sevenths';

export enum ChordQuality {
  Major = 'Major',
  Minor = 'Minor',
  Dominant7 = '7',
  Major7 = 'Maj7',
  Minor7 = 'Min7',
}

export interface Note {
  name: string;
  midi: number;
  frequency: number;
}

export interface Chord {
  root: string;
  quality: ChordQuality;
  displayName: string;
  intervals: number[]; // Semitones from root
}

export interface FretPosition {
  stringIndex: number; // 0 is bottom-most visually (lowest pitch usually, but depends on tuning)
  fret: number;
  note: string;
}

export interface PracticeSession {
  isActive: boolean;
  targetChord: Chord | null;
  revealed: boolean;
  timer: number;
  timerSetting: number;
  hasMadeMistake: boolean;
}

export interface HistoryEntry {
  id: string;
  timestamp: number; // Date.now()
  durationSeconds: number; // How long the session lasted
  mode: PracticeFilter;
  isScored: boolean;
  correctCount: number;
  totalAttempts: number;
  accuracy: number; // 0-100
}