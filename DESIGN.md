---
version: 1.0
name: Barbets
updated: 2026-09-20
description: >
  Barbets is a free-to-play social betting app for private groups. The interface
  is built to read like a financial ledger rather than a casino: a near-white
  canvas, one signal blue reserved for the live and the actionable, hairline
  rules instead of shadows, and a monospace face for every figure you might
  compare. Personality lives in the copy and the group avatars, never in the
  chrome. If a screen looks decorative, it is wrong.

colors:
  canvas: "#f6f7f9"
  surface: "#ffffff"
  hairline: "#e7eaef"
  rule: "#eef0f4"
  ink: "#0c1018"
  muted: "#5a6373"
  faint: "#8a929f"
  dash: "#cfd6e2"
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
    mono: "'IBM Plex Mono', ui-monospace, monospace"
  display:      { fontSize: 27px,   fontWeight: 800, lineHeight: 1.14, letterSpacing: -0.025em }
  page-title:   { fontSize: 26px,   fontWeight: 800, letterSpacing: -0.02em }
  screen-title: { fontSize: 15px,   fontWeight: 800, letterSpacing: -0.015em }
  card-title:   { fontSize: 17px,   fontWeight: 700, letterSpacing: -0.01em }
  row-title:    { fontSize: 14.5px, fontWeight: 700 }
  row-title-sm: { fontSize: 13.5px, fontWeight: 700 }
  body:         { fontSize: 13.5px, fontWeight: 400, lineHeight: 1.5, color: muted }
  body-sm:      { fontSize: 12.5px, lineHeight: 1.5, color: muted }
  caption:      { fontSize: 11.5px, lineHeight: 1.45, color: faint }
  eyebrow:      { fontSize: 11.5px, fontWeight: 700, letterSpacing: 0.1em, textTransform: uppercase, color: faint }
  figure-hero:  { family: mono, fontSize: 42px, fontWeight: 600, lineHeight: 1, letterSpacing: -0.03em }
  figure:       { family: mono, fontSize: 15px, fontWeight: 600 }
  figure-sm:    { family: mono, fontSize: 12.5px, fontWeight: 600 }
  button:       { fontSize: 15px, fontWeight: 700 }

rounded:
  chip: 8px
  icon-tile: 10px
  avatar: 11px
  field: 14px
  button: 14px
  row: 18px
  row-lg: 20px
  card: 24px
  card-lg: 26px
  device: 30px
  pill: 999px

spacing:
  gutter: 22px            # left/right padding inside a phone screen
  gutter-tight: 18px      # list-heavy screens
  stack-sm: 9px
  stack: 13px
  stack-lg: 22px
  section: 28px
  header-offset: 104px    # top padding under the fixed header
  footer-offset: 116px    # bottom padding when a sticky footer is present

elevation:
  hairline: "1px solid #e7eaef"
  card: "0 1px 2px rgba(12,16,24,.04)"
  cta: "0 10px 20px -10px rgba(45,85,245,.7)"
  sheet: "0 -1px 2px rgba(12,16,24,.03)"
  device: "0 20px 44px -22px rgba(12,16,24,.35)"

layout:
  viewport: 393x852       # iPhone 15 / 16 logical size, the design target
  header: "fixed, white, 1px bottom hairline, 40px status inset + 11px pad"
  footer: "sticky, rgba(255,255,255,.96) + blur(8px), 1px top hairline, 12px 18px 28px"
  bottom-nav: "62px tall, 5 slots, centre slot is a 42px ink tile with a plus"

components:
  primary-button:   { height: 48-50px, background: signal, color: "#ffffff", radius: button, font: button, boxShadow: cta }
  primary-disabled: { background: disabled-bg, color: disabled-ink, boxShadow: none }
  secondary-button: { background: surface, border: hairline, color: ink }
  dark-button:      { background: ink, color: "#ffffff" }
  row:              { background: surface, border: hairline, radius: row-lg, padding: "14px 16px", chevron: "7x12 stroke #8a929f" }
  stat-cluster:     { figure: "mono 15/600 ink", label: "11px sans faint, 3px below" }
  odds-chip:        { background: surface, border: "1px solid #2d55f5", color: signal, font: figure-sm, radius: icon-tile }
  sealed-chip:      { background: canvas, border: "1px dashed #cfd6e2", color: faint, font: "mono 12/600 uppercase .04em" }
  gain-chip:        { background: gain-bg, color: gain, font: figure-sm }
  needs-you-card:   { background: alert-bg, border: "1px solid #f6d9d5", counter: "34px alert tile, white numeral" }
  group-chip-on:    { background: ink, color: "#ffffff", radius: pill, avatar: "24px circle" }
  group-chip-off:   { background: surface, border: hairline, color: muted, dot: "7px alert circle when waiting on you" }
---

## Overview

Barbets is a betting app with no money in it. Groups play for a prize and a
punishment, and the only currency is standing on the table. The design job is to
make a playful social ritual feel trustworthy enough that people believe the
numbers, and fast enough that placing a bet takes one thumb and four seconds.

The reference point is a broker statement, not a bookmaker. Everything that can
be a plain row is a plain row. The interface earns its warmth from the group
avatars, the nicknames, and the copy.

### Five rules

1. **One blue.** Signal blue marks what is live and what you can act on. Nothing
   else is blue. A screen with three blue things has two too many.
2. **Hairlines, not shadows.** Separation is a 1px `#e7eaef` rule. The only
   real shadows in the product are the CTA glow and the sheet lift.
3. **Sans to read, mono to compare.** Any number a user might line up against
   another number is IBM Plex Mono. Prose is never mono; figures are never sans.
4. **Say the state.** Every screen states plainly where a bet is: open, sealed,
   closed, settled, challenged. Ambiguity is the one thing a betting app cannot
   afford.
5. **Nothing needs explaining twice.** If a row needs a paragraph under it, the
   row is wrong.

## Colors

### Neutrals

The app sits on **canvas** (`#f6f7f9`) with **surface** (`#ffffff`) cards.
Ink (`#0c1018`) is the only text colour for anything that matters; **muted**
(`#5a6373`) carries supporting sentences; **faint** (`#8a929f`) is for
eyebrows, timestamps, and chevrons only. Never set body copy in faint.

### Signal blue

`#2d55f5` is the voltage. It appears on: the primary CTA, live countdowns, the
selected tab, odds you can still take, links, and the app icon. It never appears
as a background wash, a gradient, or a decorative fill. **Signal deep**
(`#1f3fc4`) is the pressed state. **On ink** (`#6b8cff`) is the same blue
lifted for use on the ink background only, and is never used on a light ground.

### Semantics

Green (`#0b8a5b`) only ever reports a realised gain. Red (`#c8392c`) only
ever means something is waiting on you, or a destructive action. Neither colour
is used decoratively, and neither is used for "team A / team B".

### Contrast floor

Body text is ink or muted on white or canvas. On the ink background, text is
white or `#6b8cff`. No alpha-muted type on photography or blue.

## Typography

Two families, no exceptions.

**Plus Jakarta Sans** 400 / 500 / 600 / 700 / 800. The 800 weight is reserved for
titles and the wordmark. Titles are tracked tight (-0.015em to -0.025em); nothing
else is tracked except the uppercase eyebrow, which is +0.1em.

**IBM Plex Mono** 400 / 500 / 600. Balances, odds, countdowns, standings, hit
rates, invite codes, and percentages. Mono is what tells a user "this is a number
you can trust", so it must never leak into prose.

Substitutes if a licence is unavailable: keep Plus Jakarta Sans (it is SIL Open
Font License, so there is rarely a reason to swap). IBM Plex Mono can be replaced
by JetBrains Mono at weight 500.

## Layout

Phones are designed at **393 x 852**. Horizontal gutter is 22px on content
screens and 18px on list-heavy screens. Content starts at **104px** from the top
when the fixed header is present. When a sticky footer CTA is present, the
scroller carries **116px** of bottom padding so the last row clears it.

Vertical rhythm inside a screen: 9px between items in a tight stack, 13px between
cards, 22px before a new labelled group. Anything above 28px reads as a new
section.

### Header

White, one hairline at the bottom, a 40px status inset, then a 32px back or close
tile, the screen title at 15/800, and an optional right-hand affordance. The
header never carries the group name and the screen name at once.

### Footer

Sticky, 96% white with an 8px backdrop blur, one hairline on top, 12px 18px 28px
padding. It holds exactly one primary action. Secondary actions live in the body.

### Bottom nav

62px, five slots: Markets, Inbox, the plus tile, Group, You. The plus is a 42px
ink tile, not a blue one, because it opens a menu rather than committing
anything. Badges are 15px alert circles with a white numeral.

## Shapes

Radius ladder, applied strictly by role:

| Radius | Role |
|---|---|
| 8px | chips, small tags |
| 10-11px | icon tiles, avatars |
| 14px | fields, buttons |
| 18-20px | rows, list cards |
| 24-26px | cards, sheets |
| 30px | device frame |
| 999px | group pills, badges |

Mixing levels inside one component is the usual way this system gets broken. A
14px button inside a 24px card is correct; a 24px button is not.

## Motion

Motion is functional and short. 120-180ms for state changes, 220-280ms for sheets
and route transitions, standard ease-out. Three named behaviours exist:

- **settle** - the odds bar nudging as the pool moves. Loops slowly, never
  attention-seeking.
- **shimmer** - skeleton loading, a 180% background sweep.
- **pulse** - the three-dot loader and the live dot.

No parallax, no spring overshoot, no confetti except at season end.

## Voice

Plain, dry, and short. The app talks about bets the way a mate does, and about
money the way a statement does.

- Sentence case everywhere except the uppercase eyebrow.
- **No em dashes.** Use a full stop, a comma, or a colon.
- Second person. "Two things need you", not "You have 2 pending actions".
- No exclamation marks, no emoji, no "Oops".
- Errors say what happened and what to do next: "That code has expired. Ask for a
  new one."
- Numbers are always digits, never spelled out.

## Do and don't

### Do

- Reserve blue for the one thing the user can do next.
- Use mono for every figure, including inside chips and rows.
- Let a hairline do the work a border box or a shadow would do.
- State the bet's status on the card, not only on the detail screen.
- Keep the primary CTA in the sticky footer, and keep it alone.

### Don't

- Don't tint cards. Cards are white; the canvas is the only grey.
- Don't add a second accent colour for a category, sport, or group. Groups are
  told apart by their avatar.
- Don't use green or red for anything other than a realised gain or something
  that needs you.
- Don't stack two CTAs of equal weight.
- Don't introduce gradients, glass, or illustration into the chrome.
