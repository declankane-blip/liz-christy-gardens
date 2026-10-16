import * as sleeper from './sleeper.js';
import { buildPlayers, buildReport } from './analysis.js';
import * as espn from './espn.js';
import { adaptEspn, enrichInjuries, teamLabel } from './espn-adapter.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const setStatus = (msg, error = false) => { $('status').textContent = msg; $('status').className = error ? 'error' : ''; };
// Any failure shows its real message on the page (and in the console) so it can be reported.
const fail = (err) => { console.error(err); setStatus(`Something went wrong: ${err?.message || err}`, true); };
window.addEventListener('error', (e) => fail(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => fail(e.reason));

let state = null;
let user = null;

$('lookup').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('leagues').hidden = true;
  $('report').hidden = true;
  try {
    setStatus('Looking up your leagues...');
    const name = $('username').value.trim();
    [user, state] = await Promise.all([sleeper.getUser(name), sleeper.getState()]);
    if (!user?.user_id) throw new Error(`No Sleeper user named "${name}"`);
    const leagues = await sleeper.getLeagues(user.user_id, state.league_season || state.season);
    if (!leagues?.length) throw new Error(`No ${state.league_season} NFL leagues found for ${name}`);
    $('league-list').innerHTML = leagues
      .map((l, i) => `<button class="league" data-i="${i}">${esc(l.name)}<small>${l.total_rosters} teams</small></button>`)
      .join('');
    $('league-list').onclick = (ev) => {
      const b = ev.target.closest('button.league');
      if (b) run(leagues[b.dataset.i]);
    };
    $('leagues').hidden = false;
    setStatus('');
  } catch (err) {
    fail(err);
  }
});

async function run(summary) {
  $('report').hidden = true;
  try {
    setStatus(`Building report for ${summary.name}...`);
    const season = state.league_season || state.season;
    const week = state.season_type === 'regular' ? state.week : 1;
    const [league, allRosters, rows, trending] = await Promise.all([
      sleeper.getLeague(summary.league_id),
      sleeper.getRosters(summary.league_id),
      sleeper.getProjections(season, week),
      sleeper.getTrending(),
    ]);
    const roster = allRosters.find((r) => r.owner_id === user.user_id || (r.co_owners || []).includes(user.user_id));
    if (!roster) throw new Error('Could not find your roster in this league');
    const projections = buildPlayers(rows, league.scoring_settings);

    // Players on a bye have no projection this week; borrow names from a neighbouring week.
    const extraNames = new Map();
    let neighboursLoaded = false;
    const missing = (roster.players || []).filter((id) => !projections.has(String(id)));
    if (missing.length) {
      const neighbours = await Promise.all(
        [week + 1, week - 1].filter((w) => w >= 1).map((w) => sleeper.getProjections(season, w).catch(() => [])),
      );
      neighboursLoaded = neighbours.every((rows) => rows.length > 0);
      for (const p of neighbours.flatMap((rows) => [...buildPlayers(rows, league.scoring_settings).values()])) {
        extraNames.set(p.id, p);
      }
    }
    render(summary.name, week, buildReport({ league, roster, allRosters, projections, extraNames, trending, missingMeansCut: neighboursLoaded }));
    setStatus('');
  } catch (err) {
    fail(err);
  }
}

const matchup = (p) => (p.playing ? (p.opp ? `${p.team} vs ${p.opp}` : `${p.team || ''}`) : p.bye ? `${p.team} · BYE WEEK` : `${p.team || 'No team'} · no game`);
const pts = (n) => (typeof n === 'number' ? n.toFixed(1) : '-');

function playerLine(p, extra = '', tone = '') {
  const flag = (p.bye ? ' <span class="tag warn">BYE</span>' : '') + (p.status ? ` <span class="tag warn">${esc(p.status)}</span>` : '');
  return `<span class="who ${tone ? `tone-${tone}` : ''}"><span class="nm">${esc(p.name)}</span>${flag}<small>${esc(p.pos)} · ${esc(matchup(p))}${p.rostered != null ? ` · ${p.rostered}% rostered` : ''}${p.trendNote ? ` · ${p.trendNote}` : ''}${extra}</small></span>`;
}

function render(leagueName, week, r, trendUnit = 'adds') {
  const summary = !r.hasCurrent
    ? `Your best lineup projects to <b>${pts(r.bestTotal)}</b> points.`
    : r.changesNeeded
      ? `Make the changes below: <b>+${pts(r.gain)}</b> projected points (${pts(r.currentTotal)} to ${pts(r.bestTotal)}).`
      : `Your lineup is already set: ${pts(r.currentTotal)} projected points. No change is worth more than a point.`;

  const lineup = r.lineup.map((s) => `
    <div class="row"><span class="slot">${esc(s.slot.replace('_', ' '))}</span>
      ${s.player ? playerLine(s.player, s.changed && s.current ? ` · replaces ${esc(s.current.name)}` : '') : `<span class="who muted">Open: no one eligible is projected for points${s.current ? ` (bench ${esc(s.current.name)})` : ''}</span>`}
      ${s.changed && s.player ? '<span class="tag start">START</span>' : ''}
      <span class="pts">${pts(s.player?.adj)}</span></div>`).join('');

  const benchRows = r.bench.map((p) => {
    const sat = r.lineup.some((s) => s.current?.id === p.id);
    return `<div class="row"><span class="slot"></span>${playerLine(p)}${sat ? '<span class="tag sit">SIT</span>' : ''}<span class="pts">${pts(p.adj)}</span></div>`;
  }).join('');

  const news = r.news.length
    ? r.news.map((n) => `<div class="row">${playerLine(n.player)}
        <span class="who muted">${esc(n.issue || `Dropped by many managers (${n.trendDrop.toLocaleString()} in 48h)`)}${n.onIR ? ' · on your IR' : ''}</span>
        ${n.starting ? '<span class="tag warn">STARTING</span>' : ''}</div>`).join('')
    : '<div class="row muted">No injury or bye issues on your roster.</div>';

  const pickups = r.pickups.length
    ? r.pickups.map((u) => `<div class="row"><span class="tag add">ADD</span>${playerLine(u.player, u.adds ? (trendUnit === 'pct' ? ` · +${u.adds}% rostered this week` : ` · ${u.adds.toLocaleString()} adds in 48h`) : '', 'add')}
        <span class="who muted">${u.starts && u.delta >= 1 ? `Would start: +${pts(u.delta)} pts` : 'Trending, not a starter for you'}${u.drop ? `<small class="drop-text">Drop: ${esc(u.drop.name)} (${pts(u.drop.adj)})</small>` : ''}</span>
        <span class="pts">${pts(u.player.adj)}</span></div>`).join('')
    : '<div class="row muted">Nothing on waivers would improve your lineup this week.</div>';

  const mustDrop = r.mustDrop.length
    ? `<h2>Must drop</h2><div class="card">${r.mustDrop.map((m) => `<div class="row">${playerLine(m.player, '', 'drop')}<span class="who muted">${esc(m.reason)}</span><span class="tag drop">DROP</span></div>`).join('')}</div>`
    : '';

  const ir = r.ir.length ? `<p class="muted">IR / taxi: ${r.ir.map((p) => esc(p.name)).join(', ')}</p>` : '';
  const unsupported = r.unsupported.length ? `<p class="muted">Not analysed (IDP slots): ${esc(r.unsupported.join(', '))}</p>` : '';

  $('report').innerHTML = `
    <h2>${esc(leagueName)} · Week ${week}</h2>
    <div class="summary">${summary}</div>
    ${mustDrop}
    <h2>Start / sit</h2><div class="card">${lineup}</div>
    <h2>Bench</h2><div class="card">${benchRows || '<div class="row muted">Empty bench</div>'}</div>${ir}${unsupported}
    <h2>Player news</h2><div class="card">${news}</div>
    <h2>Waiver pickups</h2><div class="card">${pickups}</div>
    <p class="muted">Projected points use your league's scoring and are reduced for injury designations. Roster % (ESPN) or add/drop trends (Sleeper) break close calls, worth up to 1.5 points, and surface popular free agents.</p>`;
  $('report').hidden = false;
  $('report').scrollIntoView({ behavior: 'smooth' });
}

// ---------- ESPN ----------
let platform = 'sleeper';
document.querySelectorAll('[data-platform]').forEach((b) => b.addEventListener('click', () => {
  platform = b.dataset.platform;
  document.querySelectorAll('[data-platform]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  $('lookup').hidden = platform !== 'sleeper';
  $('espn-form').hidden = platform !== 'espn';
  $('leagues').hidden = true;
  $('report').hidden = true;
  setStatus('');
}));

$('espn-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('leagues').hidden = true;
  $('report').hidden = true;
  const id = $('espn-id').value.trim();
  const cookies = { s2: $('espn-s2').value.trim(), swid: $('espn-swid').value.trim() };
  const year = espn.seasonYear();
  try {
    setStatus('Loading your ESPN league...');
    const leagueData = await espn.getLeague(year, id, cookies);
    const teams = leagueData.teams || [];
    $('league-list').innerHTML = teams
      .map((t) => `<button class="league" data-i="${t.id}">${esc(teamLabel(t))}<small>${esc(leagueData.settings?.name || 'ESPN league')}</small></button>`)
      .join('');
    $('league-list').onclick = (ev) => {
      const b = ev.target.closest('button.league');
      if (b) runEspn({ year, id, cookies, leagueData, teamId: b.dataset.i, name: teamLabel(teams.find((t) => t.id === Number(b.dataset.i))) });
    };
    document.querySelector('#leagues h2').textContent = 'Pick your team';
    $('leagues').hidden = false;
    setStatus('');
  } catch (err) {
    fail(err);
  }
});

async function runEspn({ year, id, cookies, leagueData, teamId, name }) {
  $('report').hidden = true;
  try {
    setStatus(`Building report for ${name}...`);
    const week = leagueData.scoringPeriodId;
    const mineIds = (leagueData.teams.find((t) => t.id === Number(teamId))?.roster?.entries || []).map((e) => e.playerId);
    // Waivers and roster projections are best effort: a failure here should not kill the whole report.
    const [freeAgentData, rosterPlayerData] = await Promise.all([
      espn.getFreeAgents(year, id, week, cookies).catch((e) => { console.error(e); return { players: [] }; }),
      mineIds.length ? espn.getPlayersById(year, id, week, mineIds, cookies).catch((e) => { console.error(e); return []; }) : [],
    ]);
    const a = adaptEspn({ leagueData, freeAgentData, rosterPlayerData, teamId, week });
    // ESPN has no injury notes; Sleeper's public data does. Best effort, never blocks the report.
    enrichInjuries(a.projections, await sleeper.getProjections(year, week).catch(() => []));
    render(name, week, buildReport({ ...a, dropAlertThreshold: Infinity }), 'pct');
    setStatus('');
  } catch (err) {
    fail(err);
  }
}
