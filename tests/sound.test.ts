import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSound } from '../web/play/sound';
import { createGame } from '../engine/simulation';
import { replay } from './forge-helpers';

class AudioStub {
  static latest: AudioStub;
  currentTime = 0; state = 'suspended'; created = 0; destination = {};
  constructor() { AudioStub.latest = this; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  createOscillator() { this.created++; return { type:'sine', frequency:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){}, disconnect(){}, start(){}, stop(){}, onended: null }; }
  createGain() { return { gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){} }; }
}
afterEach(() => vi.unstubAllGlobals());
describe('optional original sound', () => {
  it('starts muted, schedules no sound while muted, and bounds concurrent voices', async () => {
    vi.stubGlobal('AudioContext', AudioStub); vi.stubGlobal('localStorage', {getItem:()=>null,setItem:()=>{}});
    const sound = new GameSound(), game = createGame(replay.spec);
    await sound.unlock(); expect(AudioStub.latest).toBeUndefined();
    await sound.toggle(); const context = AudioStub.latest; expect(sound.enabled).toBe(true);
    game.events = [{kind:'hit',x:0,y:0,text:''},{kind:'bossHit',x:0,y:0,text:''}];
    for(let i=0;i<30;i++){context.currentTime+=0.1;sound.consume(game);}
    expect(context.created).toBeLessThanOrEqual(12);
    await sound.toggle(); const before = context.created; sound.consume(game); expect(context.created).toBe(before); expect(context.state).toBe('suspended'); sound.close();
  });
});
