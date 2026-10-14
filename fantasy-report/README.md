# Weekly Fantasy Report

Enter your Sleeper username, pick a league, and get this week's:

- **Start / sit**: the best lineup for your league's slots (including FLEX and superflex) using your league's own scoring, with each swap and the points it gains. Swaps worth under a point are left alone.
- **Player news**: injury designations (with body part/notes), byes, and players managers are dropping, flagged when they're in your lineup.
- **Waiver pickups**: free agents who would actually crack your lineup, the points gained, who to drop, and who is trending on Sleeper.

Static site, no build, no API key. It calls Sleeper's public API from the browser. Supports Sleeper leagues only (ESPN/Yahoo have no public API). IDP slots are not analysed.

## Run

    python3 -m http.server 8000   # then open http://localhost:8000/fantasy-report/

## Test

    node --test test/
