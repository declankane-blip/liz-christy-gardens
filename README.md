# Liz Christy Garden website

Static site (no build step), ready for Vercel.

```
index.html      page markup (all five views: home, visit, history, volunteer, donate)
css/styles.css  styles
js/main.js      hash router, open-hours status, copy-address button
fonts/          Young Serif and Karla, self-hosted
images/         site photos
open-hours.ics  calendar file visitors can add to their phone
share.png       link-preview image
vercel.json     Vercel config
```

## Run locally

    python3 -m http.server 8000   # then open http://localhost:8000

## Deploy

Import this repo in Vercel (Add New > Project > Deploy, no settings needed), or run `vercel --prod`.

## After the first deploy

- If your address is not https://liz-christy-garden.vercel.app, replace it in the four lines near the top of `index.html` that contain it. Link previews depend on it.
- Test the link preview at https://developers.facebook.com/tools/debug ("Scrape Again").
- There are no sign-up forms. Volunteering needs none (people walk in on an open day), and a public site has nowhere to store emails without a service like Mailchimp or Buttondown.
- If open hours change, edit the hours in `index.html`, `js/main.js` (`nextOpen` and the status block), and `open-hours.ics`.
- Analytics: create a free GoatCounter account and follow the note in the `<head>` of `index.html`.
