---
version: 1.0
name: Barbets
updated: 2026-09-23
description: >
  Barbets is a free-to-play social betting app for private groups. The interface
  is built to read like a financial ledger rather than a casino: a near-white
  canvas, one signal blue reserved for the live and the actionable, hairline
  rules instead of shadows, and a monospace face for every figure you might
  compare. Personality lives in the copy and the group avatars, never in the
  chrome. If a screen looks decorative, it is wrong.

  This file describes the system as actually implemented in this codebase — the
  token names below are the real `@theme` custom properties in `app/globals.css`,
  and every component named below is the real file. Brand assets (the app icon,
  the logo mark, store listing art) are intentionally out of scope for this
  system and still use the pre-Ledger "B" die mark; nothing here should be read
  as a claim about them.

colors:
  canvas: "#f6f7f9"
  surface: "#ffffff"
  rule: "#eef0f4"
  hairline: "#e7eaef"
  dash: "#cfd6e2"
  faint: "#8a929f"
  muted: "#5a6373"
  ink: "#0c1018"
  signal: "#2d55f5"
  signal-deep: "#1f3fc4"
  signal-tint: "#eef2ff"
  on-ink: "#6b8cff"
  gain: "#0b8a5b"
  gain-bg: "#e8f6ef"
  gain-line: "#cbe8da"
  alert: "#c8392c"
  alert-bg: "#fff6f5"
  alert-line: "#f6d9d5"
  disabled-bg: "#eef0f4"
  disabled-ink: "#a8b0bd"

typography:
  families:
    sans: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    mono: "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace"
  note: >
    `font-sans` and `font-display` both resolve to Plus Jakarta Sans (there is
    no separate "display" family in this app, just weight/size). `font-mono`
    is IBM Plex Mono, imported at weights 400/500/600/700 — 700 is as heavy as
    it goes, so a `font-extrabold` figure still gets a browser-synthesized
    bold, a small accepted gap rather than a reason to add more weights.

radius:
  chip-and-pill: "rounded-full — chips, badges, avatars, switches, sliders"
  field-and-button: "14px — components/ui/Button.tsx, components/ui/Field.tsx"
  row: "18-20px"
  card: "24px — components/ui/Card.tsx"
  card-lg: "26-28px — tickets, sheets"
  device: "30px — the phone-frame mockups only, not a real component"

elevation:
  hairline: "1px solid var(--color-hairline) — the default; almost everything uses this and nothing else"
  card: "0 1px 2px rgba(12,16,24,.04) — Modal, RouteModal, the bet-confirmed ticket; a near-invisible lift for a card floating over a scrim, not for a card sitting on canvas"
  cta: "0 10px 20px -10px rgba(45,85,245,.7) — Button's accent variant only, the one CTA glow the system allows"
  sheet: "0 -1px 2px rgba(12,16,24,.03) — a sticky bottom bar's top edge (BetslipBar, EndorseAction)"
  focus-ring: "0 0 0 4px rgba(45,85,245,.08) — Field's focus state, paired with a 2px signal border"
  note: >
    Everything else that had a shadow before this pass (card/ticket drop-
    shadows, the old dark-gradient tickets' elevation) has been removed.
    Small physical-control affordances (Switch's knob, PullToRefresh's pull
    indicator) keep a minimal ink-tinted shadow since they read as a real
    object, not a floating card.

## Five rules

1. **One blue.** Signal blue marks what is live and what you can act on.
   Nothing else is blue. A screen with three blue things has two too many.
2. **Hairlines, not shadows.** Separation is a 1px `hairline` rule. The only
   real shadows in the product are the five listed above, and each has a
   specific, named job — none of them are decorative elevation.
3. **Sans to read, mono to compare.** Any number a user might line up against
   another number is `font-mono`. Prose is never mono; figures are never sans.
   In practice: anywhere `tabular-nums` is used, `font-mono` travels with it —
   that pairing is the actual marker for "this is a figure" in this codebase.
4. **Say the state.** Every screen states plainly where a bet is: open,
   sealed, closed, settled, challenged (see `lib/marketStatus.ts`'s
   `STATUS_LABEL` / `STATUS_TONE`).
5. **Nothing needs explaining twice.** If a row needs a paragraph under it,
   the row is wrong.

## Colors

### Neutrals

The app sits on **canvas** (`#f6f7f9`) with **surface** (`#ffffff`) cards.
**Ink** (`#0c1018`) is the only text colour for anything that matters;
**muted** (`#5a6373`) carries supporting sentences; **faint** (`#8a929f`) is
for eyebrows, timestamps, and chevrons only — never body copy.

### Signal blue

`#2d55f5` is the voltage. It appears on: the primary CTA, live countdowns,
the selected nav tab, odds you can still take, links, and sealed/pending
chips. It never appears as a decorative background wash or a gradient.
**Signal deep** (`#1f3fc4`) is the pressed/hover state. **On-ink**
(`#6b8cff`) is signal blue lifted for use on the ink background — this
matters in practice: a dozen-plus components render a bright accent figure
or icon on a full dark ink card (tickets, the sealed ballot, champion cards,
the bet slip's confirmation screen), and `signal-tint` (`#eef2ff`, meant for
a light tinted chip on a light ground) is nearly invisible there. `on-ink` is
the token for exactly that "bright accent text on a dark card" role;
`signal-tint` is only for a light-background tint.

### Semantics

**Gain** (`#0b8a5b`) only ever reports a realised gain. **Alert** (`#c8392c`)
only ever means something is waiting on you, or a destructive action.
Neither is used decoratively, and neither is used for "team A / team B" or
any other categorical distinction.

### Contrast floor

Body text is ink or muted on white or canvas. On the ink background, text is
surface (white) or on-ink. No alpha-muted type on photography or a colored
fill.

## Typography

Two families, no exceptions. **Plus Jakarta Sans** for anything you read.
**IBM Plex Mono** for anything you compare — balances, odds, countdowns,
standings, hit rates, invite codes, percentages. Mono must never leak into
prose; sans must never carry a figure.

## Shapes

Chips, badges, avatars, switches, and sliders stay fully round
(`rounded-full`) — see `components/ui/Badge.tsx`, which keeps this
deliberately even though every other primitive moved to a fixed radius.
Buttons and fields are 14px (`components/ui/Button.tsx`,
`components/ui/Field.tsx`). Rows are 18-20px, cards 24-28px depending on
whether it's an ordinary card or a ticket/sheet.

**`Field` is a structural change, not just a recolor.** The version this
replaced was an underlined input with a floating label reacting to focus via
a CSS `peer`. The Ledger mockups (5b, 5c, 5f, 5l...) show a bordered box with
the label as a plain caption above it, so the new `Field` is a real bordered
14px box — the underline model is gone, not just recolored.

## Motion

Motion is functional and short. No spinner anywhere in the app —
`components/ui/LoadingAnimation.tsx` is two bars pushing against each other
on one track (`bb-settle` / `bb-settle-b` in `globals.css`), the same idea
as a market settling on a price, used for the boot splash and every route
loading state. `bb-fade` is the loader's caption and any live-dot pulse;
`bb-shimmer` is available for a skeleton-row sweep (not yet wired into a
skeleton component — the app doesn't have one yet).

## Do and don't

### Do

- Reserve signal blue for the one thing the user can do next.
- Use `font-mono` for every figure, including inside chips and rows.
- Let a hairline do the work a border box or a shadow would do.
- Use `on-ink` (not `signal-tint`) for bright accent text/icons on a dark ink
  card.
- State the bet's status on the card, not only on the detail screen.

### Don't

- Don't tint cards. Cards are white/surface; canvas is the only grey.
- Don't add a second accent colour for a category, sport, or group. Groups
  are told apart by their avatar.
- Don't use gain or alert for anything other than a realised gain or
  something that needs you.
- Don't introduce gradients into chrome — every "dark = money" card that used
  to run a 2-3 stop ink gradient is now a flat ink fill (`BottomNav`'s create
  sheet, every ticket component, balance/champion cards, the bet slip). This
  was a deliberate pass, not an oversight: if you're tempted to add a
  gradient back for "richness," don't.
- Don't add a card drop-shadow for emphasis. If something needs to stand out,
  that's what signal blue, a heavier weight, or a chip is for.
