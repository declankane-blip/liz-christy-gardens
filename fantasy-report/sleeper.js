// Thin client for Sleeper's public, read-only API (no key needed; CORS-enabled).
const API = 'https://api.sleeper.app/v1';
const PROJ = 'https://api.sleeper.com/projections/nfl';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `position[]=${p}`).join('&');

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper request failed (${res.status})`);
  return res.json();
}

export const getUser = (username) => getJSON(`${API}/user/${encodeURIComponent(username)}`);
export const getState = () => getJSON(`${API}/state/nfl`);
export const getLeagues = (userId, season) => getJSON(`${API}/user/${userId}/leagues/nfl/${season}`);
export const getLeague = (id) => getJSON(`${API}/league/${id}`);
export const getRosters = (id) => getJSON(`${API}/league/${id}/rosters`);
export const getProjections = (season, week) =>
  getJSON(`${PROJ}/${season}/${week}?season_type=regular&${POSITIONS}`);

export async function getTrending() {
  const [add, drop] = await Promise.all(
    ['add', 'drop'].map((t) => getJSON(`${API}/players/nfl/trending/${t}?lookback_hours=48&limit=100`).catch(() => [])),
  );
  return { add, drop };
}
