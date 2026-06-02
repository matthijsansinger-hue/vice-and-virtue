# Vice and Virtue — project context

A hybrid PWA party game — a Werewolves spinoff. 6–20 in-person players, each holding their secret role on their own phone. Built solo by Matthijs (idea owner, first-time coder) with AI assistance. Live and playtested.

If you are a fresh chat session: read this file first, then `AGENTS.md` for the Next.js version warning. Together they're enough to be productive.

---

## Stack

- **Next.js 16.2.6** — App Router, React 19, TypeScript, Tailwind v4, Turbopack
- **Supabase** — Postgres + Realtime + RLS (open policies for MVP — must tighten before launch)
- **Vercel** — hosting, auto-deploys from `main`

**This Next.js version differs from older training data — always read `node_modules/next/dist/docs/` for the relevant API before writing Next.js code.** (`AGENTS.md` says the same.)

## Coordinates

| Thing | Where |
|---|---|
| Local project folder | `C:\Users\matth\OneDrive\Desktop\Vice and Virtue\vice-and-virtue\` |
| GitHub repo | https://github.com/matthijsansinger-hue/vice-and-virtue (branch `main`) |
| Live site | https://vice-and-virtue-delta.vercel.app (auto-deploys on push) |
| Supabase project ref | `xqvlseduirkvikkpatcb` (URL `https://xqvlseduirkvikkpatcb.supabase.co`) |
| Discord | https://discord.gg/Ju5K2cZquH (linked from the start screen) |
| Env vars | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key, in `.env.local` + Vercel) |
| Dev server | `npm run dev` in the project folder → `http://localhost:3000`. Phone via LAN at `http://192.168.2.41:3000` (allowlisted in `next.config.ts` — update IP if your router reassigns it) |

The dev server stops when the machine sleeps or the terminal closes — restart with `npm run dev` each session.

## Game design (current)

- **Players:** 6 min, 16 optimal, 20 max. Target session ~30–45 min.
- **Camps:** Vice vs Virtue. **12 roles** (see "Roles" below). Balanced assignment by tier S→A→B→C→D, equal camp counts (virtues get the extra on odd N).
- **Day cycle:**
  - **Reflection** — role-action (30s) → event_summary (host-advance) → minigame (95s) → result (host-advance)
  - **Outreach** — 120s one-on-one chats (host toggle in lobby). Imprisoned players ARE eligible. DM history resets each day.
  - **Consultation** — group_action (60s: Eye / Free / Skip, democratic) → group_action_target (45s if Free won) → consultation vote (95s + 1 re-vote on tie) → new_day (4s splash)
- **Pre-game flow (once at start):** lobby → game_overview → lore_intro (3.5s zoom + 0.5s fade-to-black) → role_reveal → first role_action
- **Player states:** active / in_prison / in_hospital (1 day) / dead. Imprisoned and hospitalized players can still be vote targets; dead players cannot.
- **Win conditions:**
  - All Virtues imprisoned/dead → Vices win
  - All Vices imprisoned/dead → Virtues win
  - **Murder endgame**: Murder + exactly 1 other active player → Vices win immediately
  - Vice win → `vice_victory_intro` screen → game_over scoreboard
  - Virtue win → `virtue_victory_intro` screen → game_over scoreboard
- **Soul Energy:** `round(100 × 0.93^(rank−1))` for rank x (capped at rank 20). **Starting SE = 100.** Ties on raw minigame score break by submission time (earlier submits rank higher). **Any wrong V/V tag in the minigame zeroes both the raw score AND the SE awarded for that round** (Unknown / "?" still counts +0.4 raw, no penalty).
- **Player names:** duplicates auto-prefixed "1. Alex" / "2. Alex" by join order.

### Roles

| Role | Camp | Tier | Cost | Effect |
|---|---|---|---|---|
| Murder | Vice | S | 150 | Queue kill in role-action. If killed, picks a Vice successor before dying. If only one other active player remains, Vices win immediately. |
| Empathy | Virtue | S | 150 | Reveal, for every player who got 1+ votes in the last consultation, the full list of voters. No target selection. |
| Intoxication | Vice | A | 100 | Queue hospitalize for 1 day. Blocked by Justice protect. |
| Justice | Virtue | A | 100 / 200 | Queue protect (self ok, blocks Murder + Intoxication) or kill. |
| Envy | Vice | B | 100 | Queue identity swap with a player for the round. Names swap for OTHER players; the swap participants themselves still see real names so the victim can't catch the swap. |
| Truthfulness | Virtue | B | 200 | After someone is imprisoned in consultation, reveal their voters to everyone. |
| Torment | Vice | C | 100 | Queue: target's minigame screen shows player names scrambled (seeded shuffle, no row keeps its real name). Clicks still tag the real row → wrong guesses. |
| Vengeance | Vice | C | 100 | When a Vice is imprisoned, guess a voter; correct = hospitalize them. Protect doesn't block. |
| Certainty | Virtue | C | 100 | Pick a player, reveal their **specific role** (not just camp). |
| Sacrifice | Virtue | C | free | Once per game: die + take another player. Queued in role-action (protect blocks); or instant in consultation (no protect). |
| Vice Worshipper | Vice | D | 20/char | Anonymous broadcast to all Vices, once per day. |
| Virtue Seeker | Virtue | D | 20/char | Anonymous broadcast to all Virtues, once per day. |

### Consultation group action (democratic side-action before the imprisonment vote)

Each game starts with **1 use of Revealing Eye** and **2 uses of Free a prisoner**. Skip has no cap. Use counts decrement only when the action actually fires.

- **Revealing Eye** — show how many Vices and Virtues are still active. Banner displays during consultation.
- **Free a prisoner** — winners trigger a follow-up vote between the current prisoners. The chosen prisoner is released.
- **Skip** — nothing happens (also the default on ties / exhausted options).

Hidden options:
- Free is hidden when there are no prisoners.
- Eye/Free are hidden when their use counter hits 0.
- A tied Free-target vote does NOT consume a use.

### Visual / phase backgrounds

| Phase / screen | Background |
|---|---|
| Home, Lobby, Game Overview, Role Reveal, Event Summary, Result | wood-desk-startscreen (`public/start-bg.png` + brand-brown wash) |
| Lore Intro | Castle image (`public/lore-bg.png`) with 3.5s easeInExpo zoom into the door + 0.5s fade-to-black, synced via `phase_ends_at` |
| Role Action / Minigame / Murder Succession / New Day | `constellations-bg` — purple sky image (`public/minigame-bg.png`) with brand-purple wash |
| Outreach | `outreach-castle-bg` — courtyard sketch (`public/outreach-bg.png`) multiplied against the grey-green outreach palette |
| Consultation | `consultation-council-bg` — throne-room sketch (`public/consultation-bg.png`) on cream `#F4EEA9` with brown `#4E3624` outlines |
| Vice victory intro | `public/vices-win-bg.png` (ruined town, sepia) |
| Virtue victory intro | `public/virtues-win-bg.png` (sunny city) |
| Game Over scoreboard | Matching victory image as bg + dark overlay |

Brand colour tokens (in `src/app/globals.css` `@theme`):
`--color-home-bg: #4e3624`, `--color-home-fg: #ffefc5`, `--color-reflection-bg: #372155`, `--color-reflection-fg: #7678ed`, `--color-outreach-bg: #c7cbc5`, `--color-outreach-fg: #a6a670`, `--color-outreach-outline: #735333`, `--color-consultation-bg: #800020`, `--color-consultation-fg: #000080`, `--color-consult-phase-bg: #06570d`, `--color-consult-phase-vote: #9af593`, `--color-gold: #e3b510`, `--color-cream: #ffefc5`.

The `bg-consultation-bg / -fg` colours mean **camp markers** outside the consultation phase itself (burgundy = vice, navy = virtue).

## Repo layout

```
db/                              # SQL: schema + numbered migrations
public/                          # logos, role cards, phase backgrounds, OG/favicon images
src/lib/
  supabase.ts                    # shared Supabase client
  types.ts                       # Room, Player, Message, DirectMessage, ConsultationMessage, DeadMessage, EventSummaryEntry; RoomPhase union
  player.ts                      # localStorage identity helpers
  room.ts                        # createRoom / joinRoom
  roles.ts                       # ROLES record (12 entries) + getRole()
  assignRoles.ts                 # tier-ordered, camp-balanced distribution
  game.ts                        # ALL phase transitions, action queueing/resolution, win checks
  scoring.ts                     # rankPlayers() — minigame ranking + Soul Energy (zeroes SE for 0-raw-score players)
  swaps.ts                       # displayedName() — Envy swap + duplicate-name indexing. Takes optional viewerId so swap participants see real names.
  winConditions.ts               # checkWinner() — counts dead+imprisoned as out; Murder+1 endgame
  messages.ts                    # camp messages (Worshipper/Seeker)
  dm.ts                          # 1-on-1 messages (outreach) — takes `day` for per-day reset
  consultationChat.ts            # public chat during consultation
  deadChat.ts                    # dead-only chat across phases
src/components/
  Centered.tsx                   # full-screen centered layout helper
  RoleCard.tsx                   # role reveal card (uses /cards/<role-id>.png)
  TopBar.tsx                     # persistent: day, phase progress, host skip, player chip + role detail modal
  Lobby.tsx                      # create-room screen + kick/leave buttons (logo at top)
  GameOverview.tsx               # 3-phase cycle diagram + clickable role list; all-proceed gate
  LoreIntro.tsx                  # castle bg + 3.5s zoom + 0.5s fade-to-black, synced via phase_ends_at
  RoleReveal.tsx                 # ready-up + card
  RoleAction.tsx                 # 30s window; per-role ability dispatch; CampMessagesPanel embed
  MurderSuccession.tsx           # dying-Murder picker / others see "resolving…"
  EventSummary.tsx               # role-action results: name + first-letter avatar in neutral brown, no role/camp shown; host clicks Continue
  Minigame.tsx                   # 95s timer, V/V/? tagging (? default-highlighted), Torment seeded name shuffle
  Result.tsx                     # scoreboard; explainer banner for non-scoring players; "Continue to outreach/group action"
  Outreach.tsx                   # 120s, partner list ↔ chat thread; cross-chat notification; Done doesn't lock you out; DM history per-day
  GroupAction.tsx                # Eye / Free / Skip vote (counts shown per option; brown Skip button)
  GroupActionTarget.tsx          # which-prisoner-to-free vote
  Consultation.tsx               # voting + tally + re-vote + result; group-action banner; Truthfulness reveal; Sacrifice instant
  NewDay.tsx                     # 4s splash before next day's role-action
  ViceVictoryIntro.tsx           # 1s silent beat + lore text + host Continue
  VirtueVictoryIntro.tsx         # mirror of vice intro
  GameOver.tsx                   # winning camp banner, all roles revealed, victory image as background
  CampMessagesPanel.tsx          # vice/virtue chat panel during role-action
  ConsultationChat.tsx           # public chat for consultation phase (per-day)
  DeadChat.tsx                   # dead-only chat embedded on all passive "you're dead" screens
  RulesGuide.tsx                 # fullscreen rules overlay opened from the home screen
  abilities/
    EmpathyAction.tsx, CertaintyAction.tsx, MurderAction.tsx,
    JusticeAction.tsx, IntoxicationAction.tsx, VengeanceAction.tsx,
    TruthfulnessAction.tsx, SacrificeAction.tsx (mode: "queued" | "instant"),
    WorshipperSeekerAction.tsx, EnvyAction.tsx, TormentAction.tsx
src/app/
  page.tsx                       # home — logo, name + join/create, How to play + Discord buttons, rules guide modal
  layout.tsx                     # metadata title, OG/Twitter cards, Geist font
  globals.css                    # Tailwind v4 @theme with phase color tokens + wood/sky/castle bg classes
  icon.png / apple-icon.png / opengraph-image.png / twitter-image.png  # file-convention assets auto-wired by Next.js
  room/[code]/page.tsx           # phase router — loads room + players, realtime, dispatches to phase components, wraps in TopBar
```

## Database schema (current — see `db/schema.sql` for full definition)

**rooms**
`id, code(unique), status(lobby|in_game|ended), phase, phase_ends_at, day, outreach_enabled, last_imprisoned_player, vote_reveal, envy_swap_a/b, torment_target, pending_murder_death, revote_candidates(jsonb), recent_successor_id, last_events(jsonb), group_action_result, group_action_freed_id, eye_uses_left, free_uses_left, created_at`

Where `phase` is one of: `lobby | game_overview | lore_intro | role_reveal | role_action | murder_succession | event_summary | minigame | result | outreach | group_action | group_action_target | consultation | new_day | vice_victory_intro | virtue_victory_intro | game_over`.

**players**
`id, room_id, name, is_host, connected, role, ready, minigame_score, minigame_submitted_at, soul_energy, vote, in_prison, dead, in_hospital, acted_this_day, pending_action(kill|protect|intox|vengeance_guess|sacrifice|envy_swap|torment), pending_target, created_at`

**messages** — `room_id, camp, sender_id, text, created_at` (camp chat from Worshipper/Seeker; anonymous in UI)

**dm_messages** — `room_id, sender_id, recipient_id, day, text, created_at` (1-on-1 outreach chat, filtered to current day)

**consultation_messages** — `room_id, sender_id, day, text, created_at` (public consultation chat, per-day)

**dead_messages** — `room_id, sender_id, text, created_at` (dead-only side channel, no day filter — spans the game)

All tables: RLS enabled with permissive open-access policy (`for all using (true) with check (true)`). Realtime publication includes all six.

## Migrations (in order)

1. `001` (implicit, no file) — initial `rooms` + `players` via `db/schema.sql` first run
2. `002_add_role_to_players.sql` — `players.role`
3. `003_reflection_phase.sql` — `rooms.phase/phase_ends_at/day`; `players.ready/minigame_score/soul_energy`
4. `004_consultation_phase.sql` — `players.vote/in_prison`
5. `005_role_actions.sql` — `players.acted_this_day`
6. `006_death_state.sql` — `players.dead/pending_action/pending_target`
7. `007_hospital_state.sql` — `players.in_hospital`; `rooms.last_imprisoned_player`
8. `008_vote_reveal.sql` — `rooms.vote_reveal`
9. `009_messages.sql` — `messages` table
10. `010_envy_torment.sql` — `rooms.envy_swap_a/b/torment_target`
11. `011_outreach.sql` — `dm_messages` table
12. `012_succession_revote.sql` — `rooms.pending_murder_death/revote_candidates`
13. `013_minigame_submitted.sql` — `players.minigame_submitted_at` (tie-break)
14. `014_event_summary.sql` — `rooms.last_events` (jsonb)
15. `015_consultation_chat.sql` — `consultation_messages` table
16. `016_group_action.sql` — `rooms.group_action_result/group_action_freed_id`
17. `017_group_action_uses.sql` — `rooms.eye_uses_left/free_uses_left` (default 2)
18. `018_dead_chat.sql` — `dead_messages` table
19. `019_dm_day.sql` — `dm_messages.day`

## Key design decisions (rationale, not just behavior)

- **Soul Energy formula simplified** from `Y × M` (M = 1000/scoring-players) to `100 × 0.93^(rank-1)` so a rank is worth the same regardless of player count.
- **Wrong-guess penalty in minigame**: any explicit V/V mismatch zeroes both the raw score AND the SE awarded for that round. Implemented in two places (`computeScore` short-circuits to 0; `rankPlayers` awards 0 SE when raw score ≤ 0). Encourages players to leave uncertain rows as "?".
- **No real accounts** — `localStorage` stores `vv_player_id` + `vv_player_name`. Each room's join creates a new player row.
- **Action queue resolution** in `endRoleAction`: collect protects first → apply kills (skipping protected) → apply hospitalizations (skipping protected and just-killed) → check for Murder death → if successor candidates exist, enter `murder_succession` phase; else apply kill + win check. Sacrifice contributes to deaths from both sides (protect can spare either side). Vengeance hospital isn't blocked by protect.
- **Envy swap is purely visual** — `displayedName()` swaps names; clicking a row stores the real underlying id (the deceived outcome). **The swap is hidden from the swap participants themselves** (Envy + the victim see real names everywhere via the optional `viewerId` arg) so the victim can't catch the swap by seeing their own name on someone else's row.
- **Host orchestrates phase advances.** Most phases auto-advance on timer + all-ready (with a `resetSeen` guard). Result, Event Summary, Consultation result, Lore Intro, victory intros need explicit host clicks. TopBar exposes a "Skip" button.
- **Murder's role-card persists on the dead old Murder** when succession transfers the role — old dead row keeps `role="murder"` for the GameOver reveal; the new alive Vice gets their role updated to `"murder"`. Two rows with `role="murder"` is the intended state (one dead, one alive).
- **Outreach scope simplification:** any active or imprisoned player can chat with any other (dead/hospital see passive screens with the dead chat). After clicking Done you stay on the partner list / threads (no waiting screen) so you can still see and send messages until the phase ends.
- **DM history resets each day** so Empathy's voter reveal can't be cross-referenced with stale DMs about yesterday's votes. Messages stay in the DB; the Outreach component filters by `room.day`.
- **Anonymous role-action deaths**: EventSummary shows the dead player's name + first-letter avatar in neutral brown, but no role / camp / Fallen breakdown. Roles are only revealed publicly at `game_over`.
- **Group action uses are decremented only when the action fires** (Eye won + actually shown; Free won + a prisoner was actually freed). Tied "which prisoner to free" rounds don't consume a use.
- **Reset-seen guard for phases entered after a vote-clearing transition** (Consultation, GroupAction, GroupActionTarget): the host's auto-advance only fires after we've observed `vote=null` on every active voter. Without this, the previous phase's votes still appear set in the client's local state and the host auto-advances within ~1s.
- **Sync animations via `phase_ends_at`**: the LoreIntro zoom and victory intro fade-to-black are anchored to the absolute db timestamp, not to a local setTimeout from when the client received the realtime update. Otherwise slow clients miss the climax.
- **Transparent PNG via plain `<img>`**: Tailwind v4 compiles `scale-*` to CSS-variable updates which don't reliably trigger transform transitions, and Next.js's `<Image>` optimiser repackaged transparent PNGs in a way that left a visible checker pattern. The logo on home + lobby uses plain `<img>` (with a `?v=N` cache-buster) to dodge both.

## Workflow conventions

- Verify before pushing: `npx tsc --noEmit` then `npm run build` (build is what Vercel runs).
- Commits are messages like `"Playtest batch 2: consultation timer, host force-proceed, total SE on scoreboard, lobby kick/leave"`. Matthijs commits + pushes via VS Code Source Control (`Ctrl+Shift+G`).
- **I (Claude) propose a commit message at the end of each turn**; Matthijs pastes it into VS Code, commits, then pushes. Always provide one after a feature change.
- When changing the database, **always** create a numbered migration in `db/` AND update `db/schema.sql` to match. Matthijs runs migrations manually in Supabase's SQL Editor — include the SQL inline in chat so he can copy-paste.
- Realtime subscriptions are filtered by `room_id=eq.${roomId}`. Inserts/updates/deletes all trigger the same reload pattern (`event: "*"`) — the component re-fetches the relevant slice.
- Ask clarifying questions BEFORE building substantial features. Matthijs prefers a quick `AskUserQuestion` round with recommended defaults over me guessing wrong and rebuilding.

## Communication style with Matthijs

- **Direct, technical, and concise.** Matthijs codes solo with AI; he can read JSX/TS and benefits from precise commit messages, file links, and short explanations of trade-offs.
- **He wants real feedback when I have a view.** If something he proposes would be wrong, harmful, or there's a better alternative, say so plainly. Example exchange from this codebase: *"what do you think? would it be good to make it 0.5 second longer?"* — don't just agree; recommend with reasoning, then apply.
- **Iteration loops via screenshots + short asks.** He'll often paste an image with a one-line "do this" instruction. Read the image, propose the change, ask only if genuinely ambiguous.
- **He chooses recommended options.** When I use `AskUserQuestion` with a (Recommended) tag, he almost always picks it. Use that to move fast — make sensible defaults and label them clearly.
- **Step-by-step on big batches.** For multi-feature batches, do them in logical sub-batches (e.g. "Batch A: Minigame; Batch B: Roles; Batch C: …") with a build between each.
- **Always offer a commit message.** End of every functional change → a ready-to-paste commit message block.
- **Avoid emojis** unless he uses them first.
- **Read the project context before making non-obvious decisions.** AGENTS.md warns the Next.js version differs from training data; PROJECT.md has rationale for design decisions.

## Bug test checklist

Walk through whenever significant gameplay changes ship. Run on at least two clients (host + non-host); ideally one phone + one browser.

### Pre-game
- Home screen logo loads cleanly (no white box, no checker pattern). Bust the browser cache on logo file changes.
- "How to play" opens the rules guide; every role's expandable description renders.
- "Join the Discord" opens the invite in a new tab.
- Name persistence: enter a name, refresh, name still there.
- Join with a wrong code → error message; join with a right code → lobby.

### Lobby & game start
- Multiple players show up live as they join.
- Host can kick; players can leave.
- Outreach toggle works.
- Start Game → Game Overview → Lore Intro → Role Reveal flow.
- Lore Intro: zoom animation runs on every client, fades to black at ~t=3.5s, advances at t=4s. **Test on slow network too — black overlay must still appear for everyone.**

### Role Reveal
- Each player sees the right role card (image + description).
- All-ready gate advances to role_action.

### Role Action (30s)
- Each ability targets correctly; SE is deducted; `acted_this_day` flips.
- Murder kill / Justice protect interactions.
- Sacrifice queued vs instant.
- Vice Worshipper / Virtue Seeker camp chat appears for the right camp only.
- Envy swap: the **victim does NOT see their own name on anyone else's row** (Envy + victim both see real names; only third parties see swapped names).
- Envy swap voting still routes to the real id.

### Event Summary (after role_action)
- Killed events: real name + first letter + neutral brown avatar; **no role or camp shown**.
- Hospitalised events: real name + first letter + neutral brown avatar.
- Host has the only Continue button; others wait.

### Minigame (95s)
- Every untagged row shows the "?" pill visually selected by default.
- Score: any wrong V/V tag → 0 raw score → 0 SE awarded (regardless of rank).
- Score: all-unknowns or all-correct → positive score → standard rank-based SE.
- Torment target sees **scrambled names** (no row keeps its real name, shuffle is stable across re-renders within the round, completely different per game/day).
- Imprisoned / hospital / dead see passive screen; dead see the dead chat embedded.

### Result (scoreboard)
- Ranked list shows only players who actually played.
- Non-scoring players (dead/prison/hospital) see the explainer banner.
- No Fallen section / role reveal here.
- Host-only Continue.

### Outreach (120s)
- DM history starts EMPTY each new day (previous days hidden).
- Imprisoned players appear in the partner list and can chat.
- Done button: clicking marks ready but does NOT switch to a waiting screen — partner list / threads stay live, messages keep arriving and can still be sent.
- Cross-chat notification: receive a DM from someone other than the currently open thread → banner appears at the top, tap to switch.
- Back arrow in the thread view is visible (not hidden under the TopBar).

### Group action (Eye / Free / Skip)
- "Eye: N left" and "Free: N left" badges visible on each option button.
- Skip button uses the outreach-outline brown for visual distinction.
- Free option hidden on day 1 (no prisoners) or when `free_uses_left === 0`.
- Eye option hidden when `eye_uses_left === 0`.
- Tie or no clear winner → "skip" outcome.
- Eye wins → consultation banner shows live camp counts.
- Free wins → group_action_target sub-vote → freed player banner on consultation.
- Use counts decrement ONLY when an action actually fires.
- Imprisoned/dead/hospital see passive screen + chat.
- **Important sync check:** test multiple consecutive days — the phase should NOT auto-skip on day 2+ (the resetSeen guard handles stale votes from the previous consultation).

### Consultation (95s)
- Vote list excludes self.
- Skip vote button is brown.
- Tied vote → host can trigger one re-vote.
- Truthfulness reveal embed works for the imprisoned target.
- Sacrifice instant kill in consultation.
- Group-action banner from earlier still visible at top.
- Dead players see the public chat + dead chat + the result fall-through; can't vote.
- Public chat persists across the sub-screens (per-day filter).

### Death / win conditions
- Kill → Fallen banner does NOT appear mid-game; role only revealed at game_over.
- Dead players see the dead chat on every passive screen across phases.
- Murder + 1 other active player → instant Vice win.
- Camp elimination → corresponding victory intro → game_over.

### Victory intros + Game Over
- Vice victory → ruined-town image + "Wrath's belief is proven true…" text fades in after 1s; host clicks Continue.
- Virtue victory → sunny-city image + "Unity prevails…" text fades in after 1s; host clicks Continue.
- Both animations sync on all clients (anchored to phase_ends_at).
- GameOver scoreboard uses the matching victory image as background.

### Sync / race conditions
- All resetSeen-guarded phases (Consultation, GroupAction, GroupActionTarget) must NOT auto-skip on day 2+.
- LoreIntro fade-to-black appears on every client (host + slow phone).
- Phase advances on all clients within ~500ms of each other.
- Reload mid-phase: client picks up the current state cleanly (no permanent loading state).

## Status and what's left

Implementation status: the **complete designed game is playable** plus several iteration batches on top. 12/12 abilities work; the full day-cycle loops through all sub-phases; win conditions trigger (including Murder endgame); succession, re-vote, group action, victory intros, dead chat, rules guide, custom backgrounds, logo + favicon + OG metadata, Discord link all wired in.

Outstanding design items (all deferred, none blocking play):

- **Sacrifice-win condition** — majority self-sacrifice for a chosen player + team. Optional secondary win path; not yet built.
- **RLS tightening** — current policies are wide open. Must be replaced with restrictive policies before public launch.
- **PWA manifest** — `next-pwa` integration not set up.
- **i18n** — design calls for EN/NL/ES; Next.js i18n routing not wired.

## Gotchas learned the hard way

- **Stale ready flags / votes** ended phases instantly when realtime delivered the phase change before the clearing-write landed. Fixed with `resetSeen` guards in Minigame, RoleAction, Outreach, Consultation, GroupAction, GroupActionTarget. **Apply the same pattern any time a new phase is entered with vote/ready clearing.**
- **Dead/imprisoned host couldn't advance consultation** because the dead-screen early return blocked their Continue button. Fixed by only short-circuiting dead/prison/hospital screens *while voting is in progress*; once all voted, everyone falls through to the result + (host) Continue.
- **HTML entities** (`&mdash;` etc.) only render inside JSX text, not inside JS string literals — use real characters in strings.
- **Phone testing on LAN** requires the computer's IP in `allowedDevOrigins` in `next.config.ts`. If the IP changes, the dev server's `Network:` startup line shows the new one.
- **Stray `.ts` files in the project root** get type-checked by `next build` and fail because of `allowImportingTsExtensions`. Don't leave temp scripts there.
- **CSS transitions don't fire on Tailwind v4 scale/blur utilities.** v4 compiles `scale-*` to `--tw-scale-x/y` variable updates rather than `transform` property changes. For animated zoom/blur, set `transform` and `filter` as INLINE STRINGS in the style prop so the browser sees a real property change.
- **Next.js `<Image>` optimiser can leave a checker pattern on transparent PNGs.** The opt'd-WebP returned the right alpha but the browser still rendered a checker in our test. Workaround: plain `<img>` (with a `?v=N` query string for cache-bust) for transparent assets.
- **Per-property transitions require inline CSS.** Tailwind's `transition-all` shares one duration + delay across properties. To delay the blur after the zoom starts, write the `transition: transform 2500ms … 1000ms, filter 1800ms … 1700ms` string into `style.transition`.
- **CSS transitions need the rules in place BEFORE the value changes.** Setting both the transition AND the target value in the same render cycle makes the browser snap to the final value with no animation. Keep transition style unconditional.
- **Animations synced via `phase_ends_at` must use the absolute timestamp.** Anchoring black overlays / climax effects to `endsAtMs - 500ms` (vs. a local setTimeout from when entering=true was observed) is the only way slow clients don't miss the climax before the phase advances.

## My (Claude's) memory location

I also keep auto-memory at `C:\Users\matth\.claude\projects\C--Users-matth-OneDrive-Desktop-Vice-and-Virtue\memory\` — `MEMORY.md` is the index. Read it if you want extra context on prior decisions; this file is the durable source of truth that travels with the repo.
