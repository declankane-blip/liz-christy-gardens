// Pure analysis logic: no network, no DOM. Used by app.js in the browser and by test/ in Node.

const SLOT_ELIGIBILITY = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

// How much of a player's projection we trust given his injury designation.
const STATUS_FACTOR = {
  Out: 0, IR: 0, PUP: 0, Sus: 0, NA: 0, COV: 0, DNR: 0,
  Doubtful: 0.25,
  Questionable: 0.92,
};

const MARGINAL_POINTS = 1.0; // swaps worth less than this are called toss-ups
const NEWS_WINDOW_MS = 72 * 3600 * 1000;

const round1 = (n) => Math.round(n * 10) / 10;

/** Projected fantasy points using the league's own scoring settings. */
export function scoreStats(stats, scoring) {
  let total = 0;
  let matched = false;
  for (const [key, value] of Object.entries(stats || {})) {
    const weight = scoring?.[key];
    if (typeof weight === 'number' && typeof value === 'number') {
      total += weight * value;
      matched = true;
    }
  }
  if (!matched || total === 0) {
    const fallback = stats?.pts_ppr ?? stats?.pts_half_ppr ?? stats?.pts_std;
    if (typeof fallback === 'number') return fallback;
  }
  return total;
}

/** Turn raw Sleeper projection rows into a map of player_id -> player. */
export function buildPlayers(projectionRows, scoring, { now = Date.now() } = {}) {
  const players = new Map();
  for (const row of projectionRows) {
    const p = row.player || {};
    const pos = p.position === 'DEF' ? 'DEF' : (p.fantasy_positions || [p.position])[0] || p.position;
    if (!SLOT_ELIGIBILITY[pos]) continue;
    const proj = scoreStats(row.stats, scoring);
    const status = p.injury_status || null;
    const factor = status in STATUS_FACTOR ? STATUS_FACTOR[status] : 1;
    const newsAt = p.news_updated || null;
    players.set(String(row.player_id), {
      id: String(row.player_id),
      name: pos === 'DEF' ? `${p.first_name} ${p.last_name}` : `${p.first_name} ${p.last_name}`.trim(),
      pos,
      team: row.team || p.team || null,
      opp: row.opponent || null,
      playing: Boolean(row.opponent),
      proj: round1(proj),
      adj: round1(row.opponent ? proj * factor : 0),
      status,
      note: p.injury_notes || null,
      bodyPart: p.injury_body_part || null,
      recentNews: Boolean(newsAt && now - newsAt <= NEWS_WINDOW_MS),
    });
  }
  return players;
}

/** Starting slots only (drops bench/IR/taxi and slots we can't project, e.g. IDP). */
export function startingSlots(rosterPositions) {
  const slots = [];
  const unsupported = [];
  for (const s of rosterPositions || []) {
    if (['BN', 'IR', 'TAXI'].includes(s)) continue;
    if (SLOT_ELIGIBILITY[s]) slots.push(s);
    else unsupported.push(s);
  }
  return { slots, unsupported };
}

/**
 * Best lineup by adjusted projection. Fills the most restrictive slots first, which is
 * optimal for QB/RB/WR/TE/K/DEF plus the nested flex types.
 * Returns [{ slot, index, player|null }] in the league's original slot order.
 */
export function optimizeLineup(slots, candidates) {
  const order = slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => SLOT_ELIGIBILITY[a.slot].length - SLOT_ELIGIBILITY[b.slot].length || a.index - b.index);
  const pool = [...candidates].sort((a, b) => b.adj - a.adj || b.proj - a.proj);
  const used = new Set();
  const out = new Array(slots.length);
  for (const { slot, index } of order) {
    const pick = pool.find((p) => !used.has(p.id) && SLOT_ELIGIBILITY[slot].includes(p.pos));
    if (pick) used.add(pick.id);
    out[index] = { slot, index, player: pick || null };
  }
  return out;
}

const lineupTotal = (lineup) => lineup.reduce((sum, s) => sum + (s.player?.adj || 0), 0);

function describeIssue(p) {
  if (!p.playing) return 'No game this week (bye)';
  if (p.status && p.status !== 'Active') {
    const detail = [p.bodyPart, p.note].filter(Boolean).join(' - ');
    return `${p.status}${detail ? `: ${detail}` : ''}`;
  }
  return null;
}

/**
 * Build the weekly report for one roster.
 *  - league: Sleeper league object (roster_positions, scoring_settings)
 *  - roster: my Sleeper roster ({ players, starters, reserve, taxi })
 *  - allRosters: every roster in the league (to know who is a free agent)
 *  - projections: Map from buildPlayers() for this week
 *  - extraNames: Map id -> {name,pos,team} for rostered players with no projection (byes)
 *  - trending: { add: [{player_id,count}], drop: [{player_id,count}] }
 */
export function buildReport({ league, roster, allRosters, projections, extraNames = new Map(), trending = {} }) {
  const { slots, unsupported } = startingSlots(league.roster_positions);
  const reserve = new Set([...(roster.reserve || []), ...(roster.taxi || [])].map(String));
  const myIds = (roster.players || []).map(String);
  const trendAdd = new Map((trending.add || []).map((t) => [String(t.player_id), t.count]));
  const trendDrop = new Map((trending.drop || []).map((t) => [String(t.player_id), t.count]));

  const lookup = (id) => {
    const p = projections.get(id);
    if (p) return p;
    const e = extraNames.get(id) || {};
    return { id, name: e.name || `Player ${id}`, pos: e.pos || '?', team: e.team || null, opp: null, playing: false,
      proj: 0, adj: 0, status: null, note: null, bodyPart: null, recentNews: false };
  };

  const mine = myIds.map(lookup);
  const active = mine.filter((p) => !reserve.has(p.id));
  const eligible = active.filter((p) => SLOT_ELIGIBILITY[p.pos]);

  // Lineup
  const best = optimizeLineup(slots, eligible);
  const bestTotal = lineupTotal(best);
  const startersNow = (roster.starters || []).map(String);
  const currentLineup = slots.map((slot, i) => {
    const id = startersNow[i];
    const player = id && id !== '0' ? lookup(id) : null;
    return { slot, index: i, player };
  });
  const currentTotal = lineupTotal(currentLineup);
  const gain = round1(bestTotal - currentTotal);
  const hasCurrent = startersNow.length > 0;
  const changesNeeded = !hasCurrent || gain >= MARGINAL_POINTS;
  const recommended = changesNeeded ? best : currentLineup;
  const recommendedIds = new Set(recommended.map((s) => s.player?.id).filter(Boolean));

  const lineup = recommended.map((s) => {
    const cur = currentLineup[s.index];
    const changed = hasCurrent && cur.player?.id !== s.player?.id;
    return { slot: s.slot, player: s.player, current: changed ? cur.player : null, changed };
  });

  const bench = active
    .filter((p) => !recommendedIds.has(p.id))
    .sort((a, b) => b.adj - a.adj);

  // News: injury designations, byes, and players many managers are dropping (Sleeper's per-player
  // news timestamp updates for nearly everyone each week, so it is not a useful filter on its own)
  const news = mine
    .map((p) => ({ player: p, issue: describeIssue(p), trendDrop: trendDrop.get(p.id) || 0, onIR: reserve.has(p.id) }))
    .filter((n) => n.issue || n.trendDrop > 100000)
    .map((n) => ({ ...n, starting: recommendedIds.has(n.player.id) }))
    .sort((a, b) => Number(b.starting) - Number(a.starting) || b.player.proj - a.player.proj);

  // Waivers
  const rostered = new Set();
  for (const r of allRosters || []) for (const id of r.players || []) rostered.add(String(id));
  const freeAgents = [...projections.values()]
    .filter((p) => !rostered.has(p.id) && p.playing && p.adj > 0)
    .sort((a, b) => b.adj - a.adj);

  const topByPos = {};
  const shortlist = [];
  for (const p of freeAgents) {
    topByPos[p.pos] = (topByPos[p.pos] || 0) + 1;
    if (topByPos[p.pos] <= 8) shortlist.push(p);
  }
  for (const p of freeAgents) {
    if (trendAdd.has(p.id) && !shortlist.includes(p) && shortlist.length < 80) shortlist.push(p);
  }

  const pickups = [];
  for (const fa of shortlist) {
    const withFa = optimizeLineup(slots, [...eligible, fa]);
    const delta = round1(lineupTotal(withFa) - bestTotal);
    const starts = withFa.some((s) => s.player?.id === fa.id);
    const keep = new Set(withFa.map((s) => s.player?.id).filter(Boolean));
    const drop = eligible
      .filter((p) => !keep.has(p.id))
      .sort((a, b) => a.adj - b.adj || a.proj - b.proj)[0] || null;
    const adds = trendAdd.get(fa.id) || 0;
    if (!(starts && delta >= MARGINAL_POINTS) && adds === 0) continue;
    pickups.push({ player: fa, delta, starts, drop, adds });
  }
  pickups.sort((a, b) => b.delta - a.delta || b.adds - a.adds || b.player.adj - a.player.adj);

  return {
    lineup,
    bench,
    bestTotal: round1(bestTotal),
    currentTotal: round1(currentTotal),
    gain: changesNeeded ? gain : 0,
    changesNeeded,
    hasCurrent,
    unsupported,
    news,
    ir: mine.filter((p) => reserve.has(p.id)),
    pickups: pickups.slice(0, 12),
  };
}
