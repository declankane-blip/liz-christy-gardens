# Weekly Fantasy Report

Pick Sleeper or ESPN. For Sleeper enter your username; for ESPN enter your league ID and pick your team. Then you get this week's:

- **Start / sit**: the best lineup for your league's slots (including FLEX and superflex) using your league's own scoring, with each swap and the points it gains. Swaps worth under a point are left alone.
- **Player news**: injury designations (with body part/notes), byes, and players managers are dropping, flagged when they're in your lineup.
- **Waiver pickups**: free agents who would actually crack your lineup, the points gained, who to drop, and who is trending on Sleeper.

No build and no API keys. Sleeper is called straight from the browser. ESPN has no official API, so the app uses ESPN's unofficial one through `api/espn.js` (a Vercel function). Private ESPN leagues need your `espn_s2` and `SWID` cookies; they are forwarded for one request and never stored. Yahoo isn't supported. IDP slots are not analysed.

ESPN support was written from ESPN's known response format and unit-tested on fixtures, but not yet run against a live ESPN league.

## Run

    node dev-server.mjs   # from this folder, then open http://localhost:8000/

## Test

    node --test test/*.test.mjs

## Deploy (as its own site)

In Vercel: Add New > Project > import this GitHub repo > set **Root Directory** to `fantasy-report` > Deploy. No other settings needed.
