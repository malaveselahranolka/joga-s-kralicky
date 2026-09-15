# Project working notes

- Stack: static HTML/CSS/JavaScript, built by `scripts/build.mjs` into `public/`.
- Main verification gate: `npm run check`.
- Business dashboard tests: `npm run test:business`.
- Local preview: `node serve.mjs`, then open `http://localhost:3000/business.html?demo=1`.
- `business.html`, `business/`, and any new root asset must be added to the explicit copy list in `scripts/build.mjs`.
- Supabase SQL files are deployment instructions. Never run them against production without explicit user approval.
- Existing booking, payment, voucher, CMS, and email flows are protected scope; business analytics must not block or mutate them.
