import { ItemView, MarkdownRenderer, WorkspaceLeaf } from 'obsidian';
import type TomatoPlugin from './main';
import type { TimerState, PhaseType } from './timer';
import { parseLogs, totalTomatos, last7Days, todayString } from './log';

export const VIEW_TYPE_Tomato = 'Tomato-timer-view';

export class TomatoTimerView extends ItemView {
    private plugin: TomatoPlugin;

    private timerDisplayEl!: HTMLElement;
    private statusTextEl!: HTMLElement;
    private phaseDotEls: HTMLElement[] = [];
    private startPauseBtn!: HTMLButtonElement;
    private skipBtn!: HTMLButtonElement;
    private historyEl!: HTMLElement;
    private completedCountEl!: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: TomatoPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_Tomato; }
    getDisplayText(): string { return 'Tomato'; }
    getIcon(): string { return 'timer'; }

    async onOpen(): Promise<void> {
        this.buildUI();
        // main.ts drives updates via forEachView — no separate onTick needed here
        this.updateTimerUI(this.plugin.timer.getState());
        await this.refreshHistory();
    }

    async onClose(): Promise<void> {
        // Timer keeps running; main.ts continues handling ticks
    }

    private buildUI(): void {
        const root = this.contentEl;
        root.empty();
        root.addClass('Tomato-container');

        // Header: icon + title + cumulative count
        const header = root.createDiv({ cls: 'Tomato-header' });
        header.createDiv({ cls: 'Tomato-icon', text: '🍅' });
        const titleRow = header.createDiv({ cls: 'Tomato-title-row' });
        titleRow.createSpan({ text: 'Tomato' });
        this.completedCountEl = titleRow.createSpan({ cls: 'Tomato-count' });

        // Progress dots (one per cycle slot)
        const dotsEl = root.createDiv({ cls: 'Tomato-dots' });
        this.phaseDotEls = [];
        for (let i = 0; i < this.plugin.settings.cycles; i++) {
            this.phaseDotEls.push(dotsEl.createDiv({ cls: 'Tomato-dot' }));
        }

        // Timer display
        const timerArea = root.createDiv({ cls: 'Tomato-timer-area' });
        this.timerDisplayEl = timerArea.createDiv({ cls: 'Tomato-timer-display', text: '--' });
        this.statusTextEl = timerArea.createDiv({ cls: 'Tomato-status-text', text: 'Ready' });

        // Controls
        const controls = root.createDiv({ cls: 'Tomato-controls' });

        this.startPauseBtn = controls.createEl('button', {
            cls: 'Tomato-btn Tomato-btn-primary',
            text: 'Start',
        });
        this.registerDomEvent(this.startPauseBtn, 'click', () => this.onStartPause());

        this.skipBtn = controls.createEl('button', {
            cls: 'Tomato-btn Tomato-btn-secondary',
            text: 'Skip',
        });
        this.skipBtn.disabled = true;
        this.registerDomEvent(this.skipBtn, 'click', () => this.plugin.timer.skip());

        const resetBtn = controls.createEl('button', {
            cls: 'Tomato-btn Tomato-btn-danger',
            text: 'Reset',
        });
        this.registerDomEvent(resetBtn, 'click', () => this.plugin.timer.reset());

        // History section
        this.historyEl = root.createDiv({ cls: 'Tomato-history' });
    }

    private onStartPause(): void {
        const s = this.plugin.timer.getState();
        if (s.phase === 'idle') this.plugin.timer.start();
        else if (s.isRunning) this.plugin.timer.pause();
        else this.plugin.timer.resume();
    }

    updateTimerUI(state: TimerState): void {
        this.timerDisplayEl.setText(this.fmtTime(state.remainingSeconds));
        this.statusTextEl.setText(this.phaseLabel(state));
        this.contentEl.setAttribute('data-phase', state.phase);

        if (state.phase === 'idle') {
            this.startPauseBtn.setText('Start');
            this.skipBtn.disabled = true;
        } else if (state.isRunning) {
            this.startPauseBtn.setText('Pause');
            this.skipBtn.disabled = false;
        } else {
            this.startPauseBtn.setText('Resume');
            this.skipBtn.disabled = false;
        }

        // Dot states: completed = filled, active = current work slot
        const doneInCycle = state.completedTomatos % this.plugin.settings.cycles;
        this.phaseDotEls.forEach((dot, i) => {
            dot.toggleClass('completed', i < doneInCycle);
            dot.toggleClass('active', state.phase === 'work' && state.isRunning && i === doneInCycle);
        });

        this.completedCountEl.setText(state.completedTomatos > 0 ? ` ×${state.completedTomatos}` : '');
    }

    async refreshHistory(): Promise<void> {
        const days = await parseLogs(this.app, this.plugin.settings);
        const total = totalTomatos(days);
        const week = last7Days(days);
        const todayStr = todayString();
        const todayRecord = days.find(d => d.date === todayStr);

        const el = this.historyEl;
        el.empty();

        // --- Today ---
        const todaySection = el.createDiv({ cls: 'Tomato-history-section' });
        const todayHeader = todaySection.createDiv({ cls: 'Tomato-history-heading' });
        const todayCount = todayRecord?.count ?? 0;
        const todayMinutes = todayRecord?.entries.reduce((s, e) => s + e.duration, 0) ?? 0;
        todayHeader.createSpan({ text: 'Today' });
        const summary = todayCount > 0
            ? `${todayCount} 🍅 · ${Math.floor(todayMinutes / 60)}h ${todayMinutes % 60}m`
            : 'No Tomatos yet';
        todayHeader.createSpan({ cls: 'Tomato-today-summary', text: summary });

        if (todayRecord && todayRecord.entries.length > 0) {
            const list = todaySection.createDiv({ cls: 'Tomato-today-list' });
            for (const entry of todayRecord.entries) {
                const item = list.createDiv({ cls: 'Tomato-today-item' });
                item.createSpan({ cls: 'Tomato-entry-time', text: entry.time });
                if (entry.rest) {
                    const noteEl = item.createSpan({ cls: 'Tomato-entry-note' });
                    // Render markdown so [[wikilinks]] become clickable
                    await MarkdownRenderer.render(this.app, entry.rest, noteEl, '', this);
                }
            }
        }

        // --- This week ---
        const weekSection = el.createDiv({ cls: 'Tomato-history-section' });
        const weekHeader = weekSection.createDiv({ cls: 'Tomato-history-heading' });
        weekHeader.createSpan({ text: 'This week' });
        if (total > 0) {
            weekHeader.createSpan({ cls: 'Tomato-total', text: `🍅 ${total} total` });
        }

        const maxCount = Math.max(...week.map(d => d.count), 1);
        const barEl = weekSection.createDiv({ cls: 'Tomato-week-bar' });

        for (const day of week) {
            const col = barEl.createDiv({ cls: 'Tomato-bar-col' });
            if (day.count > 0) {
                col.createDiv({ cls: 'Tomato-bar-count', text: String(day.count) });
            }
            const fill = col.createDiv({ cls: 'Tomato-bar-fill' + (day.date === todayStr ? ' today' : '') });
            fill.style.height = `${Math.round((day.count / maxCount) * 100)}%`;
            col.createDiv({ cls: 'Tomato-bar-label', text: day.date.slice(5).replace('-', '/') });
        }
    }

    private fmtTime(s: number): string {
        return String(Math.floor(s / 60)).padStart(2, '0');
    }

    private phaseLabel(state: TimerState): string {
        if (!state.isRunning && state.phase !== 'idle') return 'Paused';
        const labels: Record<PhaseType, string> = {
            work: 'Focus',
            shortBreak: 'Short Break',
            longBreak: 'Long Rest',
            idle: 'Ready',
        };
        return labels[state.phase];
    }
}
