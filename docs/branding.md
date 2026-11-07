# InfraDeck branding

The official InfraDeck_brandkit.zip supplies the logos, interface symbol, colours
and application icons in `apps/web/public/brand`. The original kit README and
tokens are included under `public/brand/brand`.

`BrandLogo` uses the horizontal dark artwork by default, matching the existing
dark application palette. An ancestor with `data-theme="light"` selects the light
artwork. This integration does not introduce a new application theme; the accent palette now follows the official brand colours. Only the solid canvas rectangle was removed from the two
horizontal SVGs so they blend into existing surfaces. The SVG text retains the
kit's Arial fallback; as documented by the kit, exact typography across operating
systems would require converting the text to vector outlines.

The logo has an intrinsic ratio of 1040:300, fluid width, automatic height and
`object-fit: contain`. Sidebar, login, setup and invitation use the same component.
`BrandIcon` uses the official transparent interface symbol.

Next.js file metadata registers `app/favicon.ico`, `app/icon.svg`,
`app/apple-icon.png` and `app/manifest.webmanifest` automatically. The manifest
references `/icon-192.png` and `/icon-512.png`, with the kit's #0B1324 background
and theme colour. Icons use the ordinary `any` purpose; the kit does not supply
dedicated maskable assets. Adding a manifest does not add offline support.

The same branding changes are applied in the private checkout and the sibling
`infradeck-public` checkout. Public and demo use that checkout's web application;
`compose.demo.yaml` changes database initialization, not frontend assets.
Running hosted instances require rebuilding and deploying their web images.

Changed application files (relative to `apps/web` in each checkout):

- `components/brand-logo.tsx` (new), `brand-icon.tsx`, `shell.tsx`
- `app/globals.css`, `app/layout.tsx`, `app/icon.svg`
- `app/login/page.tsx`, `app/setup/page.tsx`, `app/invite/page.tsx`
- `app/favicon.ico`, `app/apple-icon.png`, `app/manifest.webmanifest` (new)
- `public/icon-192.png`, `public/icon-512.png`, `public/brand/**` (new)

Validation: private production build and targeted ESLint pass. Chromium checks
at 375, 768 and 1440 CSS pixels cover login, both logo variants, image aspect
ratios, page overflow and metadata/icon URLs. Sidebar is checked with an isolated
fixture using production CSS and logo markup, without an authenticated session.
Local screenshots and the verification script are in ignored `data/brand-preview`.

The public/demo production build also passes, using webpack because the local
dependency junctions are outside Turbopack's workspace boundary. Prisma Client
was generated locally first (no database migrations). Webpack reports warnings
about the optional SSH native module and Prisma exports; these are outside the
branding changes. The private build uses the standard Turbopack build command.

Brand palette: primary actions #2563EB with white text; links and focus #60A5FA; cyan #06B6D4 for secondary data accents; successful status #10B981. Existing dark surfaces and layout are preserved.

Delivery verification: public/demo standard Turbopack production Docker build passes. Screenshots are captured from the production demo with synthetic example.test accounts. Landing EN/RU uses the same palette and current dashboard image.

The standalone landing source is versioned in `landing/` (EN/RU, Node lead backend, Docker Compose). Run `docker compose up -d --build` there with a private `.env`. Local sibling `../landing` is the running checkout. No `.env`, credentials, database files or private fixtures are included. Landing previews are in `docs/screenshots/landing-desktop.png` and `landing-mobile.png`.
