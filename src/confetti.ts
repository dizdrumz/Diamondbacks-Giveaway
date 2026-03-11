/**
 * Lightweight canvas confetti effect
 */

interface ConfettiParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    rotation: number;
    rotationSpeed: number;
    opacity: number;
    shape: 'rect' | 'circle';
}

const COLORS = [
    '#a855f7', '#c084fc', '#ec4899', '#f59e0b', '#fbbf24',
    '#22c55e', '#3b82f6', '#f472b6', '#a78bfa', '#facc15',
];

let particles: ConfettiParticle[] = [];
let animFrameId: number | null = null;

export function launchConfetti(canvas: HTMLCanvasElement, duration = 4000): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Create particles
    const count = 200;
    particles = [];

    for (let i = 0; i < count; i++) {
        particles.push({
            x: canvas.width * 0.5 + (Math.random() - 0.5) * 400,
            y: canvas.height * 0.4,
            vx: (Math.random() - 0.5) * 20,
            vy: -Math.random() * 18 - 5,
            size: Math.random() * 8 + 4,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3,
            opacity: 1,
            shape: Math.random() > 0.5 ? 'rect' : 'circle',
        });
    }

    const startTime = performance.now();

    function animate(now: number): void {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);

        ctx!.clearRect(0, 0, canvas.width, canvas.height);

        for (const p of particles) {
            p.x += p.vx;
            p.vy += 0.4; // gravity
            p.y += p.vy;
            p.rotation += p.rotationSpeed;
            p.vx *= 0.99;
            p.opacity = Math.max(0, 1 - progress * 0.8);

            ctx!.save();
            ctx!.translate(p.x, p.y);
            ctx!.rotate(p.rotation);
            ctx!.globalAlpha = p.opacity;
            ctx!.fillStyle = p.color;

            if (p.shape === 'rect') {
                ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            } else {
                ctx!.beginPath();
                ctx!.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                ctx!.fill();
            }

            ctx!.restore();
        }

        if (progress < 1) {
            animFrameId = requestAnimationFrame(animate);
        } else {
            ctx!.clearRect(0, 0, canvas.width, canvas.height);
            animFrameId = null;
        }
    }

    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(animate);
}

export function stopConfetti(canvas: HTMLCanvasElement): void {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}
