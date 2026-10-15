import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayers, buildReport, optimizeLineup, scoreStats } from '../analysis.js';

const row = (id, pos, pts, extra = {}) => ({
  player_id: id, team: 'AAA', opponent: extra.noGame ? null : 'BBB',
  player: { first_name: `P${id}`, last_name: pos, position: pos, fantasy_positions: [pos], injury_status: extra.status, news_updated: null },
  stats: { pts_ppr: pts },
});
const league = { roster_positions: ['QB', 'RB', 'RB', 'WR', 'FLEX', 'BN', 'BN'], scoring_settings: {} };

test('scores from league settings, falls back to ppr', () => {
  assert.equal(scoreStats({ rec: 5, rec_yd: 50, pts_ppr: 99 }, { rec: 0.5, rec_yd: 0.1 }), 7.5);
  assert.equal(scoreStats({ pts_ppr: 12 }, {}), 12);
});

test('optimizer fills flex with best leftover and skips out players', () => {
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'RB', 14), row('4', 'RB', 13), row('5', 'WR', 9),
    row('6', 'WR', 30, { status: 'Out' })];
  const players = [...buildPlayers(rows, {}).values()];
  const lineup = optimizeLineup(['QB', 'RB', 'RB', 'WR', 'FLEX'], players);
  assert.deepEqual(lineup.map((s) => s.player.id), ['1', '2', '3', '5', '4']);
});

test('report swaps an injured starter and suggests a waiver pickup', () => {
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'RB', 14), row('4', 'RB', 5), row('5', 'WR', 12),
    row('6', 'WR', 3, { status: 'Out' }), row('7', 'WR', 11), row('8', 'WR', 18)];
  const projections = buildPlayers(rows, {});
  const roster = { players: ['1', '2', '3', '4', '5', '6'], starters: ['1', '2', '3', '6', '4'] };
  const rep = buildReport({
    league, roster, allRosters: [roster], projections,
    trending: { add: [{ player_id: '7', count: 5000 }], drop: [] },
  });
  assert.equal(rep.changesNeeded, true);
  assert.deepEqual(rep.lineup.map((s) => s.player.id), ['1', '2', '3', '5', '4']);
  assert.ok(rep.lineup[3].changed && rep.lineup[3].current.id === '6');
  assert.equal(rep.pickups[0].player.id, '8'); // best free agent would start at FLEX or WR
  assert.equal(rep.news[0].player.id, '6');
});

test('already-optimal lineup is left alone', () => {
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'RB', 14), row('4', 'RB', 5), row('5', 'WR', 12)];
  const roster = { players: ['1', '2', '3', '4', '5'], starters: ['1', '2', '3', '5', '4'] };
  const rep = buildReport({ league, roster, allRosters: [roster], projections: buildPlayers(rows, {}) });
  assert.equal(rep.changesNeeded, false);
  assert.equal(rep.pickups.length, 0);
});
