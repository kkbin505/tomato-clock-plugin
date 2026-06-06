export type PhaseType = 'work' | 'shortBreak' | 'longBreak' | 'idle';

export interface TomatoTimerSettings {
    workMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    cycles: number;
    autoStartNextPhase: boolean;
}

export interface TimerState {
    phase: PhaseType;
    reps: number;
    remainingSeconds: number;
    isRunning: boolean;
    completedTomatos: number;
}

export type TimerTickCallback = (state: TimerState) => void;
export type PhaseCompleteCallback = (completed: PhaseType, next: PhaseType) => void;

export class TomatoTimer {
    private settings: TomatoTimerSettings;
    private reps = 0;
    private isRunning = false;
    private intervalId: number | null = null;
    private completedTomatos = 0;
    private startTime: number = 0;       // Date.now() at last start/resume
    private accumulatedMs: number = 0;   // ms consumed before last pause

    private onTickCb: TimerTickCallback | null = null;
    private onPhaseCb: PhaseCompleteCallback | null = null;

    constructor(settings: TomatoTimerSettings) {
        this.settings = settings;
    }

    updateSettings(settings: TomatoTimerSettings): void {
        this.settings = settings;
    }

    onTick(cb: TimerTickCallback): void { this.onTickCb = cb; }
    onPhaseComplete(cb: PhaseCompleteCallback): void { this.onPhaseCb = cb; }

    // Mirrors Python start_timer(): reps drives phase selection
    start(): void {
        if (this.isRunning) return;
        this.reps += 1;
        this.isRunning = true;
        this.accumulatedMs = 0;
        this.startTime = Date.now();
        this.startInterval();
        this.notifyTick();
    }

    pause(): void {
        if (!this.isRunning) return;
        this.accumulatedMs += Date.now() - this.startTime;
        this.isRunning = false;
        this.stopInterval();
        this.notifyTick();
    }

    resume(): void {
        if (this.isRunning || this.getRemainingMs() <= 0 || this.reps === 0) return;
        this.isRunning = true;
        this.startTime = Date.now();
        this.startInterval();
        this.notifyTick();
    }

    reset(): void {
        this.stopInterval();
        this.reps = 0;
        this.isRunning = false;
        this.accumulatedMs = 0;
        this.startTime = 0;
        this.notifyTick();
    }

    destroy(): void {
        this.stopInterval();
        this.onTickCb = null;
        this.onPhaseCb = null;
    }

    skip(): void {
        if (this.reps === 0) return;
        this.stopInterval();
        const done = this.currentPhase();
        this.isRunning = false;
        this.handleEnd(done);
    }

    getState(): TimerState {
        return {
            phase: this.reps === 0 ? 'idle' : this.currentPhase(),
            reps: this.reps,
            remainingSeconds: Math.floor(this.getRemainingMs() / 1000),
            isRunning: this.isRunning,
            completedTomatos: this.completedTomatos,
        };
    }

    private getRemainingMs(): number {
        const elapsed = this.isRunning ? (Date.now() - this.startTime) : 0;
        const total = this.phaseDuration(this.currentPhase()) * 1000;
        return Math.max(0, total - this.accumulatedMs - elapsed);
    }

    // reps % (cycles*2) === 0 → longBreak; reps % 2 === 0 → shortBreak; else → work
    private currentPhase(): PhaseType {
        if (this.reps === 0) return 'idle';
        if (this.reps % (this.settings.cycles * 2) === 0) return 'longBreak';
        if (this.reps % 2 === 0) return 'shortBreak';
        return 'work';
    }

    private nextPhase(): PhaseType {
        const n = this.reps + 1;
        if (n % (this.settings.cycles * 2) === 0) return 'longBreak';
        if (n % 2 === 0) return 'shortBreak';
        return 'work';
    }

    private phaseDuration(phase: PhaseType): number {
        switch (phase) {
            case 'work':       return this.settings.workMinutes * 60;
            case 'shortBreak': return this.settings.shortBreakMinutes * 60;
            case 'longBreak':  return this.settings.longBreakMinutes * 60;
            default:           return 0;
        }
    }

    private startInterval(): void {
        this.stopInterval();
        this.intervalId = window.setInterval(() => this.tick(), 1000);
    }

    private stopInterval(): void {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    private tick(): void {
        if (this.getRemainingMs() <= 0) {
            const done = this.currentPhase();
            this.stopInterval();
            this.isRunning = false;
            if (done === 'work') this.completedTomatos += 1;
            this.notifyTick();
            this.handleEnd(done);
        } else {
            this.notifyTick();
        }
    }

    private handleEnd(done: PhaseType): void {
        const next = this.nextPhase();
        this.onPhaseCb?.(done, next);
        if (this.settings.autoStartNextPhase) {
            this.start();
        }
    }

    private notifyTick(): void {
        this.onTickCb?.(this.getState());
    }
}
