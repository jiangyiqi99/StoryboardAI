export interface PreviewClockSnapshot {
  time: number;
  isPlaying: boolean;
}

type PreviewClockListener = (snapshot: PreviewClockSnapshot) => void;

/**
 * Playback is visual, transient state. Keeping it outside EditorContext means
 * a 30fps preview does not re-render the whole editor or mark the project
 * dirty. Consumers that only need a visual playhead can update a DOM ref.
 */
class PreviewClock {
  private snapshot: PreviewClockSnapshot = { time: 0, isPlaying: false };
  private readonly listeners = new Set<PreviewClockListener>();

  getSnapshot = (): PreviewClockSnapshot => this.snapshot;

  subscribe = (listener: PreviewClockListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(time: number): void {
    this.update({ time, isPlaying: true });
  }

  advance(time: number): void {
    if (!this.snapshot.isPlaying) return;
    this.update({ time, isPlaying: true });
  }

  pause(time: number): void {
    this.update({ time, isPlaying: false });
  }

  seek(time: number): void {
    this.update({ time, isPlaying: this.snapshot.isPlaying });
  }

  private update(next: PreviewClockSnapshot): void {
    if (next.time === this.snapshot.time && next.isPlaying === this.snapshot.isPlaying) {
      return;
    }
    this.snapshot = next;
    this.listeners.forEach((listener) => listener(next));
  }
}

export const previewClock = new PreviewClock();
