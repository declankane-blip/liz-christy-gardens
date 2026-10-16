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

// Roster % is market consensus. It nudges close calls: a player rostered everywhere is worth up to
// this many extra points when ranking, never when summing a lineup's projected total.
const ROSTER_WEIGHT = 1.5;
const POPULAR_FREE_AGENT = 50; // % rostered at which a free agent is worth surfacing on its own
const SEASON_ENDING = /season[- ]ending|out for (the )?(season|year)|rest of (the )?season|for the year|torn (acl|achilles)|ruptured|will not return/i;
const MARGINAL_POINTS = 1.0; // swaps worth less than this are called toss-ups
const NEWS_WINDOW_MS = 72 * 3600 * 1000;

const round1 = (n) => Math.round(n * 10) / 10;
const rank = (p) => p.adj + ((p.rostered ?? 0) / 100) * ROSTER_WEIGHT;

/** Projection discounted for injury designation; zero when the team has no game. */
export function adjustedPoints(proj, status, playing) {
  if (!playing) return 0;
  const factor = status in STATUS_FACTOR ? STATUS_FACTOR[status] : 1;
  return round1(proj * factor);
}

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
    const newsAt = p.news_updated || null;
    players.set(String(row.player_id), {
      id: String(row.player_id),
      name: pos === 'DEF' ? `${p.first_name} ${p.last_name}` : `${p.first_name} ${p.last_name}`.trim(),
      pos,
      team: row.team || p.team || null,
      opp: row.opponent || null,
      playing: Boolean(row.opponent),
      proj: round1(proj),
      adj: adjustedPoints(proj, status, Boolean(row.opponent)),
      status,
      note: p.injury_notes || null,
      bodyPart: p.injury_body_part || null,
      recentNews: Boolean(newsAt && now - newsAt <= NEWS_WINDOW_MS),
      rostered: null,
      cut: !(row.team || p.team) && pos !== 'DEF',
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
  // Never start a player projected for zero (out, on bye, suspended): leave the slot open instead.
  const pool = candidates.filter((p) => p.adj > 0).sort((a, b) => rank(b) - rank(a) || b.proj - a.proj);
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
  if (p.bye) return 'On bye this week';
  if (p.status && p.status !== 'Active') {
    const detail = [p.bodyPart, p.note].filter(Boolean).join(' - ');
    return `${p.status}${detail ? `: ${detail}` : ''}`;
  }
  if (!p.playing) return 'No game this week';
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
export function buildReport({ league, roster, allRosters, projections, extraNames = new Map(), trending = {}, dropAlertThreshold = 100000, missingMeansCut = false }) {
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
      proj: 0, adj: 0, status: null, note: null, bodyPart: null, recentNews: false, rostered: null, cut: missingMeansCut && !projections.has(id) && !extraNames.has(id) };
  };

  // A team is on bye when none of its players has a game this week. Needs a full slate to be trustworthy.
  const teamsPlaying = new Set([...projections.values()].filter((p) => p.playing && p.team).map((p) => p.team));
  const slateKnown = teamsPlaying.size >= 10;
  const markBye = (p) => { p.bye = Boolean(slateKnown && p.team && !p.playing && !teamsPlaying.has(p.team) && !p.cut); return p; };
  for (const p of projections.values()) markBye(p);
  const mine = myIds.map(lookup).map(markBye);
  // Must drop: cut from their NFL team, or out for the season. They can't help, so say so plainly.
  const mustDrop = mine
    .map((p) => {
      if (p.cut) return { player: p, reason: 'Not on an NFL team (cut or released)' };
      const text = `${p.bodyPart || ''} ${p.note || ''}`;
      // Sleeper's injury notes are short ('Surgery', 'Fracture'), so surgery on IR counts as season-ending.
      const surgeryOnIR = ['IR', 'PUP'].includes(p.status) && /surgery/i.test(text);
      if ((['Out', 'IR', 'PUP'].includes(p.status) && SEASON_ENDING.test(text)) || surgeryOnIR) {
        return { player: p, reason: `Likely out for the season${p.note ? `: ${p.note}` : ''}` };
      }
      return null;
    })
    .filter(Boolean);
  const mustDropIds = new Set(mustDrop.map((m) => m.player.id));
  const active = mine.filter((p) => !reserve.has(p.id));
  const eligible = active.filter((p) => SLOT_ELIGIBILITY[p.pos]);

  // Lineup
  const best = optimizeLineup(slots, eligible);
  const bestTotal = lineupTotal(best);
  const startersNow = (roster.starters || []).map(String);
  // roster.starters lines up with every non-bench slot, including IDP slots we skip.
  const starterIdAt = [];
  (league.roster_positions || []).filter((s) => !['BN', 'IR', 'TAXI'].includes(s))
    .forEach((s, i) => { if (SLOT_ELIGIBILITY[s]) starterIdAt.push(startersNow[i]); });
  const currentLineup = slots.map((slot, i) => {
    const id = starterIdAt[i];
    const player = id && id !== '0' ? lookup(id) : null;
    return { slot, index: i, player };
  });
  const currentTotal = lineupTotal(currentLineup);
  const gain = round1(bestTotal - currentTotal);
  const hasCurrent = startersNow.length > 0;
  const bestIds = new Set(best.map((s) => s.player?.id).filter(Boolean));
  const startsZero = currentLineup.some((s) => s.player && s.player.adj <= 0 && !bestIds.has(s.player.id));
  const changesNeeded = !hasCurrent || gain >= MARGINAL_POINTS || startsZero;
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
    .filter((n) => !mustDropIds.has(n.player.id) && (n.issue || n.trendDrop > dropAlertThreshold))
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
    const popular = (p.rostered ?? 0) >= POPULAR_FREE_AGENT;
    if ((trendAdd.has(p.id) || popular) && !shortlist.includes(p) && shortlist.length < 80) shortlist.push(p);
  }

  const pickups = [];
  for (const fa of shortlist) {
    const withFa = optimizeLineup(slots, [...eligible, fa]);
    const delta = round1(lineupTotal(withFa) - bestTotal);
    const starts = withFa.some((s) => s.player?.id === fa.id);
    const keep = new Set(withFa.map((s) => s.player?.id).filter(Boolean));
    // A player on bye projects for zero but is coming back, so he is never the suggested drop.
    const drop = eligible
      .filter((p) => !keep.has(p.id) && !p.bye)
      .sort((a, b) => rank(a) - rank(b) || a.proj - b.proj)[0] || null;
    const adds = trendAdd.get(fa.id) || 0;
    const popular = (fa.rostered ?? 0) >= POPULAR_FREE_AGENT;
    if (!(starts && delta >= MARGINAL_POINTS) && adds === 0 && !popular) continue;
    pickups.push({ player: fa, delta, starts, drop, adds });
  }
  pickups.sort((a, b) => b.delta - a.delta || (b.player.rostered ?? 0) - (a.player.rostered ?? 0) || b.adds - a.adds || b.player.adj - a.player.adj);

  // Cut or season-ending players are the first drops, ahead of the lowest-projected bench player.
  mustDrop.forEach((m, i) => { if (pickups[i]) pickups[i].drop = m.player; });

  return {
    mustDrop,
    lineup,
    bench,
    bestTotal: round1(bestTotal),
    currentTotal: round1(currentTotal),
    gain: changesNeeded ? Math.max(gain, 0) : 0,
    changesNeeded,
    hasCurrent,
    unsupported,
    news,
    ir: mine.filter((p) => reserve.has(p.id)),
    pickups: pickups.slice(0, 12),
  };
}
