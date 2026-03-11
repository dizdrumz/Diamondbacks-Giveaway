// Apify Instagram Comment Scraper integration

export interface Comment {
  id: string;
  text: string;
  ownerUsername: string;
  ownerProfilePicUrl?: string;
  timestamp: string;
  likesCount: number;
  repliesCount: number;
  replies?: Comment[];
}

export interface Participant {
  username: string;
  profilePic: string;
  tickets: number;
  comments: string[];
}

const ACTOR_ID = 'apify~instagram-comment-scraper';

/**
 * Run the Instagram Comment Scraper actor and wait for results.
 */
export async function fetchComments(postUrl: string, apiToken: string): Promise<Comment[]> {
  // Start actor run
  const startRes = await fetch(
    `/apify-api/v2/acts/${ACTOR_ID}/runs?token=${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [postUrl],
        resultsLimit: 5000,
      }),
    }
  );

  if (!startRes.ok) {
    const errBody = await startRes.text();
    throw new Error(`Error starting Apify actor: ${startRes.status} — ${errBody}`);
  }

  const runData = await startRes.json();
  const runId: string = runData.data.id;

  // Poll until the run finishes
  let status = runData.data.status;
  while (status === 'RUNNING' || status === 'READY') {
    await sleep(3000);
    const pollRes = await fetch(
      `/apify-api/v2/actor-runs/${runId}?token=${apiToken}`
    );
    const pollData = await pollRes.json();
    status = pollData.data.status;
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify actor run failed with status: ${status}`);
  }

  // Fetch results from default dataset
  const datasetRes = await fetch(
    `/apify-api/v2/actor-runs/${runId}/dataset/items?token=${apiToken}`
  );

  if (!datasetRes.ok) {
    throw new Error('Error fetching results from Apify dataset');
  }

  return await datasetRes.json();
}

/**
 * Process raw comments into participants with ticket counts.
 * Each comment from a user = 1 ticket.
 */
export function processParticipants(comments: Comment[]): Participant[] {
  const map = new Map<string, Participant>();

  for (const comment of comments) {
    const username = comment.ownerUsername?.toLowerCase();
    if (!username) continue;

    if (map.has(username)) {
      const p = map.get(username)!;
      p.tickets += 1;
      p.comments.push(comment.text);
    } else {
      map.set(username, {
        username,
        profilePic: comment.ownerProfilePicUrl || '',
        tickets: 1,
        comments: [comment.text],
      });
    }
  }

  // Sort by ticket count descending
  return Array.from(map.values()).sort((a, b) => b.tickets - a.tickets);
}

/**
 * Parse raw Instagram copy-paste text to extract usernames.
 *
 * Instagram's copied format looks like:
 *   username
 *   1w
 *   comment text here @mention1 @mention2
 *   2 likes Responder
 *
 * Strategy: A valid Instagram username line is:
 * - Only contains [a-zA-Z0-9._] (no spaces, no @, no special chars)
 * - Is between 1 and 30 chars
 * - Is NOT a timestamp (1w, 2d, 3h, etc.)
 * - Is NOT a metadata line (Responder, Reply, likes, etc.)
 * - The NEXT non-empty line is either a timestamp or another username
 */
export function parseInstagramComments(rawText: string): Participant[] {
  const lines = rawText.split('\n').map(l => l.trim());
  const map = new Map<string, Participant>();

  // Noise patterns to skip
  const timestampRegex = /^\d+[smhdw]$/;                   // 1w, 2d, 3h, etc.
  const metadataRegex = /^(responder|reply|ver traducción|see translation|ver más|see more|view replies|ver respuestas|me gusta|likes?|edited|editado)$/i;
  const likesLineRegex = /^\d+\s*(likes?|me gusta)/i;       // "2 likes", "1 me gusta"
  const actionLineRegex = /likes?\s*(responder|reply)/i;     // "2 likes Responder"
  const usernameRegex = /^[a-zA-Z][a-zA-Z0-9._]{0,29}$/;   // Valid IG username

  // Words that look like usernames but aren't
  const skipWords = new Set([
    'responder', 'reply', 'like', 'likes', 'edited', 'editado',
    'ver', 'see', 'more', 'view', 'replies', 'respuestas',
    'hide', 'ocultar', 'report', 'reportar', 'traducción', 'translation',
    'load', 'cargar', 'comments', 'comentarios', 'all', 'todos',
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Skip obvious non-username lines
    if (timestampRegex.test(line)) continue;
    if (metadataRegex.test(line)) continue;
    if (likesLineRegex.test(line)) continue;
    if (actionLineRegex.test(line)) continue;
    if (line.includes('Responder') || line.includes('Reply')) continue;
    if (line.startsWith('@')) continue;  // mention, not author
    if (line.includes(' ')) continue;    // usernames don't have spaces
    if (skipWords.has(line.toLowerCase())) continue;

    // Check if this looks like a valid username
    if (usernameRegex.test(line)) {
      const username = line.toLowerCase();

      // Peek at next non-empty line - should be timestamp or another username
      let nextLine = '';
      for (let j = i + 1; j < lines.length && j < i + 3; j++) {
        if (lines[j].trim()) {
          nextLine = lines[j].trim();
          break;
        }
      }

      // If next line is a timestamp, this is very likely a username
      const nextIsTimestamp = timestampRegex.test(nextLine);
      // If next line is NOT a valid structure, still accept if it looks like a username
      const looksLikeUsername = usernameRegex.test(line) && line.length >= 2;

      if (nextIsTimestamp || looksLikeUsername) {
        if (map.has(username)) {
          map.get(username)!.tickets += 1;
        } else {
          map.set(username, {
            username,
            profilePic: '',
            tickets: 1,
            comments: [],
          });
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.tickets - a.tickets);
}

/**
 * Parse manual input text in multiple formats:
 * 1. Plain usernames (one per line) → 1 ticket each
 * 2. CSV: username,tickets per line
 * 3. JSON array (Apify export format)
 */
export function parseManualInput(text: string): Participant[] {
  const trimmed = text.trim();

  // Try JSON first
  if (trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data) && data.length > 0) {
        // Check if it's Apify format (has ownerUsername) or simple format
        if (data[0].ownerUsername) {
          return processParticipants(data as Comment[]);
        }
        // Simple JSON array of objects with username/tickets
        if (data[0].username) {
          const map = new Map<string, Participant>();
          for (const item of data) {
            const u = String(item.username).toLowerCase().replace(/^@/, '');
            if (!u) continue;
            if (map.has(u)) {
              map.get(u)!.tickets += (item.tickets || 1);
            } else {
              map.set(u, { username: u, profilePic: '', tickets: item.tickets || 1, comments: [] });
            }
          }
          return Array.from(map.values()).sort((a, b) => b.tickets - a.tickets);
        }
        // Array of strings (just usernames)
        if (typeof data[0] === 'string') {
          const map = new Map<string, Participant>();
          for (const name of data) {
            const u = String(name).toLowerCase().replace(/^@/, '').trim();
            if (!u) continue;
            if (map.has(u)) {
              map.get(u)!.tickets += 1;
            } else {
              map.set(u, { username: u, profilePic: '', tickets: 1, comments: [] });
            }
          }
          return Array.from(map.values()).sort((a, b) => b.tickets - a.tickets);
        }
      }
    } catch {
      // Not valid JSON, fall through to text parsing
    }
  }

  // Text format: one entry per line
  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
  const map = new Map<string, Participant>();

  for (const line of lines) {
    let username: string;
    let tickets = 1;

    if (line.includes(',')) {
      // CSV format: username,tickets
      const parts = line.split(',');
      username = parts[0].trim().toLowerCase().replace(/^@/, '');
      const num = parseInt(parts[1]?.trim(), 10);
      if (!isNaN(num) && num > 0) tickets = num;
    } else if (line.includes('\t')) {
      // Tab-separated
      const parts = line.split('\t');
      username = parts[0].trim().toLowerCase().replace(/^@/, '');
      const num = parseInt(parts[1]?.trim(), 10);
      if (!isNaN(num) && num > 0) tickets = num;
    } else {
      // Just a username
      username = line.toLowerCase().replace(/^@/, '').trim();
    }

    if (!username || username.length < 1) continue;

    if (map.has(username)) {
      map.get(username)!.tickets += tickets;
    } else {
      map.set(username, { username, profilePic: '', tickets, comments: [] });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.tickets - a.tickets);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Demo data for testing without API token
 */
export function getDemoComments(): Comment[] {
  const usernames = [
    'maria_fitness', 'carlos_gamer', 'ana.martinez', 'diego_photo',
    'luisa_travel', 'roberto_chef', 'sofia.art', 'miguel_music',
    'valentina_style', 'andres_dev', 'camila_yoga', 'fernando_run',
    'isabella_reads', 'jorge.sports', 'paula_dances', 'daniel_tech',
    'gabriela_pets', 'ricardo.vlogs', 'natalia_beauty', 'alejandro_fit',
    'laura_cooks', 'sebastian_draws', 'monica_sings', 'david_builds',
    'carmen_writes',
  ];

  const texts = [
    '¡Yo quiero participar! 🎉', 'Increíble sorteo, participo! 🔥',
    '¡Me encanta! Quiero ganar 🏆', 'Participando ✨',
    '¡Ojalá gane! 🤞', 'Excelente giveaway 🎁', '¡Gracias por la oportunidad!',
    'Aquí estamos participando 💪', '¡Qué genial! Me apunto',
    'Compartido y participando 🙌',
  ];

  const comments: Comment[] = [];
  let id = 1000;

  // Give different users different comment counts (tickets)
  for (const username of usernames) {
    const commentCount = Math.random() < 0.15 ? 4 :
      Math.random() < 0.3 ? 3 :
        Math.random() < 0.5 ? 2 : 1;

    for (let i = 0; i < commentCount; i++) {
      comments.push({
        id: String(id++),
        text: texts[Math.floor(Math.random() * texts.length)],
        ownerUsername: username,
        ownerProfilePicUrl: '',
        timestamp: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
        likesCount: Math.floor(Math.random() * 50),
        repliesCount: 0,
      });
    }
  }

  return comments;
}
