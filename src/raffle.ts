/**
 * Raffle engine — builds ticket pool and runs slot-machine animation
 */
import type { Participant } from './apify';

/**
 * Build a weighted ticket pool: each user appears N times where N = their ticket count.
 */
export function buildTicketPool(participants: Participant[]): Participant[] {
    const pool: Participant[] = [];
    for (const p of participants) {
        for (let i = 0; i < p.tickets; i++) {
            pool.push(p);
        }
    }
    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
}

/**
 * Pick a random winner from the ticket pool.
 */
export function pickWinner(pool: Participant[]): Participant {
    return pool[Math.floor(Math.random() * pool.length)];
}

export interface SlotAnimationCallbacks {
    onTick: (participant: Participant) => void;
    onComplete: (winner: Participant) => void;
}

/**
 * Run a slot-machine animation that cycles through participants and slows down.
 * totalDuration in ms (default 5000).
 */
export function runSlotAnimation(
    participants: Participant[],
    winner: Participant,
    callbacks: SlotAnimationCallbacks,
    totalDuration = 5000
): void {
    const pool = buildTicketPool(participants);

    // We'll iterate through participants with decreasing speed
    // Start fast (30ms interval) and slow down to ~300ms
    const startInterval = 30;
    const endInterval = 350;
    const startTime = performance.now();

    let currentIndex = Math.floor(Math.random() * pool.length);

    function step(): void {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / totalDuration, 1);

        // Ease-out cubic for slowing down
        const eased = 1 - Math.pow(1 - progress, 3);
        const currentInterval = startInterval + (endInterval - startInterval) * eased;

        if (progress < 0.92) {
            // Still spinning — show random participant
            currentIndex = (currentIndex + 1) % pool.length;
            callbacks.onTick(pool[currentIndex]);
            setTimeout(step, currentInterval);
        } else if (progress < 1) {
            // Final approach — slow ticks closer to winner
            callbacks.onTick(pool[currentIndex % pool.length]);
            currentIndex++;
            setTimeout(step, currentInterval);
        } else {
            // Done — land on winner
            callbacks.onComplete(winner);
        }
    }

    step();
}
