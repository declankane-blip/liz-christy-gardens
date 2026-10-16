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

test('roster % breaks a near tie but not a clear projection gap', () => {
  const mk = (id, adj, rostered) => ({ id, pos: 'WR', adj, proj: adj, rostered });
  const slots = ['WR'];
  assert.equal(optimizeLineup(slots, [mk('a', 10.0, 20), mk('b', 9.8, 95)])[0].player.id, 'b');
  assert.equal(optimizeLineup(slots, [mk('a', 12.0, 20), mk('b', 9.8, 95)])[0].player.id, 'a');
});

test('popular free agent surfaces even without a lineup gain', () => {
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'RB', 14), row('4', 'RB', 13), row('5', 'WR', 12), row('9', 'WR', 6)];
  const projections = buildPlayers(rows, {});
  projections.get('9').rostered = 72;
  const roster = { players: ['1', '2', '3', '4', '5'], starters: ['1', '2', '3', '5', '4'] };
  const rep = buildReport({ league, roster, allRosters: [roster], projections });
  assert.equal(rep.pickups[0].player.id, '9');
});

test('never starts a zero-point player; leaves the slot open and benches him', () => {
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'RB', 14), row('5', 'WR', 9, { noGame: true }), row('4', 'RB', 5)];
  const projections = buildPlayers(rows, {});
  const roster = { players: ['1', '2', '3', '4', '5'], starters: ['1', '2', '3', '5', '4'] };
  const rep = buildReport({ league, roster, allRosters: [roster], projections });
  assert.equal(rep.changesNeeded, true);
  assert.ok(rep.lineup.every((s) => !s.player || s.player.adj > 0));
  const wr = rep.lineup.find((s) => s.slot === 'WR');
  assert.equal(wr.player, null);
  assert.equal(wr.current.id, '5');
  assert.ok(rep.bench.some((p) => p.id === '5'));
});

test('cut and season-ending players are listed as must drop and used as the drop suggestion', () => {
  const mk = (id, pos, pts, over = {}) => ({ ...row(id, pos, pts), ...over });
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'RB', 14), row('4', 'RB', 5), row('5', 'WR', 12), row('8', 'WR', 18), row('9', 'WR', 6)];
  const projections = buildPlayers(rows, {});
  projections.get('9').status = 'IR';
  projections.get('9').note = 'Torn ACL, season-ending';
  projections.get('9').adj = 0;
  projections.get('4').cut = true;
  const roster = { players: ['1', '2', '3', '4', '5', '9'], starters: ['1', '2', '3', '5', '4'] };
  const rep = buildReport({ league, roster, allRosters: [roster], projections });
  assert.deepEqual(rep.mustDrop.map((m) => m.player.id).sort(), ['4', '9']);
  assert.ok(rep.mustDrop.every((m) => m.reason));
  assert.ok(!rep.news.some((n) => ['4', '9'].includes(n.player.id)));
  assert.ok(['4', '9'].includes(rep.pickups[0].drop.id));
});

test('players missing from every week are cut only when neighbouring weeks loaded', () => {
  const projections = buildPlayers([row('1', 'QB', 20)], {});
  const roster = { players: ['1', '777'], starters: ['1'] };
  const l = { roster_positions: ['QB', 'BN'], scoring_settings: {} };
  assert.equal(buildReport({ league: l, roster, allRosters: [roster], projections }).mustDrop.length, 0);
  assert.equal(buildReport({ league: l, roster, allRosters: [roster], projections, missingMeansCut: true }).mustDrop.length, 1);
});

test('surgery on IR counts as out for the season, a short IR stint does not', () => {
  const rows = [row('1', 'QB', 20), row('5', 'WR', 9, { status: 'IR' }), row('6', 'WR', 8, { status: 'IR' })];
  const projections = buildPlayers(rows, {});
  projections.get('5').note = 'Surgery';
  projections.get('6').note = 'Strain';
  const roster = { players: ['1', '5', '6'], starters: ['1'], reserve: ['6'] };
  const l = { roster_positions: ['QB', 'BN', 'IR'], scoring_settings: {} };
  const rep = buildReport({ league: l, roster, allRosters: [roster], projections });
  assert.deepEqual(rep.mustDrop.map((m) => m.player.id), ['5']);
});

test('a player on IR is not must-drop unless cut or out for the season', () => {
  const rows = [row('1', 'QB', 20), row('5', 'WR', 9, { status: 'IR' }), row('6', 'WR', 8, { status: 'IR' })];
  const projections = buildPlayers(rows, {});
  projections.get('5').bodyPart = 'Ankle';
  projections.get('5').note = 'Sprain';
  projections.get('6').bodyPart = 'Knee - ACL';
  projections.get('6').note = 'Surgery';
  const l = { roster_positions: ['QB', 'BN', 'BN'], scoring_settings: {} };
  const roster = { players: ['1', '5', '6'], starters: ['1'] };
  const rep = buildReport({ league: l, roster, allRosters: [roster], projections });
  assert.deepEqual(rep.mustDrop.map((m) => m.player.id), ['6']);
  assert.ok(rep.news.some((n) => n.player.id === '5'));
});

test('marks players whose team has no game as on bye, but not injured players on teams that play', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ ...row(`t${i}`, 'WR', 10), team: `T${i}` });
  rows.push({ ...row('9', 'QB', 20), team: 'T0' });
  rows.push({ ...row('7', 'RB', 0, { noGame: true }), team: 'BYE' });
  rows.push({ ...row('8', 'RB', 0, { noGame: true, status: 'IR' }), team: 'T1' });
  const projections = buildPlayers(rows, {});
  const roster = { players: ['9', '7', '8'], starters: ['9'] };
  const l = { roster_positions: ['QB', 'BN', 'BN'], scoring_settings: {} };
  const rep = buildReport({ league: l, roster, allRosters: [roster], projections });
  assert.equal(projections.get('7').bye, true);
  assert.equal(projections.get('8').bye, false);
  const byeNews = rep.news.find((n) => n.player.id === '7');
  assert.equal(byeNews.issue, 'On bye this week');
  assert.match(rep.news.find((n) => n.player.id === '8').issue, /^IR/);
});

test('a player on bye is never suggested as the drop', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ ...row(`t${i}`, 'WR', 10), team: `T${i}` });
  rows.push({ ...row('1', 'QB', 20), team: 'T0' });
  rows.push({ ...row('2', 'RB', 15), team: 'T2' });
  rows.push({ ...row('3', 'RB', 14), team: 'T3' });
  rows.push({ ...row('4', 'RB', 3), team: 'T4' });
  rows.push({ ...row('5', 'WR', 12), team: 'T5' });
  rows.push({ ...row('6', 'WR', 0, { noGame: true }), team: 'BYE' });
  rows.push({ ...row('8', 'WR', 18), team: 'T8' });
  const projections = buildPlayers(rows, {});
  const roster = { players: ['1', '2', '3', '4', '5', '6'], starters: ['1', '2', '3', '5', '4'] };
  const rep = buildReport({ league, roster, allRosters: [roster], projections });
  const top = rep.pickups.find((p) => p.player.id === '8');
  assert.ok(top.drop, 'has a drop suggestion');
  assert.notEqual(top.drop.id, '6');
  assert.ok(rep.bench.some((p) => p.id === '6' && p.bye));
});

test('without roster %, Sleeper add/drop trends break near ties but not clear gaps', () => {
  const rows = [row('1', 'WR', 10.0), row('2', 'WR', 9.7)];
  const slots = ['WR'];
  const mk = (extra) => {
    const projections = buildPlayers(rows, {});
    const roster = { players: ['1', '2'], starters: [] }; // no lineup set yet, so the best one is built fresh
    return buildReport({ league: { roster_positions: ['WR', 'BN'], scoring_settings: {} }, roster, allRosters: [roster], projections, ...extra });
  };
  const flat = mk({});
  assert.equal(flat.lineup[0].player.id, '1');
  const trending = mk({ trending: { add: [{ player_id: '2', count: 90000 }], drop: [{ player_id: '1', count: 90000 }] } });
  assert.equal(trending.lineup[0].player.id, '2'); // within a point, momentum wins
  assert.equal(trending.lineup[0].player.trendNote, 'trending up');
  const gap = buildPlayers([row('1', 'WR', 14), row('2', 'WR', 9.7)], {});
  const roster = { players: ['1', '2'], starters: ['2'] };
  const clear = buildReport({ league: { roster_positions: ['WR', 'BN'], scoring_settings: {} }, roster, allRosters: [roster], projections: gap,
    trending: { add: [{ player_id: '2', count: 90000 }], drop: [{ player_id: '1', count: 90000 }] } });
  assert.equal(clear.lineup[0].player.id, '1'); // a 4-point gap is not overridden
});

test('drop suggestion is the lowest roster rate on the bench, never an IR player', () => {
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'RB', 14), row('4', 'RB', 13), row('5', 'WR', 12),
    row('6', 'WR', 6), row('7', 'WR', 7), row('8', 'WR', 4, { status: 'IR' }), row('9', 'WR', 18)];
  const projections = buildPlayers(rows, {});
  projections.get('6').rostered = 80; // low points, but widely rostered
  projections.get('7').rostered = 12; // better points, barely rostered -> the drop
  projections.get('8').rostered = 1;  // IR, lowest rate of all, but must not be suggested
  const roster = { players: ['1', '2', '3', '4', '5', '6', '7', '8'], starters: ['1', '2', '3', '5', '4'] };
  const rep = buildReport({ league, roster, allRosters: [roster], projections });
  const pickup = rep.pickups.find((p) => p.player.id === '9');
  assert.equal(pickup.drop.id, '7');
});

test('players already starting are never swapped between slots', () => {
  // Optimal assignment would put the 12-pt newcomer in WR1 and the current WR1 in WR2.
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'RB', 14), row('4', 'WR', 10), row('5', 'WR', 9), row('6', 'WR', 12)];
  const projections = buildPlayers(rows, {});
  const roster = { players: ['1', '2', '3', '4', '5', '6'], starters: ['1', '2', '3', '4', '5'] };
  const l = { roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'BN'], scoring_settings: {} };
  const rep = buildReport({ league: l, roster, allRosters: [roster], projections });
  const wrs = rep.lineup.filter((s) => s.slot === 'WR');
  assert.deepEqual(wrs.map((s) => s.player.id), ['4', '6']);
  assert.equal(wrs[0].changed, false);
  assert.equal(wrs[1].changed, true);
  assert.equal(wrs[1].current.id, '5');
  assert.equal(rep.lineup.filter((s) => s.changed).length, 1);
});

test('a flex starter who also fits a WR slot is not shuffled', () => {
  const rows = [row('1', 'QB', 20), row('2', 'RB', 15), row('3', 'WR', 14), row('4', 'WR', 12), row('5', 'RB', 11), row('6', 'WR', 16)];
  const projections = buildPlayers(rows, {});
  // WR slot holds 3, FLEX holds 4; benched 5 is worse than 6. 6 should replace 4 in FLEX only.
  const roster = { players: ['1', '2', '3', '4', '5', '6'], starters: ['1', '2', '3', '4'] };
  const l = { roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'], scoring_settings: {} };
  const rep = buildReport({ league: l, roster, allRosters: [roster], projections });
  assert.equal(rep.lineup.filter((s) => s.changed).length, 1);
  assert.equal(rep.lineup.find((s) => s.slot === 'WR').player.id, '3');
});
