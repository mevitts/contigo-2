/**
 * Detects if the current browser is iOS Safari
 * @returns true if running on iOS Safari, false otherwise
 */
export function isIOSSafari(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(userAgent);
  const isSafari = /safari/.test(userAgent) && !/chrome|crios|fxios/.test(userAgent);
  
  return isIOS || (isSafari && 'standalone' in navigator);
}

/**
 * Unlocks audio playback on iOS by playing a silent audio buffer
 * Must be called within a user gesture event
 */
export async function unlockIOSAudio(audioContext: AudioContext): Promise<void> {
  if (!isIOSSafari()) {
    return;
  }

  try {
    // Resume the audio context if suspended
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Play a silent buffer to unlock audio
    const AUDIO_UNLOCK_SAMPLE_RATE = 22050;
    const buffer = audioContext.createBuffer(1, 1, AUDIO_UNLOCK_SAMPLE_RATE);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
  } catch (error) {
    console.warn('Failed to unlock iOS audio:', error);
  }
}
