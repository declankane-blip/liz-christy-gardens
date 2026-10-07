# Liz Christy Garden website

Static site (no build step), ready for Vercel.

```
index.html      page markup (all five views: home, visit, history, volunteer, donate)
css/styles.css  styles
js/main.js      hash router, analytics tracking, sign-up forms
images/         site photos (extracted from the old single-file version)
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
- The email sign-up forms need an email service (Mailchimp, Buttondown, a Google Form) to save addresses on a public site.
- Analytics: create a free GoatCounter account and follow the note in the `<head>` of `index.html`.
