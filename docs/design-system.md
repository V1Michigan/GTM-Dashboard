# V1 dashboard design system

The dashboard shares the visual language of `V1Website`. The website has
Tailwind configuration and generic UI tokens, but its cream backgrounds, gold
highlights, and editorial typography are also defined directly in components.
This system consolidates those sources into `app/v1-theme.css` and exposes the
same semantic roles to Tailwind in `app/globals.css`.

## Source audit

Paths below are relative to the sibling `V1Website` repository.

| Source | Observed style | Dashboard use |
| --- | --- | --- |
| `tailwind.config.ts`, `components/header.tsx`, `app/projects/page.tsx` | Cream `#FAF7F2` | Page and sidebar background |
| `app/page.tsx`, `app/people/page.tsx` | Paper `#FEF9F5` | Notice background |
| `app/globals.css`, `components/event-card.tsx` | Ink `#1A1A1A`, charcoal `#444444`, white cards | Text, actions, surfaces |
| `components/founder-card.tsx`, `components/project-modal.tsx` | Gold `#E9B872`, hover `#E5AD5F`, pill badges | Membership badges and selected states |
| `tailwind.config.ts`, `components/hero-section.tsx` | Yellow `#FDE047` | Text selection highlight |
| `app/layout.tsx`, `app/people/page.tsx`, `app/projects/page.tsx` | Inter body, Instrument Serif display headings | Interface text and page/dialog titles |
| `components/header.tsx` | Dark filled primary action, light borders, compact rounded controls | Buttons, forms, navigation |
| `components/event-card.tsx`, `components/ui/card.tsx` | White surfaces, thin borders, 12px large radius | Cards and dialogs |

The site's Playfair section typography and campaign-specific palettes (such as
Join V1's lime and the North Star experience) are not the core dashboard theme.
The general site palette and directory pages supply the dashboard's direction.
The website repository is a reference; this change does not modify it.

## Color roles

Use semantic utilities (`text-muted`, `bg-surface`, `border-divider`) or their
matching CSS variables. Do not copy literal colors into page components.

| Role | Value | Use |
| --- | --- | --- |
| `bg` | `#FAF7F2` | Page canvas and sidebar |
| `surface` | `#FFFFFF` | Cards, fields, menus, dialogs |
| `surface-muted` | `#F0EBE3` | Chart tracks, loading skeletons, neutral tags |
| `text` | `#1A1A1A` | Primary content and numeric values |
| `secondary` | `#444444` | Secondary content and display headings |
| `muted` | `#686159` | Hints, metadata, table headers, placeholders |
| `divider` | `#E2DDD5` | Decorative dividers and card outlines |
| `input-border` | `#978C7E` | Form and control boundaries |
| `accent` | `#E9B872` | Gold badges and small filled highlights |
| `accent-foreground` | `#1A1A1A` | Text on gold |
| `accent-text` / `focus` | `#80551F` | Links, attention text, focus rings |
| `accent-subtle` | `#F8ECD9` | Selected navigation, options, row hover |
| `accent-border` | `#A77936` | Attention outlines and selected cards |
| `action` / `on-action` | `#1A1A1A` / `#FFFFFF` | Primary buttons |
| `chart-fill` | `#777168` | Default chart marks |
| `chart-highlight` | `#A4722A` | Highlighted chart marks |

The website's pale gold is a fill, not small text on cream or white. The darker
accent roles are dashboard adaptations for readable links, chart marks, and
keyboard focus. Muted text is opaque; avoid reducing its contrast with opacity.
Decorative dividers may be quiet, while actionable control boundaries use the
stronger `input-border` role. Chart marks use a darker gold than badge fills.

## Typography and density

- Instrument Serif, regular: page titles (36px), display headings, dialog titles
  (28px), and sidebar wordmark.
- Inter: controls, tables, compact section titles, body text, and numbers.
- Compact section titles: 14px, semibold. Body and tables: 13–15px.
- Labels and metadata: 11–12px. Use uppercase and tracking sparingly.
- Preserve the dashboard's 2.8px spacing unit and compact table layout. Cards
  use roughly 17px padding; controls have a 36px minimum height, with existing
  touch-oriented controls retaining their 44px minimum.
- Radii: 4px small, 6px controls, 12px cards/dialogs, pill-shaped tags.
- Borders are solid. Elevation uses subtle neutral shadows on light surfaces.

## Component rules

Primary actions are charcoal with white text, mirroring the website header.
Secondary actions are white with visible neutral borders. Text actions use the
darker gold. Selected navigation and filter chips have a pale gold fill plus a
visible indicator or outline. Hover alone must not be the only selected cue.

Tags retain their established meanings: gold is a settled positive state
(member, committed), outlined gold calls for attention (review, walk-in), and
warm neutral communicates an ordinary fact (draft, archived, event type).
Always keep the text label; color is supplementary.

Page headings use the display face, while dense table headers, field labels,
and compact section headings stay sans serif. Table row hover uses pale gold;
keyboard row navigation and controls retain visible dark-gold focus outlines.
Dialogs and popovers are white with neutral shadows and a charcoal overlay.

Base and component styles use CSS cascade layers. Tailwind utilities can
therefore override component padding, sizes, and state styles intentionally.
Change shared roles in `v1-theme.css`; change individual layout in components.
