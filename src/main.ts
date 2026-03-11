import './style.css';
import { parseInstagramComments, getDemoComments, processParticipants, type Participant } from './apify';
import { buildTicketPool, pickWinner, runSlotAnimation } from './raffle';
import { launchConfetti, stopConfetti } from './confetti';

// ===== PRIZE PACKAGES =====
interface Prize {
  rank: number;
  name: string;
  items: string[];
  emoji: string;
}

const PRIZES: Prize[] = [
  { rank: 10, name: 'Premio 10', emoji: '🎁', items: ['Conchas La Purísima', 'Calcetines Malva'] },
  { rank: 9, name: 'Premio 9', emoji: '🎁', items: ['Estética c/Consulta Gordillo', 'Vela pelota Miamio'] },
  { rank: 8, name: 'Premio 8', emoji: '🎁', items: ['Limpieza dental Dra Janeth', 'Lentes Malva'] },
  { rank: 7, name: 'Premio 7', emoji: '🎁', items: ['$600 en mercancía Cherry', 'Estética c/Consulta Gordillo'] },
  { rank: 6, name: 'Premio 6', emoji: '⭐', items: ['Cancha Peak', 'Hoodie + Termo Colorescuu'] },
  { rank: 5, name: 'Premio 5', emoji: '⭐', items: ['Maleta Deportiva Colorescuu', 'Vale $500 B-Sport'] },
  { rank: 4, name: 'Premio 4', emoji: '🔥', items: ['Corte + Tratamiento Ruta Color', 'Cancha Peak'] },
  { rank: 3, name: 'Premio 3', emoji: '🔥', items: ['Clase matutina Lautaro', 'Mostachones Dolce Duo', 'Nueces Dos Alamos'] },
  { rank: 2, name: 'Premio 2', emoji: '💎', items: ['Cancha Padel Center', 'Mostachones Dolce Duo', 'Nueces Dos Alamos'] },
  { rank: 1, name: 'PREMIO PRINCIPAL', emoji: '🏆', items: ['Entrada Liga Diamondbacks', 'Cancha Padel Center', 'Nueces Dos Alamos'] },
];

// ===== APP STATE =====
type AppState = 'input' | 'loading' | 'ready' | 'raffling' | 'winner';

let state: AppState = 'input';
let participants: Participant[] = [];
let currentRound = 0;  // 0 = hasn't started, 1..10 = current round
let currentWinner: Participant | null = null;
let sortByTickets = true;

interface WinnerEntry {
  participant: Participant;
  prize: Prize;
}
let winners: WinnerEntry[] = [];

const app = document.getElementById('app')!;
const confettiCanvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;

/** Get participants that haven't won yet */
function getEligibleParticipants(): Participant[] {
  const wonUsernames = new Set(winners.map(w => w.participant.username));
  return participants.filter(p => !wonUsernames.has(p.username));
}

/** Get the current prize (based on round) */
function getCurrentPrize(): Prize | null {
  if (currentRound < 1 || currentRound > PRIZES.length) return null;
  return PRIZES[currentRound - 1];
}

// ===== RENDER ENGINE =====
function render(): void {
  app.innerHTML = '';
  app.appendChild(renderHeader());

  switch (state) {
    case 'input':
      app.appendChild(renderForm());
      break;
    case 'loading':
      app.appendChild(renderLoading());
      break;
    case 'ready':
    case 'raffling':
      app.appendChild(renderStats());
      app.appendChild(renderMainLayout());
      break;
    case 'winner':
      app.appendChild(renderStats());
      app.appendChild(renderMainLayout());
      renderWinnerOverlay();
      break;
  }
}

// ===== HEADER =====
function renderHeader(): HTMLElement {
  const header = el('header', 'header');
  header.innerHTML = `
    <img src="${import.meta.env.BASE_URL}snake-logo.png" alt="Diamondbacks Logo" class="header__logo" />
    <h1 class="header__title">GIVEAWAY</h1>
    <p class="header__subtitle">MÁS DE 12000 EN PREMIOS</p>
  `;
  return header;
}

// ===== FORM =====
function renderForm(): HTMLElement {
  const section = el('section', 'form-section slide-in');
  section.innerHTML = `
    <h2 class="form-section__title">📋 Pegar Comentarios de Instagram</h2>
    <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: var(--space-lg); line-height: 1.6;">
      Abre tu post en Instagram, <strong>copia todos los comentarios</strong> (Ctrl+A / Cmd+A → Ctrl+C), 
      y pégalos aquí. La app extrae los usernames automáticamente.
    </p>
    <div class="form-group">
      <textarea id="paste-input" class="form-input form-textarea" rows="12"
placeholder="Pega aquí todo lo copiado de Instagram...

Ejemplo de lo que verás al pegar:

ferpradsol
1w
@miriam_maciasl @denissebalh
1 like Responder

anacruz_glez
6d
¡Yo quiero participar! 🎉
Responder

(La app detecta los usernames automáticamente)"></textarea>
    </div>
    <div class="form-actions">
      <button id="btn-parse" class="btn btn--primary btn--large">
        🚀 Extraer Participantes
      </button>
      <button id="btn-demo" class="btn btn--secondary">
        🎮 Modo Demo
      </button>
    </div>
    <div id="error-container"></div>
  `;

  setTimeout(() => {
    document.getElementById('btn-parse')?.addEventListener('click', handleParseComments);
    document.getElementById('btn-demo')?.addEventListener('click', handleDemoMode);
  });

  return section;
}

// ===== LOADING =====
function renderLoading(): HTMLElement {
  const div = el('div', 'loading-overlay slide-in');
  div.innerHTML = `
    <div class="loading-dots">
      <span></span><span></span><span></span>
    </div>
    <p class="loading-overlay__text">Procesando comentarios...</p>
    <p class="loading-overlay__text" id="loading-progress" style="font-size: 0.85rem; color: var(--text-muted);">
      Esto puede tomar unos segundos
    </p>
  `;
  return div;
}

// ===== STATS =====
function renderStats(): HTMLElement {
  const eligible = getEligibleParticipants();
  const totalTickets = eligible.reduce((sum, p) => sum + p.tickets, 0);
  const prize = getCurrentPrize();
  const remaining = PRIZES.length - winners.length;

  const bar = el('div', 'stats-bar slide-in');
  bar.innerHTML = `
    <div class="stat-card">
      <div class="stat-card__value">${eligible.length}</div>
      <div class="stat-card__label">Participantes</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__value">${totalTickets}</div>
      <div class="stat-card__label">Total Tickets</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__value">${winners.length} / ${PRIZES.length}</div>
      <div class="stat-card__label">Premios Entregados</div>
    </div>
    <div class="stat-card" style="${prize ? 'border-color: var(--accent-gold); background: rgba(245, 158, 11, 0.08);' : ''}">
      <div class="stat-card__value">${remaining > 0 ? (prize ? prize.emoji : '🎁') : '✅'}</div>
      <div class="stat-card__label">${remaining > 0 ? `Siguiente: ${prize?.name || ''}` : '¡Completado!'}</div>
    </div>
  `;
  return bar;
}

// ===== MAIN LAYOUT =====
function renderMainLayout(): HTMLElement {
  const layout = el('div', 'main-layout slide-in slide-in-delay-1');
  layout.appendChild(renderParticipantPanel());

  const rightColumn = el('div', '');
  rightColumn.appendChild(renderRafflePanel());
  if (winners.length > 0) {
    rightColumn.appendChild(renderWinnersHistory());
  }
  layout.appendChild(rightColumn);

  return layout;
}

// ===== PARTICIPANT LIST =====
function renderParticipantPanel(): HTMLElement {
  const panel = el('div', 'participant-panel');
  const eligible = getEligibleParticipants();

  const sorted = [...eligible].sort((a, b) =>
    sortByTickets ? b.tickets - a.tickets : a.username.localeCompare(b.username)
  );

  const maxTickets = eligible.length > 0 ? Math.max(...eligible.map(p => p.tickets)) : 1;

  const listHTML = sorted.map((p, i) => `
    <div class="participant-card${currentWinner && p.username === currentWinner.username ? ' participant-card--highlighted' : ''}" data-username="${p.username}">
      <div class="participant-card__rank">${i + 1}</div>
      <div class="participant-card__avatar">
        ${p.profilePic
      ? `<img src="${p.profilePic}" alt="${p.username}" onerror="this.parentElement.textContent='${p.username[0].toUpperCase()}'" />`
      : p.username[0].toUpperCase()
    }
      </div>
      <div class="participant-card__info">
        <div class="participant-card__name">@${p.username}</div>
        <div class="participant-card__tickets-label">${p.tickets} ticket${p.tickets > 1 ? 's' : ''}</div>
      </div>
      <div class="participant-card__bar">
        <div class="participant-card__bar-fill" style="width: ${(p.tickets / maxTickets) * 100}%"></div>
      </div>
      <div class="participant-card__ticket-count">${p.tickets}</div>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="participant-panel__header">
      <h3 class="participant-panel__title">👥 Participantes (${eligible.length})</h3>
      <button class="participant-panel__sort" id="btn-sort">
        ${sortByTickets ? '🔢 Por Tickets' : '🔤 Alfabético'}
      </button>
    </div>
    <div class="participant-list">
      ${listHTML}
    </div>
  `;

  setTimeout(() => {
    document.getElementById('btn-sort')?.addEventListener('click', () => {
      sortByTickets = !sortByTickets;
      render();
    });
  });

  return panel;
}

// ===== RAFFLE PANEL =====
function renderRafflePanel(): HTMLElement {
  const panel = el('div', 'raffle-panel');
  const prize = getCurrentPrize();
  const allDone = winners.length >= PRIZES.length;

  // Current prize display
  if (prize && !allDone) {
    const prizeDisplay = el('div', 'prize-display');
    prizeDisplay.innerHTML = `
      <div class="prize-display__rank">${prize.emoji} ${prize.name}</div>
      <div class="prize-display__items">
        ${prize.items.map(item => `<span class="prize-item-tag">🎁 ${item}</span>`).join('')}
      </div>
    `;
    panel.appendChild(prizeDisplay);
  }

  // Slot machine
  const slotMachine = el('div', `slot-machine${state === 'raffling' ? ' slot-machine--active' : ''}`);
  slotMachine.setAttribute('id', 'slot-machine');

  let pointerHtml = '';
  if (state === 'raffling' || state === 'winner') {
    pointerHtml = `<div class="slot-machine__pointer"></div>`;
  }

  slotMachine.innerHTML = `
    <div class="slot-machine__label">🎰 Sorteo</div>
    <div class="slot-machine__window" id="slot-window">
      ${pointerHtml}
      <div class="slot-machine__reel" id="slot-reel">
        ${state === 'raffling' || state === 'winner'
      ? renderSlotItems()
      : `<div class="slot-machine__idle">
               <div class="slot-machine__idle-icon">${allDone ? '🎉' : '🎲'}</div>
               <p>${allDone ? '¡Todos los premios han sido entregados!' : `Presiona el botón para sortear ${prize?.name || ''}`}</p>
             </div>`
    }
      </div>
    </div>
  `;

  // Action buttons
  const btnContainer = el('div', '');
  btnContainer.style.textAlign = 'center';
  btnContainer.style.marginTop = 'var(--space-xl)';
  btnContainer.style.width = '100%';

  if (allDone) {
    btnContainer.innerHTML = `
      <button id="btn-reset" class="btn btn--gold btn--large">
        🔄 Reiniciar Sorteo
      </button>
    `;
  } else {
    btnContainer.innerHTML = `
      <button id="btn-raffle" class="btn btn--gold btn--large" ${state === 'raffling' ? 'disabled' : ''}>
        ${state === 'raffling'
        ? '<span class="loading-spinner"></span> Sorteando...'
        : `${prize?.emoji || '🎉'} Sortear ${prize?.name || ''}`}
      </button>
      <div style="margin-top: 12px;">
        <button id="btn-reset" class="btn btn--secondary">
          🔄 Reiniciar Sorteo
        </button>
      </div>
    `;
  }

  // Append buttons INSIDE the slotMachine box so they are unified
  slotMachine.appendChild(btnContainer);
  panel.appendChild(slotMachine);

  setTimeout(() => {
    document.getElementById('btn-raffle')?.addEventListener('click', handleStartRaffle);
    document.getElementById('btn-reset')?.addEventListener('click', handleFullReset);
  });

  return panel;
}

// ===== WINNERS HISTORY =====
function renderWinnersHistory(): HTMLElement {
  const section = el('div', 'winners-history');

  const rows = [...winners].reverse().map(w => `
    <div class="winner-row ${w.prize.rank === 1 ? 'winner-row--principal' : ''}">
      <div class="winner-row__rank">${w.prize.emoji}</div>
      <div class="winner-row__info">
        <div class="winner-row__prize">${w.prize.name}</div>
        <div class="winner-row__username">@${w.participant.username}</div>
      </div>
      <div class="winner-row__items">
        ${w.prize.items.map(item => `<span class="prize-item-micro">${item}</span>`).join('')}
      </div>
    </div>
  `).join('');

  section.innerHTML = `
    <div class="winners-history__header">
      <h3 class="winners-history__title">🏆 Ganadores</h3>
      <span class="winners-history__count">${winners.length} / ${PRIZES.length}</span>
    </div>
    <div class="winners-history__list">
      ${rows}
    </div>
  `;

  return section;
}

function renderSlotItems(): string {
  if (state === 'winner' && currentWinner) {
    return renderSlotItem(currentWinner);
  }
  const eligible = getEligibleParticipants();
  if (!eligible.length) return '';
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  // Just return one initial random item; the tick animation handles the rest
  return renderSlotItem(shuffled[0]);
}

function renderSlotItem(p: Participant): string {
  return `
    <div class="slot-machine__item">
      <div class="slot-machine__item-avatar">
        ${p.profilePic
      ? `<img src="${p.profilePic}" alt="${p.username}" onerror="this.parentElement.textContent='${p.username[0].toUpperCase()}'" />`
      : p.username[0].toUpperCase()
    }
      </div>
      <span class="slot-machine__item-name">@${p.username}</span>
      <span class="slot-machine__item-tickets">🎫 ${p.tickets}</span>
    </div>
  `;
}

// ===== WINNER OVERLAY =====
function renderWinnerOverlay(): void {
  if (!currentWinner) return;
  const prize = winners.length > 0 ? winners[winners.length - 1].prize : null;
  if (!prize) return;

  const isPrincipal = prize.rank === 1;
  const remaining = PRIZES.length - winners.length;

  const overlay = el('div', 'winner-overlay');
  overlay.setAttribute('id', 'winner-overlay');
  overlay.innerHTML = `
    <div class="winner-card">
      <div class="winner-card__crown">${isPrincipal ? '👑' : prize.emoji}</div>
      <div class="winner-card__prize-name ${isPrincipal ? 'winner-card__prize-name--principal' : ''}">${prize.name}</div>
      <div class="winner-card__avatar">
        ${currentWinner.profilePic
      ? `<img src="${currentWinner.profilePic}" alt="${currentWinner.username}" onerror="this.parentElement.textContent='${currentWinner.username[0].toUpperCase()}'" />`
      : currentWinner.username[0].toUpperCase()
    }
      </div>
      <div class="winner-card__label">¡Ganador!</div>
      <div class="winner-card__name">@${currentWinner.username}</div>
      <p class="winner-card__tickets">Con <strong>${currentWinner.tickets} ticket${currentWinner.tickets > 1 ? 's' : ''}</strong></p>
      <div class="winner-card__prize-items">
        ${prize.items.map(item => `<div class="winner-prize-tag">🎁 ${item}</div>`).join('')}
      </div>
      <div class="winner-card__actions">
        <button id="btn-close-winner" class="btn btn--primary">
          ${remaining > 0 ? `➡️ Siguiente (${remaining} premios restantes)` : '🎉 Finalizar'}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  launchConfetti(confettiCanvas, isPrincipal ? 8000 : 4000);

  setTimeout(() => {
    document.getElementById('btn-close-winner')?.addEventListener('click', () => {
      state = 'ready';
      document.getElementById('winner-overlay')?.remove();
      stopConfetti(confettiCanvas);
      currentWinner = null;
      render();
    });
  });
}

// ===== EVENT HANDLERS =====

function handleParseComments(): void {
  const textarea = document.getElementById('paste-input') as HTMLTextAreaElement;
  const errorContainer = document.getElementById('error-container')!;
  const text = textarea?.value.trim();

  if (!text) {
    errorContainer.innerHTML = `<div class="error-msg">⚠️ Pega los comentarios de Instagram primero</div>`;
    return;
  }

  try {
    participants = parseInstagramComments(text);

    if (participants.length === 0) {
      errorContainer.innerHTML = `<div class="error-msg">⚠️ No se encontraron usernames válidos. Asegúrate de copiar los comentarios directamente desde Instagram.</div>`;
      return;
    }

    currentRound = 1;  // Start at round 1 (Prize 10, the smallest)
    state = 'ready';
    render();
  } catch (err: any) {
    errorContainer.innerHTML = `<div class="error-msg">❌ Error al procesar: ${err.message}</div>`;
  }
}

function handleDemoMode(): void {
  state = 'loading';
  render();

  setTimeout(() => {
    const comments = getDemoComments();
    participants = processParticipants(comments);
    currentRound = 1;
    state = 'ready';
    render();
  }, 1200);
}

function handleStartRaffle(): void {
  const eligible = getEligibleParticipants();
  if (eligible.length === 0 || currentRound > PRIZES.length) return;

  state = 'raffling';
  render();

  const pool = buildTicketPool(eligible);
  const winner = pickWinner(pool);

  const reel = document.getElementById('slot-reel');
  const slotMachine = document.getElementById('slot-machine');
  slotMachine?.classList.add('slot-machine--active');

  const prize = getCurrentPrize()!;
  const isPrincipal = prize.rank === 1;

  runSlotAnimation(eligible, winner, {
    onTick: (p: Participant) => {
      if (reel) {
        reel.innerHTML = renderSlotItem(p);
        // Transform is handled gracefully by flexbox centering now
      }
    },
    onComplete: (w: Participant) => {
      currentWinner = w;
      winners.push({ participant: w, prize });
      currentRound++;
      state = 'winner';
      render();
    },
  }, isPrincipal ? 7000 : 5000);
}

function handleFullReset(): void {
  state = 'input';
  participants = [];
  currentWinner = null;
  winners = [];
  currentRound = 0;
  stopConfetti(confettiCanvas);
  render();
}

// ===== HELPERS =====
function el(tag: string, className: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

// ===== INIT =====
render();
