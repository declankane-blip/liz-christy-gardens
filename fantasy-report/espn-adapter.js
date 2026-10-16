// Converts ESPN's fantasy API responses into the shapes analysis.js expects.
import { adjustedPoints } from './analysis.js';

const SLOT_NAMES = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 3: 'WRRB_FLEX', 5: 'REC_FLEX', 7: 'SUPER_FLEX', 16: 'DEF', 17: 'K', 20: 'BN', 21: 'IR' };
const SLOT_ORDER = [0, 2, 4, 6, 23, 3, 5, 7, 16, 17, 8, 9, 10, 11, 12, 13, 14, 15, 20, 21];
const POSITIONS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const INJURY = { QUESTIONABLE: 'Questionable', DAY_TO_DAY: 'Questionable', DOUBTFUL: 'Doubtful', OUT: 'Out', INJURY_RESERVE: 'IR', SUSPENSION: 'Sus' };
const TEAMS = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC',
  13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
  24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

const round1 = (n) => Math.round(n * 10) / 10;

/** The projected-points entry for this scoring period (source 1 = projection, split 1 = single week). */
function weekProjection(player, week) {
  return (player.stats || []).find((s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && s.scoringPeriodId === week);
}

export function toPlayer(poolEntry, week) {
  const p = poolEntry.player || poolEntry;
  const pos = POSITIONS[p.defaultPositionId];
  if (!pos) return null;
  const projection = weekProjection(p, week);
  const proj = projection ? projection.appliedTotal || 0 : 0;
  const status = INJURY[p.injuryStatus] || null;
  const playing = Boolean(projection);
  return {
    id: String(p.id),
    name: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim(),
    pos,
    team: TEAMS[p.proTeamId] || null,
    opp: null,
    playing,
    proj: round1(proj),
    adj: adjustedPoints(proj, status, playing),
    status,
    note: null,
    bodyPart: null,
    recentNews: false,
    cut: p.proTeamId === 0,
    rostered: typeof p.ownership?.percentOwned === 'number' ? round1(p.ownership.percentOwned) : null,
  };
}

export function leagueFromEspn(data) {
  const counts = data.settings?.rosterSettings?.lineupSlotCounts || {};
  const positions = [];
  for (const slotId of SLOT_ORDER) {
    const n = counts[slotId] || 0;
    for (let i = 0; i < n; i++) positions.push(SLOT_NAMES[slotId] || 'IDP');
  }
  return { roster_positions: positions, slotOrder: SLOT_ORDER.filter((s) => (counts[s] || 0) > 0).flatMap((s) => Array(counts[s]).fill(s)) };
}

export function teamLabel(team) {
  return team.name || [team.location, team.nickname].filter(Boolean).join(' ') || `Team ${team.id}`;
}

/**
 * leagueData: response of league endpoint with mSettings+mTeam+mRoster views
 * freeAgentData: response of kona_player_info view ({ players: [...] }) for free agents/waivers
 */
export function adaptEspn({ leagueData, freeAgentData, rosterPlayerData, teamId, week }) {
  const league = leagueFromEspn(leagueData);
  const projections = new Map();
  // The roster view doesn't always carry this week's projection; backfill from a by-id lookup.
  const backfill = new Map();
  for (const entry of rosterPlayerData?.players || rosterPlayerData || []) {
    const p = toPlayer(entry, week);
    if (p) backfill.set(p.id, p);
  }
  const toRoster = (team) => {
    const entries = team.roster?.entries || [];
    const ids = [];
    for (const e of entries) {
      if (!e.playerPoolEntry) { ids.push(String(e.playerId)); continue; }
      let player = toPlayer(e.playerPoolEntry, week);
      const extra = player && backfill.get(player.id);
      if (player && !player.playing && extra?.playing) player = { ...player, proj: extra.proj, adj: extra.adj, playing: true };
      if (player && player.rostered == null && extra?.rostered != null) player = { ...player, rostered: extra.rostered };
      if (player) projections.set(player.id, player);
      ids.push(String(e.playerId));
    }
    const bySlot = {};
    for (const e of entries) (bySlot[e.lineupSlotId] ||= []).push(String(e.playerId));
    const used = {};
    const starters = league.slotOrder
      .filter((s) => s !== 20 && s !== 21)
      .map((s) => bySlot[s]?.[(used[s] = (used[s] ?? -1) + 1)] || '0');
    const reserve = entries.filter((e) => e.lineupSlotId === 21).map((e) => String(e.playerId));
    return { id: team.id, players: ids, starters, reserve };
  };
  const rosters = (leagueData.teams || []).map(toRoster);
  const mine = rosters.find((r) => r.id === Number(teamId));
  if (!mine) throw new Error('Could not find that team in the ESPN league data.');

  const trendAdd = [];
  for (const fa of freeAgentData?.players || []) {
    const player = toPlayer(fa, week);
    if (!player) continue;
    projections.set(player.id, player);
    const change = fa.player?.ownership?.percentChange;
    if (change > 0) trendAdd.push({ player_id: player.id, count: round1(change) });
  }
  // league.slotOrder is only needed internally
  delete league.slotOrder;
  return { league, roster: mine, allRosters: rosters, projections, trending: { add: trendAdd, drop: [] } };
}

const norm = (name) => String(name || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');

/**
 * ESPN's API has no injury text, so borrow it from Sleeper's projection rows (matched by name and
 * position). Only fills players ESPN already marks injured, and never overwrites existing notes.
 */
export function enrichInjuries(projections, sleeperRows) {
  const byName = new Map();
  for (const row of sleeperRows || []) {
    const p = row.player || {};
    if (!p.injury_body_part && !p.injury_notes) continue;
    const key = `${norm(`${p.first_name} ${p.last_name}`)}|${p.position}`;
    byName.set(key, { note: p.injury_notes || null, bodyPart: p.injury_body_part || null });
  }
  for (const player of projections.values()) {
    if (!player.status || player.note || player.bodyPart) continue;
    const hit = byName.get(`${norm(player.name)}|${player.pos}`);
    if (hit) Object.assign(player, hit);
  }
  return projections;
}
