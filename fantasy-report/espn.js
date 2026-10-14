// ESPN fantasy client. Goes through /api/espn (see api/espn.js) because browsers can't call
// ESPN with login cookies directly, which private leagues need.
const FA_SLOTS = [0, 2, 4, 6, 16, 17];

async function call(year, leagueId, params, { filter, cookies } = {}) {
  const q = new URLSearchParams({ path: `/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}` });
  for (const [k, v] of params) q.append(k, v);
  const headers = {};
  if (filter) headers['X-Fantasy-Filter'] = JSON.stringify(filter);
  if (cookies?.s2 && cookies?.swid) {
    headers['X-Espn-S2'] = cookies.s2;
    headers['X-Espn-Swid'] = cookies.swid;
  }
  const res = await fetch(`/api/espn?${q}`, { headers });
  if (res.status === 401 || res.status === 403) {
    throw new Error(cookies?.s2
      ? 'ESPN rejected your cookies. Re-copy espn_s2 and SWID from your browser.'
      : 'This ESPN league is private. Add your espn_s2 and SWID cookies under "Private league?".');
  }
  if (res.status === 404) throw new Error('ESPN league not found. Check the league ID.');
  if (!res.ok) throw new Error(`ESPN request failed (${res.status})`);
  return res.json();
}

export const seasonYear = (now = new Date()) => (now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear());

export const getLeague = (year, id, cookies) =>
  call(year, id, [['view', 'mSettings'], ['view', 'mTeam'], ['view', 'mRoster']], { cookies });

export function getFreeAgents(year, id, week, cookies) {
  const filter = {
    players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
      filterSlotIds: { value: FA_SLOTS },
      filterRanksForScoringPeriodIds: { value: [week] },
      limit: 200,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${year}`, `10${year}`, `11${year}${week}`] },
    },
  };
  return call(year, id, [['view', 'kona_player_info'], ['scoringPeriodId', String(week)]], { filter, cookies });
}
