# Yasenka — Animation & Behavior Backlog

A growable catalog of behaviors. **Adding a behavior = one entry in the hero
`manifest.json`, no code.** Two kinds of entry:

- **Action-bound** — has an `on:` hook. Plays deterministically when that event
  fires (interrupts idle life, then returns). Use `variants` for variety and
  `when` for state-conditional reactions (e.g. different reaction at high bond).
- **Autonomous** — has `when` + `weight` (no `on:`). Enters the weighted idle
  selector and fills the gaps between actions so she always feels alive.

Status: ✅ exists · 🟡 partial · ⬜ to draw. Priority: P1 core feel · P2 richness · P3 future.

---

## 1. Care interactions (you → Yasya) — Tamagotchi core · P1

| `on:` hook | depicts | variants / notes | status |
|---|---|---|---|
| `feed` | eats 😋 | ✅ `eat` (6f: bites, drumstick shrinks, licks lips) + anticipation `feed_want` | ✅ |
| `pet` | happy | ✅ purr loop `pet_purr`; ticklish/annoyed variants still open | ✅ |
| `play` | jump | ✅ `pounce` (5f play-bow → leap); win/lose reactions in games | ✅ |
| `wake` | woken by you | ✅ `wake` (5f stretch-yawn) | ✅ |
| `like` | like-on-click | proud pose, heart burst, satisfied | ⬜ |

## 2. Reactions to your page actions · P1–P2

| `on:` hook | depicts | status |
|---|---|---|
| `scroll_fast` | clings / surfs the feed, mild motion sickness | ⬜ |
| `type_watch` | freezes, quietly watches you type (anti-Clippy but alive) | ⬜ |
| `video_open` | runs + popcorn → react to video: laugh, cry, shocked, bored | 🟡 |
| `navigate` | new section — looks around, re-orients | ⬜ |
| `new_posts` | feed refreshed — curious peek | ⬜ |

## 3. Presence / tab · P2

| `on:` hook | depicts | status |
|---|---|---|
| `greet` | wave on return + runs to you, sulks (away too long), relief | 🟡 |
| `leave` / `blur` | waves goodbye, settles to doze | ⬜ |
| `return_day` | first hello of the day / streak special | ⬜ |

## 4. Movement & physics (platformer + drag-throw) · P1

| `on:` hook | depicts | status |
|---|---|---|
| `land` | landing squash after jump/fall, dust | ✅ `land` (4f squash+dust, deep falls) | 
| `drag` | dangles from cursor, flails legs | ✅ `drag` (3f dangle) | 
| `throw` | tumble in air, spin | ✅ `tumble` (4f ball-spin while thrown) | 
| `hang` | hangs off a ledge, pulls up / asks to be lifted | ⬜ |
| `slip` / `trip` | comedic stumble | ⬜ |
| `balance` | tightrope-walks a thin ledge | ⬜ |
| `sit_edge` | sits on edge, legs dangling | ✅ `sit_edge` (4f, in idle library) | 

## 5. Pranks (wildness-driven) — most extensible · P1–P3

| `on: prank:*` | depicts | status |
|---|---|---|
| `prank:crack` | "glass" crack | ✅ |
| `prank:steal_icon` | carries off a like/retweet icon | ⬜ |
| `prank:doodle` | scribbles on an avatar | ⬜ |
| `prank:swap_stats` | messes tweet stat numbers | ⬜ |
| `prank:smudge` | smudges the screen | ⬜ |
| `prank:sniff_post` | sniffs the post below, changes face (mood-sniff) | ⬜ |
| `prank:cover_text` | covers a word with her body | ⬜ |
| `prank:caught` | guilty freeze when you click mid-prank | ⬜ |
| `prank:tidy_undo` | gathers the mess back (your "tidy" gesture calms her) | ⬜ |

## 6. Emotions (as reactions) · P2

Have: happy, sad, angry, dizzy, hungry, sleep, ✅ surprised, ✅ bored, ✅ crying,
✅ laughing, ✅ sit, ✅ wash (grooming). Missing: blush/embarrassed, excited/sparkle,
smug, head-tilt (curious), adoring (big hearts), pout/sulk.

## 7. Life-cycle / evolution / sickness · P2–P3

| `on:` hook | depicts | status |
|---|---|---|
| `levelup` | fanfare, flash | ✅ `levelup` (5f star burst; plays on level-up & streak) |
| `evolve` | form transform — **fire-form already exists** as the first evolution | 🟡 |
| `bond_up` | trust ladder step (wild→tame→devoted→companion) | ⬜ |
| `hatch` / `intro` | first appearance on install (hatch/arrival) | ⬜ |
| `sick` | ill (green, thermometer) | ✅ `sick` anim + sickness mechanic (careState) |
| `heal` | recovery | ✅ `heal` (4f sparkle recovery; 💊 care button) |
| `runaway_warn` | soft, reversible escape warning (packs a bag, eyes the "door") | ⬜ |

## 8. AI & skills (later — AI grayed for demo) · P3

`thinking` (ponders, "..."), `searching` (magnifier), `answer` (lightbulb),
`download` (carries file → success/fail), `reminder` (rings a bell).

## 9. Time / daily · P2

`night` (yawns, dims), `idle_long` (dozes off), `streak_milestone` (celebrates a run of days).

---

## Manifest schema (what each entry can carry)

```jsonc
"<name>": {
  "on": "feed",                 // action-bound: plays on this event. omit = autonomous
  "anim": "eat",                // animation to play (defaults to <name>)
  "variants": ["eat","eat2"],   // pick one at random for variety
  "kind": "idle",               // idle | prank | affection | emotion | move | react
  "when": { "energy": "<45", "bond": ">=45" },  // eligibility on live stats
  "weight": 3,                  // base likelihood (autonomous selector)
  "cooldown": 50,               // min seconds between repeats of THIS entry
  "say": ["yawn~"],             // optional bubble line(s)
  "dur": 2.4,                   // seconds to hold before returning to life
  "fps": 6, "loop": true, "pingpong": false, "frames": ["x/0.png", ...]
}
```

`when` operators: `<`, `>`, `<=`, `>=`, exact. Keys: `hunger`, `mood`,
`energy`, `bond`, `wild` (wildness). Engine: `src/core/behavior.js`.
