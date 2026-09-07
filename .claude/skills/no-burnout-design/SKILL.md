---
name: no-burnout-design
description: Design conventions for the no-burnout habit/focus tracker app (mobile-app/). Use when adding or changing any screen, component, or visual element in mobile-app/src — new screens, mockups, icons, or reviewing a UI change for consistency with the rest of the app.
---

# No Burnout — design conventions

This is a personal habit/focus tracker (React Native + Expo), themed around the
"less noise, more stability" idea from the app's source material (focus-cycle
and dopamine-detox notes). Dark, calm, low-stimulation UI — the design should
not fight that premise with bright colors, motion, or clutter.

## Palette

Source of truth: `mobile-app/src/theme/colors.ts`. Always import from there —
never hardcode hex values in a screen.

| Token | Value | Use |
|---|---|---|
| `bg` | `#12151a` | screen background |
| `card` | `#1c2028` | cards, inputs, inactive controls |
| `cardBorder` | `#262b34` | borders, track colors |
| `text` | `#e8e6e0` | primary text |
| `textMuted` | `#8b8f98` | secondary/hint text |
| `accent` | `#e08a55` | warm accent — "spike", timers, primary actions |
| `accentGreen` / `accentGreenDark` | `#8fb89a` / `#6f9f7f` | "steady/done" state — completed habits, removed triggers |
| `blue` | `#5c8fd6` | focus-session stats only |

Rule of thumb: warm accent (`accent`) = action/attention, green = completion/
calm, never introduce a new hue without a reason tied to meaning (like blue is
reserved for focus-session data).

## Screen inventory (`mobile-app/src/screens/`)

`src/navigation/RootTabs.tsx` is a native-stack wrapping a five-tab bottom bar.

Bottom bar, in order:

1. **ReportScreen** — rotating tip, one streak card (ring to the next
   milestone + phase + a collapsible calendar), the bar to 66 days, focus
   sessions, the weekly review row. Opens first.
2. **TodayScreen** — habit checklist for today, in three piles, each split
   into what is left and a folded «Выполнено · N»; a habit may carry a
   declared minimal version that can be ticked instead
3. **FocusScreen** — boredom timer plus the work/break cycle, both editable
4. **EnergyScreen** — hourly energy grid (1-10 self-rating) plus a task list
   tagged hard/routine, each suggesting the measured peak or dip hour
5. **StatsScreen** — the long view: weekday breakdown, streak summary, focus
   minutes by week

Two screens are gone and should not be reintroduced without a reason:
**QuestionScreen** ("what can I remove today") and **TriggersScreen**
(distraction triggers), the latter removed along with its stored data.

Pushed on top of the tabs, from the gear in the header:

- **SettingsScreen** — reference, notification access, reminder, screen-time
  limit, backup
- **LibraryScreen** — the full tip reference, four collapsible sections
- **ReminderScreen** — notification access, 1-5 reminders a day, one time
  picker per slot
- **ReviewScreen** — the weekly review (what worked / didn't / changing),
  one entry per ISO week, prompted from the report

Do not add a sixth tab: «Статистика» is the longest label the bar has carried
and it sets the width, so the five that are there are the budget. Anything new
that isn't a daily action belongs behind the gear.

No account, no server — everything reads/writes through `src/api/client.ts`
(AsyncStorage-backed, despite the `api` name). Any new screen should follow
the same pattern: a `read`/`write` pair against a new `KEYS.*` entry, not a
new storage mechanism.

## Tips and the reference

Content lives in `src/content/library.ts` as data, never inline in a screen.
A tip is a one-line `short`, a `full` paragraph revealed on tap, an optional
`caveat` for anything the source states more confidently than it has earned,
and a `rotate` flag deciding whether it joins the rotation. Render every tip
through `src/components/TipCard.tsx` so the reference and the rotating tip
stay visually identical.

## One idea, one block

The report used to say the same thing three times in a row — milestone dots,
"N из M дней до вехи", and a phase card. `StreakRing` is the single block
that answers "where am I", and `HistoryCalendar` — folded inside it — is the
single block that answers "how has it been going". Before adding a fourth progress indicator, check it isn't
a redraw of one of those two. The bar to 66 days is only rendered while the
ring is aimed at something nearer, for exactly that reason.

Explanatory art belongs with the idea it explains, not on a data screen:
`TwoCurves` lives in the tip about the two kinds of dopamine, via the tip's
`illustration` field.

## Saying what the system did, not what was asked

Anything that depends on a permission or on the OS accepting something must
report the OS's answer, never the request. A switch that stays on after the
platform refused is the bug this rule exists for. `setReminderSettings`
returns the applied settings plus a `failure` reason, and
`NotificationAccess` shows the live permission and the count of notifications
the OS actually holds. When adding anything similar, surface the real reason —
"permission denied" and "the platform can't do this" send the user to
different places.

`src/lib/useRotatingTip.ts` steps the rotation forward on every app open — JS
start and `background → active`, never at random — and the number beside a tip
is what makes a non-random order legible. A new tip appended to `TIPS` needs
no other change; adding one mid-list renumbers everything after it, which is
fine but worth knowing.

## Component conventions

- Card = `colors.card` bg, `borderRadius: 16`, `paddingHorizontal: 16` /
  `paddingVertical: 14`, `marginBottom: 10`. See any screen's `styles.card`.
- Checked/removed/active state = green tint background
  (`rgba(143,184,154,0.12)`) + `colors.accentGreen` dot/checkbox fill, not a
  full color swap — keeps the dark theme intact.
- Section captions are `textMuted`, 11-13px, sit above the content they label
  (not inside a bordered box).
- No shadows, no gradients, minimal motion — matches the "calm environment"
  premise. If a screen needs an animation (e.g. streak celebration), keep it
  short and skip it entirely under reduced-motion.

## Review checklist for any new/changed screen

- [ ] Colors only from `theme/colors.ts`
- [ ] Card/spacing values match the conventions above (16 radius, 10 margin,
      14/16 padding) unless there's a stated reason to diverge
- [ ] Works with `userInterfaceStyle: dark` from `app.json` — no light-only
      assumptions
- [ ] New persisted data goes through `src/api/client.ts`'s `KEYS` pattern,
      not a separate ad-hoc storage call
- [ ] Text is in Russian, matching the rest of the app's copy
