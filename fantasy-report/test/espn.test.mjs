import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptEspn } from '../espn-adapter.js';
import { buildReport } from '../analysis.js';

const W = 6;
const pool = (id, pos, pts, extra = {}) => ({
  playerId: id, lineupSlotId: extra.slot ?? 20,
  playerPoolEntry: { player: { id, fullName: `P${id}`, defaultPositionId: pos, proTeamId: 17, injuryStatus: extra.inj || 'ACTIVE',
    stats: extra.bye ? [] : [{ scoringPeriodId: W, statSourceId: 1, statSplitTypeId: 1, appliedTotal: pts }] } },
});
const leagueData = {
  settings: { rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 5, 21: 1 } } },
  teams: [
    { id: 1, name: 'Mine', roster: { entries: [
      pool(1, 1, 20, { slot: 0 }), pool(2, 2, 15, { slot: 2 }), pool(3, 2, 14, { slot: 2 }),
      pool(4, 3, 12, { slot: 4 }), pool(5, 3, 3, { slot: 4, inj: 'OUT' }), pool(6, 4, 9, { slot: 6 }),
      pool(7, 2, 8, { slot: 23 }), pool(8, 3, 11, { slot: 20 }), pool(9, 16, 7, { slot: 16 }), pool(10, 5, 8, { slot: 17 }),
      pool(11, 2, 4, { slot: 20, bye: true }),
    ] } },
    { id: 2, name: 'Other', roster: { entries: [pool(99, 1, 18)] } },
  ],
};
const freeAgentData = { players: [
  { id: 50, player: { ...pool(50, 3, 16).playerPoolEntry.player, ownership: { percentChange: 4.2 } } },
  { id: 51, player: { ...pool(51, 4, 2).playerPoolEntry.player, ownership: { percentChange: -1 } } },
] };

test('adapts ESPN data and reports start/sit plus waiver pickup', () => {
  const a = adaptEspn({ leagueData, freeAgentData, teamId: 1, week: W });
  assert.deepEqual(a.league.roster_positions.slice(0, 8), ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF']);
  assert.equal(a.roster.starters[4], '5'); // second WR slot holds the OUT player
  const rep = buildReport({ ...a, roster: a.roster, dropAlertThreshold: Infinity });
  const wrs = rep.lineup.filter((s) => s.slot === 'WR');
  assert.ok(wrs.some((s) => s.changed && s.current.id === '5' && s.player.id === '8'));
  assert.equal(rep.pickups[0].player.id, '50');
  assert.equal(rep.pickups[0].adds, 4.2);
  assert.ok(rep.news.some((n) => n.player.id === '5') && rep.news.some((n) => n.player.id === '11'));
});
