import { InstrumentType, PianoTimbre } from '../types';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private activeNodes: { stop: (t: number) => void, release: (t: number) => void }[] = [];

  constructor() {
    // Lazy initialization
  }

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3; // Lower default gain to prevent clipping with chords

      // Reverb Setup (Convolver)
      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this.generateReverbImpulse(2.0, 2.0); // 2 seconds reverb
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.35; // 35% Wet Mix

      // Routing:
      // Sources -> MasterGain -> Destination (Dry)
      // Sources -> MasterGain -> ReverbGain -> ReverbNode -> Destination (Wet)
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.connect(this.reverbGain);
      this.reverbGain.connect(this.reverbNode);
      this.reverbNode.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Generate a simple noise burst impulse response for reverb
  private generateReverbImpulse(duration: number, decay: number): AudioBuffer {
    const rate = this.ctx!.sampleRate;
    const length = rate * duration;
    const impulse = this.ctx!.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        // Exponential decay noise
        const n = i / length;
        const vol = Math.pow(1 - n, decay);
        left[i] = (Math.random() * 2 - 1) * vol;
        right[i] = (Math.random() * 2 - 1) * vol;
    }
    return impulse;
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
      // Stagger start times slightly for strummed instruments to sound more natural
      const stagger = instrument === InstrumentType.Piano ? 0 : index * 0.04;
      const startTime = now + stagger;

      const voiceGain = this.ctx!.createGain();
      voiceGain.connect(this.masterGain!);

      // List of oscillators/nodes for this single note to stop later
      const noteOscillators: OscillatorNode[] = [];
      let stopFunc: (t: number) => void;
      let releaseFunc: (t: number) => void;

      // Instrument specific Synthesis
      if (instrument === InstrumentType.Piano) {
          // --- PIANO SYNTHESIS ---
          
          if (timbre === 'Electric') {
            // Electric: Sine + Triangle mix + Tremolo
            const osc1 = this.ctx!.createOscillator();
            osc1.type = 'sine';
            osc1.frequency.value = freq;

            const osc2 = this.ctx!.createOscillator();
            osc2.type = 'triangle';
            osc2.frequency.value = freq;
            
            // Mix: Sine (Fundamental) dominant, Triangle adds color
            const osc1Gain = this.ctx!.createGain();
            osc1Gain.gain.value = 0.8;
            const osc2Gain = this.ctx!.createGain();
            osc2Gain.gain.value = 0.3;

            osc1.connect(osc1Gain);
            osc2.connect(osc2Gain);
            osc1Gain.connect(voiceGain);
            osc2Gain.connect(voiceGain);

            // Tremolo (LFO on gain)
            const lfo = this.ctx!.createOscillator();
            lfo.frequency.value = 5; // 5Hz wobble
            const lfoGain = this.ctx!.createGain();
            lfoGain.gain.value = 0.15; // Depth
            // Connect LFO to voice gain: base gain is controlled by envelope, LFO modulates it
            // Actually, simplest is to put another gain node in chain
            const tremoloNode = this.ctx!.createGain();
            tremoloNode.gain.value = 1.0;
            lfo.connect(lfoGain);
            lfoGain.connect(tremoloNode.gain);
            
            osc1Gain.disconnect();
            osc2Gain.disconnect();
            osc1Gain.connect(tremoloNode);
            osc2Gain.connect(tremoloNode);
            tremoloNode.connect(voiceGain);

            lfo.start(startTime);
            osc1.start(startTime);
            osc2.start(startTime);
            noteOscillators.push(osc1, osc2, lfo);

            // Soft Envelope
            voiceGain.gain.setValueAtTime(0, startTime);
            voiceGain.gain.linearRampToValueAtTime(0.6, startTime + 0.05);
            voiceGain.gain.exponentialRampToValueAtTime(0.4, startTime + 1.0);

          } else if (timbre === 'HonkyTonk') {
            // Honky Tonk: 2 Detuned Sawtooths
            const osc1 = this.ctx!.createOscillator();
            osc1.type = 'sawtooth';
            osc1.frequency.value = freq;
            
            const osc2 = this.ctx!.createOscillator();
            osc2.type = 'sawtooth';
            osc2.frequency.value = freq;
            osc2.detune.value = 15; // Significant detune

            const filter = this.ctx!.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = freq * 3;

            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(voiceGain);

            osc1.start(startTime);
            osc2.start(startTime);
            noteOscillators.push(osc1, osc2);

            // Percussive Envelope
            voiceGain.gain.setValueAtTime(0, startTime);
            voiceGain.gain.linearRampToValueAtTime(0.5, startTime + 0.02);
            voiceGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.8);

          } else {
            // --- GRAND PIANO (New & Improved) ---
            // 2 Triangle Oscillators (Detuned for chorus) + 1 Sine (Body)
            
            const osc1 = this.ctx!.createOscillator();
            osc1.type = 'triangle';
            osc1.frequency.value = freq;

            const osc2 = this.ctx!.createOscillator();
            osc2.type = 'triangle';
            osc2.frequency.value = freq;
            osc2.detune.value = 6; // Slight detune for realism

            const osc3 = this.ctx!.createOscillator();
            osc3.type = 'sine';
            osc3.frequency.value = freq; // Pure fundamental

            // Filter (Lowpass) - Key tracked
            const filter = this.ctx!.createBiquadFilter();
            filter.type = 'lowpass';
            // Cutoff starts bright and decays
            filter.frequency.setValueAtTime(freq * 6, startTime); 
            filter.frequency.exponentialRampToValueAtTime(freq * 1.5, startTime + 0.5);

            // Oscillator Mix
            const mainOscGain = this.ctx!.createGain();
            mainOscGain.gain.value = 0.6;
            
            const subOscGain = this.ctx!.createGain();
            subOscGain.gain.value = 0.4; // Sine body

            osc1.connect(mainOscGain);
            osc2.connect(mainOscGain);
            osc3.connect(subOscGain);

            mainOscGain.connect(filter);
            subOscGain.connect(voiceGain); // Sine bypasses filter for clean low end
            filter.connect(voiceGain);

            osc1.start(startTime);
            osc2.start(startTime);
            osc3.start(startTime);
            noteOscillators.push(osc1, osc2, osc3);

            // Amplitude Envelope
            voiceGain.gain.setValueAtTime(0, startTime);
            // Sharp Attack
            voiceGain.gain.linearRampToValueAtTime(0.7, startTime + 0.02); 
            // Decay to Sustain
            voiceGain.gain.exponentialRampToValueAtTime(0.4, startTime + 0.3);
            // Long subtle fade out (Piano strings don't sustain forever)
            voiceGain.gain.exponentialRampToValueAtTime(0.01, startTime + 4.0);
          }

      } else if (instrument === InstrumentType.Guitar) {
          // Guitar
          const osc = this.ctx!.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = freq;

          const filter = this.ctx!.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(3000, startTime);
          filter.frequency.exponentialRampToValueAtTime(500, startTime + 0.5); // "Pluck" damping

          osc.connect(filter);
          filter.connect(voiceGain);
          osc.start(startTime);
          noteOscillators.push(osc);

          voiceGain.gain.setValueAtTime(0, startTime);
          voiceGain.gain.linearRampToValueAtTime(0.6, startTime + 0.04);
          voiceGain.gain.exponentialRampToValueAtTime(0.1, startTime + 2.0);

      } else {
          // Violin
          const osc = this.ctx!.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = freq;

          // Vibrato
          const lfo = this.ctx!.createOscillator();
          lfo.frequency.value = 6.0; // Hz
          const lfoGain = this.ctx!.createGain();
          lfoGain.gain.value = 5.0; // Depth
          lfo.connect(lfoGain);
          lfoGain.connect(osc.frequency);
          lfo.start(startTime);

          const filter = this.ctx!.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.value = 1500; // Formant-ish
          filter.Q.value = 0.5;

          // Mix dry saw + filtered saw for body
          const sawGain = this.ctx!.createGain();
          sawGain.gain.value = 0.4;
          osc.connect(sawGain);
          sawGain.connect(voiceGain);

          osc.connect(filter);
          filter.connect(voiceGain);
          
          osc.start(startTime);
          noteOscillators.push(osc, lfo);

          // Bowing Envelope (Swell)
          voiceGain.gain.setValueAtTime(0, startTime);
          voiceGain.gain.linearRampToValueAtTime(0.6, startTime + 0.4);
      }

      // Cleanup Handlers
      stop