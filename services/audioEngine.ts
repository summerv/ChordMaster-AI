import { InstrumentType, PianoTimbre } from '../types';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeNodes: { stop: (t: number) => void, release: (t: number) => void }[] = [];

  constructor() {
    // Lazy initialization
  }

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.4;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  public startChord(midiNotes: number[], instrument: InstrumentType, timbre: PianoTimbre = 'Grand') {
    this.init();
    this.stopChord(); // Stop previous notes
    
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    midiNotes.forEach((note, index) => {
      const freq = this.midiToFreq(note);
      // Stagger start times slightly for strummed instruments
      const stagger = instrument === InstrumentType.Piano ? 0 : index * 0.03;
      const startTime = now + stagger;

      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      
      // Default wiring, can be overridden by specific instruments
      let lastNode: AudioNode = osc;

      osc.frequency.value = freq;

      // Instrument specific tone
      switch (instrument) {
        case InstrumentType.Piano:
          if (timbre === 'Electric') {
            // Electric Piano: Sine wave with softer, rounder tone
            osc.type = 'sine';
            
            // Gain Envelope
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.6, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.3, startTime + 1.5);
            
            osc.connect(gain);
          } else if (timbre === 'HonkyTonk') {
            // Honky Tonk: Detuned Sawtooth/Triangle mix (Simulated with Saw here)
            osc.type = 'sawtooth';
            // Slight detune for that "bar piano" feel
            osc.detune.value = (Math.random() * 10) - 5;

            // Lowpass filter to take the edge off the saw
            const filter = this.ctx!.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = freq * 3;
            
            osc.connect(filter);
            filter.connect(gain);

            // Perussive envelope
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.5, startTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.6); // Short decay
          } else {
            // Grand Piano (Default)
            // Triangle wave + Dynamic Lowpass Filter
            osc.type = 'triangle';
            
            const filter = this.ctx!.createBiquadFilter();
            filter.type = 'lowpass';
            // Filter opens up on attack and closes quickly
            filter.frequency.setValueAtTime(freq * 1, startTime);
            filter.frequency.exponentialRampToValueAtTime(freq * 6, startTime + 0.02); // Attack
            filter.frequency.exponentialRampToValueAtTime(freq * 2, startTime + 0.5); // Decay
            
            osc.connect(filter);
            filter.connect(gain);

            // Amplitude Envelope
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.8, startTime + 0.015);
            // Long sustain simulation
            gain.gain.exponentialRampToValueAtTime(0.1, startTime + 3.0);
          }
          break;

        case InstrumentType.Guitar:
          osc.type = 'sawtooth';
          // Filter for guitar pluck
          const gFilter = this.ctx!.createBiquadFilter();
          gFilter.type = 'lowpass';
          gFilter.frequency.setValueAtTime(3000, startTime);
          gFilter.frequency.exponentialRampToValueAtTime(500, startTime + 1.0);
          
          osc.connect(gFilter);
          gFilter.connect(gain);

          // Guitar Attack
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(0.8, startTime + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.3, startTime + 2.0);
          break;

        case InstrumentType.Violin:
          osc.type = 'sawtooth';
          // Vibrato
          const lfo = this.ctx!.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.value = 6;
          const lfoGain = this.ctx!.createGain();
          lfoGain.gain.value = 4;
          lfo.connect(lfoGain);
          lfoGain.connect(osc.frequency);
          lfo.start(startTime);
          
          osc.connect(gain);
          
          // Violin Attack (Swell)
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(0.7, startTime + 0.5);
          
          // Store LFO cleanup
          this.activeNodes.push({
            stop: (t) => { lfo.stop(t); },
            release: () => {}
          });
          break;
      }

      gain.connect(this.masterGain!);
      osc.start(startTime);

      // Register for cleanup
      this.activeNodes.push({
        stop: (t) => osc.stop(t),
        release: (t) => {
           // Release Envelope
           gain.gain.cancelScheduledValues(t);
           gain.gain.setValueAtTime(gain.gain.value, t); // Current value
           gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3); // Quick fade out
           osc.stop(t + 0.35);
        }
      });
    });
  }

  public stopChord() {
    if (!this.ctx || this.activeNodes.length === 0) return;
    const now = this.ctx.currentTime;
    
    // Trigger release envelope for all active notes
    this.activeNodes.forEach(node => node.release(now));
    
    // Clear list (audio nodes will garbage collect after stop)
    this.activeNodes = [];
  }

  // Legacy/One-shot wrapper for non-interactive playback
  public playNotes(midiNotes: number[], instrument: InstrumentType, timbre: PianoTimbre = 'Grand') {
    this.startChord(midiNotes, instrument, timbre);
    // Auto-release after a fixed duration if it's a "tap" or system event
    setTimeout(() => {
      this.stopChord();
    }, 1200);
  }
}

export const audioEngine = new AudioEngine();