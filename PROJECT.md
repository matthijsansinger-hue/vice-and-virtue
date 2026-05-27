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
| Env vars | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key, in `.env.local` + Vercel) |
| Dev server | `npm run dev` in the project folder → `http://localhost:3000`. Phone via LAN at `http://192.168.2.41:3000` (allowlisted in `next.config.ts` — update IP if your router reassigns it) |

The dev server stops when the machine sleeps or the terminal closes — restart with `npm run dev` each session.

## Game design (current)

- **Players:** 6 min, 16 optimal, 20 max. Target session ~30–45 min.
- **Camps:** Vice vs Virtue. **12 roles** (see "Roles" below). Balanced assignment by tier S→A→B→C→D, equal camp counts (virtues get the extra on odd N).
- **Day cycle:** **Reflection** (role-action 30s → minigame 95s → scoreboard) → **Outreach** (optional 95s 1-on-1 chat, host toggle in lobby) → **Consultation** (95s voting + result; tied votes trigger one re-vote).
- **Player states:** active / in_prison / in_hospital (1 day) / dead. Imprisoned and hospitalized players can still be vote targets; dead players cannot.
- **Win conditions:** all of one camp dead+imprisoned → other camp wins. Checked after `endRoleAction` and `endConsultation`.
- **Soul Energy:** `round(100 × 0.93^(rank−1))` for rank x (capped at rank 20). **Starting SE = 100.** Ties on raw minigame score break by submission time (earlier submits rank higher).
- **Player names:** duplicates auto-prefixed "1. Alex" / "2. Alex" by join order.

### Roles

| Role | Camp | Tier | Cost | Effect |
|---|---|---|---|---|
| Murder | Vice | S | 150 | Queue kill in role-action. If killed, picks a Vice successor before dying. |
| Empathy | Virtue | S | 100 | Pick a player, see who voted for them in the last consultation. |
| Intoxication | Vice | A | 100 | Queue hospitalize for 1 day. Blocked by Justice protect. |
| Justice | Virtue | A | 100 / 200 | Queue protect (self ok, blocks Murder + Intoxication) or kill. |
| Envy | Vice | B | 100 | Queue identity swap with a player for the round (names + votes route). |
| Truthfulness | Virtue | B | 200 | After someone is imprisoned in consultation, reveal their voters to everyone. |
| Torment | Vice | C | 100 | Queue: target's minigame icons are half obscured. |
| Vengeance | Vice | C | 100 | When a Vice is imprisoned, guess a voter; correct = hospitalize them. Protect doesn't block. |
| Certainty | Virtue | C | 100–350 (by tier) | Pick a tier, see everyone in it. |
| Sacrifice | Virtue | C | free | Once per game: die + take another player. Queued in role-action (protect blocks); or instant in consultation (no protect). |
| Vice Worshipper | Vice | D | 20/char | Anonymous broadcast to all Vices, once per day. |
| Virtue Seeker | Virtue | D | 20/char | Anonymous broadcast to all Virtues, once per day. |

### Phase color palette (from Matthijs's design PDF)

| Phase | bg | fg | outline |
|---|---|---|---|
| Homescreen / lobby | `#4e3624` brown | `#ffefc5` cream | `#e3b510` gold |
| Reflection | `#372155` purple | `#7678ed` periwinkle | gold |
| Outreach | `#c7cbc5` grey-green | `#a6a670` olive | `#735333` brown |
| Consultation | **navy** (bg) / **burgundy** (fg) | navy was `consultation-bg` (#800020), but for consultation phase Matthijs flipped these so navy is the background and burgundy is for option panels. Other components using `consultation-bg/fg` for camp badges still mean burgundy=vice, navy=virtue. | gold |

These tokens live in `src/app/globals.css` under `@theme`: `--color-home-bg`, `--color-home-fg`, `--color-reflection-bg`, `--color-reflection-fg`, `--color-outreach-bg`, `--color-outreach-fg`, `--color-outreach-outline`, `--color-consultation-bg`, `--color-consultation-fg`, `--color-gold`, `--color-cream`.

## Repo layout

```
db/                              # SQL: schema + numbered migrations
src/lib/
  supabase.ts                    # shared Supabase client
  types.ts                       # Room, Player, Message, DirectMessage; RoomPhase union
  player.ts                      # localStorage identity helpers
  room.ts                        # createRoom / joinRoom
  roles.ts                       # ROLES record (12 entries) + getRole()
  assignRoles.ts                 # tier-ordered, camp-balanced distribution
  game.ts                        # ALL phase transitions, action queueing/resolution, win checks
  scoring.ts                     # rankPlayers() — minigame ranking + Soul Energy
  swaps.ts                       # displayedName() — Envy swap + duplicate-name indexing
  winConditions.ts               # checkWinner() — counts dead+imprisoned as out
  messages.ts                    # camp messages (Worshipper/Seeker)
  dm.ts                          # 1-on-1 messages (outreach)
src/components/
  Centered.tsx                   # full-screen centered layout helper
  RoleCard.tsx                   # role reveal card
  TopBar.tsx                     # persistent: day, phase progress, host skip, player chip + role detail modal
  Lobby.tsx                      # create-room screen + kick/leave buttons
  RoleReveal.tsx                 # ready-up + card
  RoleAction.tsx                 # 30s window; per-role ability dispatch; CampMessagesPanel embed
  MurderSuccession.tsx           # dying-Murder picker / others see "resolving…"
  Minigame.tsx                   # 95s timer, V/V/? tagging, ink-spots for Torment target
  Result.tsx                     # scoreboard; "Continue to outreach/consultation"
  Outreach.tsx                   # 95s, partner list ↔ chat thread
  Consultation.tsx               # voting + tally + re-vote + result; Truthfulness reveal embed; Sacrifice instant embed
  GameOver.tsx                   # winning camp banner, all roles revealed
  CampMessagesPanel.tsx          # vice/virtue chat panel during role-action
  abilities/
    EmpathyAction.tsx, CertaintyAction.tsx, MurderAction.tsx,
    JusticeAction.tsx, IntoxicationAction.tsx, VengeanceAction.tsx,
    TruthfulnessAction.tsx, SacrificeAction.tsx (mode: "queued" | "instant"),
    WorshipperSeekerAction.tsx, EnvyAction.tsx, TormentAction.tsx
src/app/
  page.tsx                       # home — name + join (primary) / create (secondary)
  layout.tsx                     # metadata title, Geist font
  globals.css                    # Tailwind v4 @theme with phase color tokens
  room/[code]/page.tsx           # phase router — loads room + players, realtime, dispatches to phase components, wraps in TopBar
```

## Database schema (current — see `db/schema.sql` for full definition)

**rooms**
`id, code(unique), status(lobby|in_game|ended), phase(lobby|role_reveal|role_action|murder_succession|minigame|result|outreach|consultation|game_over), phase_ends_at, day, outreach_enabled, last_imprisoned_player, vote_reveal, envy_swap_a/b, torment_target, pending_murder_death, revote_candidates(jsonb), created_at`

**players**
`id, room_id, name, is_host, connected, role, ready, minigame_score, minigame_submitted_at, soul_energy, vote, in_prison, dead, in_hospital, acted_this_day, pending_action(kill|protect|intox|vengeance_guess|sacrifice|envy_swap|torment), pending_target, created_at`

**messages** — `room_id, camp, sender_id, text, created_at` (camp chat from Worshipper/Seeker; anonymous in UI)

**dm_messages** — `room_id, sender_id, recipient_id, text, created_at` (1-on-1 outreach chat)

All tables: RLS enabled with permissive open-access policy (`for all using (true) with check (true)`). Realtime publication includes all four.

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

## Key design decisions (rationale, not just behavior)

- **Soul Energy formula simplified** from `Y × M` (M = 1000/scoring-players) to `100 × 0.93^(rank-1)` so a rank is worth the same regardless of player count. Future group purchases will scale with player count instead.
- **No real accounts** — `localStorage` stores `vv_player_id` + `vv_player_name`. Each room's join creates a new player row.
- **Action queue resolution** in `endRoleAction`: collect protects first → apply kills (skipping protected) → apply hospitalizations (skipping protected and just-killed) → check for Murder death → if successor candidates exist, enter `murder_succession` phase; else apply kill + win check. Sacrifice contributes to deaths from both sides (protect can spare either side). Vengeance hospital isn't blocked by protect.
- **Envy swap is purely visual** — `displayedName()` swaps names; clicking a row stores the real underlying id, which is exactly the "deceived" outcome. No separate vote-routing function.
- **Host orchestrates phase advances.** Most phases auto-advance on timer + all-ready (with a `resetSeen` guard to avoid stale ready flags ending phases instantly). Result and Consultation result need an explicit host click. The `TopBar` exposes a host "Skip" button to force any phase forward.
- **Murder's role-card persists on the dead old Murder** when succession transfers the role — old dead row keeps `role="murder"` for the GameOver reveal; the new alive Vice gets their role updated to `"murder"`. Two rows with `role="murder"` is the intended state (one dead, one alive).
- **Outreach scope simplification:** any active player can chat with any other active player (imprisoned ARE chattable; dead/hospital see passive screens). The design's dead-only-with-dead and prison-specific rules were intentionally not implemented for MVP.
- **Anonymous camp messages**: `sender_id` is stored on `messages` rows for future role abilities, but the UI never displays the sender.

## Workflow conventions

- Verify before pushing: `npx tsc --noEmit` then `npm run build` (build is what Vercel runs).
- Commits are messages like `"Playtest batch 2: consultation timer, host force-proceed, total SE on scoreboard, lobby kick/leave"`. Matthijs commits + pushes via VS Code Source Control (`Ctrl+Shift+G`).
- When changing the database, **always** create a numbered migration in `db/` AND update `db/schema.sql` to match. The user runs migrations manually in Supabase's SQL Editor.
- Realtime subscriptions are filtered by `room_id=eq.${roomId}`. Inserts/updates/deletes all trigger the same reload pattern (`event: "*"`) — the component re-fetches the relevant slice.

## Gotchas learned the hard way

- **Stale ready flags** ended phases instantly when realtime delivered the phase change before the player reset. Fixed with a `resetSeen` state in Minigame + RoleAction + Outreach: only trust "everyone done" after we've observed the reset land.
- **Dead/imprisoned host couldn't advance consultation** because the dead-screen early return blocked their Continue button. Fixed by only short-circuiting dead/prison/hospital screens *while voting is in progress*; once all voted, everyone falls through to the result + (host) Continue.
- **HTML entities** (`&mdash;` etc.) only render inside JSX text, not inside JS string literals — use real characters in strings.
- **Phone testing on LAN** requires the computer's IP in `allowedDevOrigins` in `next.config.ts`. If the IP changes, the dev server's `Network:` startup line shows the new one.
- **Stray `.ts` files in the project root** get type-checked by `next build` and fail because of `allowImportingTsExtensions`. Don't leave temp scripts there.

## Status and what's left

Implementation status: the **complete designed game is playable**. 12/12 abilities work, the 3-phase day cycle loops, win conditions trigger, succession + re-vote are wired in. Playtest iteration 1 feedback has been processed across 4 batches (bug fixes → functional adds → visual polish → top bar + character chip).

Outstanding design items (all deferred, none blocking play):

- **Group purchases / pot mechanic** in consultation (free prisoners, "revealing eye", etc.) — explicitly deferred.
- **Sacrifice-win condition** — majority self-sacrifice for a chosen player + team. Optional secondary win path; not yet built.
- **RLS tightening** — current policies are wide open. Must be replaced with restrictive policies before public launch.
- **PWA manifest** — `next-pwa` integration not set up.
- **i18n** — design calls for EN/NL/ES; Next.js i18n routing not wired.

## My (Claude's) memory location

I also keep auto-memory at `C:\Users\matth\.claude\projects\C--Users-matth-OneDrive-Desktop-Vice-and-Virtue\memory\` — `MEMORY.md` is the index. Read it if you want extra context on prior decisions; this file is the durable source of truth that travels with the repo.
