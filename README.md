# Wall of Thoughts
An anonymous infinite canvas where people drop thoughts in real time.

## Stack
- Vanilla HTML / CSS / JavaScript
- Firebase Realtime Database (live sync)

## Local Development
Open `index.html` directly in a browser, or serve with:
```bash
python -m http.server 8080
# then open http://localhost:8080
```

## Deploy to Vercel
```bash
npx vercel --prod
```
Or connect your GitHub repo at vercel.com and push to deploy automatically.

## Firebase Setup
The Firebase config is already wired in `app.js`.
Security rules are set in Firebase Console → Realtime Database → Rules.
