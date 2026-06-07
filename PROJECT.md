# Vice and Virtue — project context

A hybrid PWA party game — a Werewolves spinoff. 6–20 in-person players, each holding their secret role on their own phone. Built solo by Matthijs (idea owner, first-time coder) with AI assistance. Live and playtested.

If you are a fresh chat session: read this file first, then `AGENTS.md` for the Next.js version warning. Together they're enough to be productive.

---

## Stack

- **Next.js 16.2.6** — App Router, React 19, TypeScript, Tailwind v4, Turbopack
- **Supabase** — Postgres + Realtime + Auth + Storage. Game tables use open RLS for MVP (must tighten before launch); account tables (`profiles`, `friendships`, `user_achievements`) use real per-user RLS.
- **Vercel** — hosting, auto-deploys from `main`

**This Next.js version differs from older training data — always read `node_modules/next/dist/docs/` for the relevant API before writing Next.js code.** (`AGENTS.md` says the same.)

## Coordinates

| Thing | Where |
|---|---|
| Local project folder | `C:\Users\matth\OneDrive\Desktop\Vice and Virtue\vice-and-virtue\` |
| GitHub repo | https://github.com/matthijsansinger-hue/vice-and-virtue (branch `main`) |
| Live site | https://viceandvirtue.io (custom domain) — also https://vice-and-virtue-delta.vercel.app (auto-deploys on push). `metadataBase` in `layout.tsx` = the .io domain. |
| Auth URLs | Supabase → Authentication → URL Configuration: Site URL = `https://viceandvirtue.io`; Redirect URLs include both domains + `http://localhost:3000/**`. Email confirmation is ON. Sign-up `emailRedirectTo` = `window.location.origin`. |
| Supabase project ref | `xqvlseduirkvikkpatcb` (URL `https://xqvlseduirkvikkpatcb.supabase.co`) |
| Discord | https://discord.gg/Ju5K2cZquH (linked from the start screen) |
| Env vars | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key, in `.env.local` + Vercel). Analytics: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (`https://eu.i.posthog.com`) |
| Dev server | `npm run dev` in the project folder → `http://localhost:3000`. Phone via LAN at `http://192.168.2.41:3000` (allowlisted in `next.config.ts` — update IP if your router reassigns it) |

The dev server stops when the machine sleeps or the terminal closes — restart with `npm run dev` each session.

## Game design (current)

- **Players:** 6 min, 16 optimal, 20 max. Target session ~30–45 min.
- **Camps:** Vice vs Virtue. **12 roles** (see "Roles" below). Balanced assignment by tier S→A→B→C→D, equal camp counts (virtues get the extra on odd N).
- **Day cycle:**
  - **Reflection** — role-action (30s) → event_summary (host-advance) → minigame (95s) → result (host-advance)
  - **Outreach** — 120s one-on-one chats. **Mandatory phase** (the lobby on/off toggle was removed). Imprisoned players ARE eligible. DM history resets each day.
  - **Consultation** — group_action (60s: two simultaneous camp abilities, see below) → consultation vote (95s + 1 re-vote on tie) → new_day (4s splash). (The old `group_action_target` follow-up phase was removed.)
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
| Truthfulness | Virtue | C | 200 | After someone is imprisoned in consultation, reveal their voters to everyone. |
| Torment | Vice | C | 100 | Queue: target's minigame screen shows player names scrambled (seeded shuffle, no row keeps its real name). Clicks still tag the real row → wrong guesses. |
| Vengeance | Vice | C | 100 | When a Vice is imprisoned, guess a voter; correct = hospitalize them. Protect doesn't block. |
| Certainty | Virtue | B | 100 | Pick a player, reveal their **specific role** (not just camp). |
| Sacrifice | Virtue | C | free | Once per game: die + take another player. Queued in role-action (protect blocks); or instant in consultation (no protect). |
| Vice Worshipper | Vice | D | 20/char | Anonymous broadcast to all Vices, once per day. |
| Virtue Seeker | Virtue | D | 20/char | Anonymous broadcast to all Virtues, once per day. |

### Consultation group action (two simultaneous camp abilities, before the imprisonment vote)

Two camp-restricted abilities are decided at the same time in the `group_action` phase, each **once per game** (`eye_uses_left`/`free_uses_left` start at 1):

- **Revealing Eye (Vices only)** — active Vices vote Yes/No; fires if Yes > No. Reveals how many Vices and Virtues are still active, in a consultation banner shown to **everyone**. (`rooms.eye_revealed`.)
- **Free a prisoner (Virtues only)** — active Virtues vote for a prisoner to free or "Don't free"; **most votes wins** (tie or "don't free" lead → no one freed). The freed prisoner's `in_prison` is cleared. (`rooms.group_action_freed_id`.)

Both can fire in the same round. Players whose camp has no available action (already used / no prisoners / dead-prison-hospital) just wait. **No vote counts are shown in this phase** — the number of eligible voters per camp would leak camp sizes. Use counters decrement only when the action actually fires. Banners (Eye result, freed player) appear during consultation and clear next day. (`rooms.group_action_result` is legacy/unused.)

### Accounts, profiles, friends, stats & badges

Real accounts exist alongside guest play (Supabase Auth, email + password, **email confirmation ON**). **Joining a room stays guest-only; creating a room requires an account.** A logged-in player's `players.user_id` links their per-game row to their account.

- **Auth UI:** `AuthControl` (top-right of home) → `AuthModal` (login/sign-up). `useAuth()` hook tracks the session + profile. Login is by email (username login deliberately not built — would expose emails).
- **Profile (`/profile`):** avatar upload (client-side square-crop to 256px → Supabase Storage `avatars` bucket), username, stats, and badges. Favorite role was **removed** (its `profiles.favorite_role` column is left unused).
- **Stats:** computed from `game_results` (one row per account per finished game, written by the host on game-over via `lib/stats.ts` `recordGameResults`, marking a win for the whole winning camp incl. dead/imprisoned). Profile shows total games, wins, win rate, wins-per-role, and the last 5 games. `ProfileStats` is shared by self + friend profiles.
- **Friends (`/friends`):** username search → request → accept (per-user RLS: only the addressee can accept; either party can delete). Friends list shows "games played together" (shared `game_results.room_id`). `/profile/[id]` is a read-only view of any player (avatar, badges, stats, games-together).
- **Badges (`lib/badges.ts`):** an 83-badge catalog across five tiers (Divine → Noble → Primal → Verdant → Earthen), incl. a 60-badge per-role win matrix (1/5/15/40/100 wins → one threshold per tier) and totals/specials. **Medallions (`BadgesShowcase.tsx` `Medallion`, now exported) use painted per-tier frame art** (`public/badge-frame-<tier>.png`, AI art with the black background edge-flood-filled to transparency) — the old procedural SVG `Decor` is gone. Divine/Noble/Primal frames are **punched** (transparent centre): the icon is drawn *behind* the frame so the ring + cardinal gems sit in front, with each gem's gold setting preserved; Verdant/Earthen keep a solid frame with the icon on top. A per-tier ellipse `FRAME_WINDOW` + a `PUNCHED` flag drive the layout. **Role badges** show that role's tier-tinted character icon (`public/badge-icons/<role>-<tier>.png`, 12 roles × 5 tiers — a grey head colorized to the tier hue, on a dark recessed disc); **glyph badges** (no character art) show an inline icon on a per-tier `GLYPH_COIN` coin — dark+gold for most tiers, **white+gold (Divine)** and **purple+gold (Noble)** to match those bright frames. An optional `BadgeDef.glyphText` renders short text instead of an icon (the **Founder** badge shows "19" — it now triggers for the first **19** accounts, not 95, and its hover/popup shows the viewer's spot "n/19" via a `founderRank` threaded from `/profile`). Most badges derive live from `game_results` + account age; event/claim badges are keys in `user_achievements`. Discord badge auto-awards on clicking the home Discord link.
- **Badge UX:** **hover** a badge (PC) → a small text bubble anchored above it; **tap** a badge (phone) → a centered popup with the medallion + description + Earned/Locked. Within each tier, earned badges sort first. The same hover-tooltip + tap-popup is available on the game-over screen's newly-earned badges via the exported `BadgeTile` (self-contained interactive badge). Shared bits: `BadgeHoverBubble` + `BadgeDetailPopup`.
- **New badges on game-over:** the GameOver screen shows the badges you earned *this game* (`getNewlyEarnedBadges` in `achievements.ts` — diffs current earned vs "without this game", excluding this room's `game_results` and achievement keys created after `room.created_at`). Victory-intro functions record results *before* flipping to `game_over` so the diff is accurate.
- **Featured badges (`profiles.featured_badges text[]`, migration 038):** each account picks **2 of their earned badges** to showcase, via a "Featured badges" section on `/profile` (`FeaturedBadges.tsx` — two slots + an earned-badge picker modal; persists until replaced). Those badges render as small medallions (`h-9`) next to the player's name in the **lobby** and at **game over** (`ShowcaseBadges.tsx`), for account players only (guests have none). Lobby/GameOver batch-fetch `featured_badges` per account player.
- **Leaderboard:** a small "Leaderboard" button on `/profile` (above your stats) opens a popup of the **top 10 players by total wins worldwide** (`Leaderboard.tsx` + `lib/leaderboard.ts`, backed by the `leaderboard_top_wins(p_limit)` SECURITY DEFINER function, migration 040, aggregating `game_results` wins joined to `profiles`). Spots 1/2/3 are gold/silver/bronze; each row shows the player's featured badges and links to that player's `/profile/[id]`; the viewer's own row is highlighted.

### Auth emails & custom domain

- **Custom domain `viceandvirtue.io`** is the canonical site (also on Vercel). `metadataBase` = the .io domain.
- **Branded auth emails** (set in the Supabase dashboard → Authentication → Email Templates, NOT in the repo): wood/logo banner image + a gold (`#e3b510`) **bulletproof button** (background on a `<td>`, since Gmail strips `<a>` backgrounds). Templates done for all six types (confirm, reset, magic link, change email, invite, reauthentication). Banner asset is **`public/email-banner-v3.png`** (logo on solid brown `#4e3624` — small/fast; the heavy wood version was ~1.3MB and slow). Email tips: bake the banner as one `<img>` (clients don't render CSS bg images); add `bgcolor` attrs + `font-size:0` on the image cell + no `border-radius` to avoid white edges on mobile.
- **Email confirmation ON.** Sign-up `emailRedirectTo` → `/welcome` (a page that shows "you're in" once the client picks up the session). **Forgot-password** flow: `AuthModal` reset mode → `requestPasswordReset` → email → `/reset-password` page (recovery session → `updatePassword`). Sign-up has a confirm-password field; all password fields have a show/hide eye (`PasswordField`).
- **SMTP:** recommend Resend (own-domain sender, deliverability) — set up in the Supabase dashboard; built-in sender is rate-limited/spammy and fine only for testing.

### Analytics (PostHog)

Privacy-respecting product analytics on **PostHog Cloud EU**. Boots from `src/instrumentation-client.ts` (runs before hydration); all event names + properties live in `src/lib/analytics.ts` — the single source of truth. Call the typed `track*` helpers, never `posthog.capture` directly.

- **Privacy by construction:** EU host, `autocapture: false`, `disable_session_recording: true`, `persistence: 'localStorage'` (no tracking cookies), `person_profiles: 'identified_only'`. Accounts are identified by their **Supabase UUID only** (never email/username); guests keep PostHog's random device id (what makes retention work without PII). Turn on "Discard client IP data" in the PostHog project settings. Everything **no-ops when `NEXT_PUBLIC_POSTHOG_KEY` is unset** (local dev), so the app runs identically without analytics.
- **Identity:** `instrumentation-client.ts` subscribes to Supabase auth and calls `identifyUser(uuid)` on session / `resetUser()` on sign-out. `account_created` also identifies the new user from the signUp response.
- **Events** (snake_case): `account_created` (auth.ts `signUp`), `friend_added` + `invite_accepted`/friend (friends.ts `acceptRequest`), `invite_sent`/friend (friends.ts `sendFriendRequest`), `invite_sent`/room (Lobby copy-code), `invite_accepted`/room (room.ts `joinRoom`, fresh code-join only — rejoins and public matchmaking are NOT invites), `game_started` + `players_per_game` (Lobby host start), `game_completed` (GameOver, host-only, localStorage-guarded once per room).
- **Properties:** `game_id`, `player_count`, `visibility` ('public'|'private'), `platform` ('pwa'|'web'), `invite_type` ('room'|'friend'), `day_reached`. Timestamp, anon/session id, and `$os`/`$browser` are added by PostHog automatically.
- **Pageviews** are manual (`capture_pageview: false`): initial one in `instrumentation-client.ts`, subsequent via the exported `onRouterTransitionStart`.
- **Dashboard** lives in PostHog (insights + retention), not in-app (decided with Matthijs). Setup is dashboard config (his side), code is mine.

### Moderation & safety (public play)

Three layers, all in place:
- **Tiered text filter** (`lib/profanity.ts`) — general profanity is censored (still sends); slurs are hard-blocked via `cleanForSend()` on every chat send path + name validation. Defeats leetspeak, Unicode/homoglyph/zero-width tricks, and spaced-out letters.
- **Block** (`lib/blocks.ts` + `BlockedStrip`) — per-device, per-room. Hides a player's chat from you everywhere + drops them from your outreach partner list. Block buttons in the lobby + on chat messages + the outreach thread header; unblock via the BlockedStrip (or lobby). Pure client-side display filter — never affects game state. Works for guests + accounts.
- **Report + auto-mute** (`lib/reports.ts` + `report_player` RPC) — Report buttons sit next to Block (lobby, chat messages, outreach header). After **3 distinct** reporters in a game, the reported player is **auto-muted** (`players.muted` → realtime → their composers disable with "You've been muted for this game"). Mute is enforced client-side in all four composers (consultation/dead/camp/DM), consistent with the MVP threat model; full server-side enforcement folds into the pending RLS tightening. Every report is logged to the locked `reports` table for **manual review in the Supabase dashboard** (e.g. `select reported_user_id, count(distinct reporter_id) from reports group by 1 order by 2 desc`).

### Sound design (`lib/sound.ts`)

All sounds are **synthesized with the Web Audio API** (no audio files), through one shared `AudioContext` (unlocked by the first click). Fail-silent.
- **`playClick`** — a snappy wooden "tock" on every button/link (`ClickSound` is a global document-click listener mounted in `layout.tsx`).
- **`playWhoosh(ms)`** — deep "rushing through space" whoosh, fired by `LoreIntro` when the castle zoom starts.
- **`playVictoryMusic("vice"|"virtue")`** — ~10s songs on the win screens: Virtue = regal brass fanfare over a cheering crowd + timpani; Vice = a Brawl-Stars-lose-style descending minor dirge with a sad-trombone bend. Fired once on the victory-intro screens.
- **`playPrisonDoor`** — gate slam + metallic clang + latch, played by `Consultation` when the vote resolves to an imprisonment.

### Group-action & imprisonment notices

The Revealing Eye and freed-prisoner outcomes are shown as centered **"Proceed" popups** overlaying the consultation vote screen (queued: Eye, then freed), each with its emblem. Imprisonment is **not** a popup — the result screen shows the **imprisoned emblem** + "[name] has been imprisoned". Emblem assets: `public/eye-emblem.png`, `freed-emblem.png`, `imprisoned-emblem.png` (transparent). Win banners: `public/virtues-win-text.png`, `vices-win-text.png` (transparent emblems shown on the GameOver banner). `EventNotice` is a local component inside `Consultation.tsx`.

### Onboarding / tutorial

- **Walkthrough** (`Walkthrough.tsx`) — a swipeable, illustrated day-cycle carousel at the top of the "How to play" guide (`RulesGuide`), using existing art.
- **First-time tips** (`PhaseTip.tsx` + `lib/tips.ts`) — a dismissible "First-time tip" banner shown once per phase (role action / minigame / outreach / group action / consultation), remembered per device in localStorage (`vv_tip_*`).
- Clarity touches: camp goal on the role card + role popup ("Your camp wins when every Virtue/Vice is imprisoned or dead"); Soul Energy + "abilities cost SE" on the role-action screen; minigame scoring tip on the Game Overview; labelled TopBar phase segments (Reflect/Outreach/Consult, active highlighted); "best with 6+" lobby hint; "no account needed to join" home caption; expanded rules guide (scoring, camp powers, player states).

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
  supabase.ts                    # shared Supabase client (persists auth session)
  analytics.ts                   # PostHog: privacy-safe init + typed funnel-event helpers (single source of event names/properties). Booted from src/instrumentation-client.ts.
  types.ts                       # Room, Player, Profile, GameResult, Friendship, Message, DirectMessage, ConsultationMessage, DeadMessage, EventSummaryEntry; RoomPhase union
  player.ts                      # localStorage GUEST identity helpers (vv_player_id/name)
  auth.ts                        # signUp/signIn/signOut/getMyProfile (Supabase Auth)
  useAuth.ts                     # React hook: tracks logged-in profile + session changes
  profile.ts                     # updateProfile (favorite_role/avatar_url/featured_badges), cropToSquare, uploadAvatar (Storage)
  room.ts                        # createRoom / joinRoom (take optional userId). joinRoom is rejoin-aware: if this browser already has a player row in the room it returns that seat (no duplicate), even mid-game. Also findOrCreatePublicRoom (matchmaking RPC wrapper), setRoomVisibility (Public/Private toggle), and the 20-player code-join cap.
  roles.ts                       # ROLES record (12 entries) + getRole()
  assignRoles.ts                 # tier-ordered, camp-balanced distribution
  game.ts                        # ALL phase transitions, action queueing/resolution, win checks, achievement granting
  scoring.ts                     # rankPlayers() — minigame ranking + Soul Energy (zeroes SE for 0-raw-score players)
  stats.ts                       # recordGameResults (host, on game-over) + getUserStats (totals/wins/per-role/recent)
  leaderboard.ts                 # getLeaderboard() — top players by total wins (leaderboard_top_wins RPC)
  badges.ts                      # 83-badge catalog, 5 tiers, earn-condition evaluator + BadgeDef.glyphText
  achievements.ts                # read/award achievement keys, grantAchievements (host RPC), getEarnedBadges, getAccountOlderCount (Founder rank)
  friends.ts                     # search/request/accept/remove, getFriendData, gamesPlayedTogether
  sound.ts                       # Web Audio synth: playClick, playWhoosh, playVictoryMusic, playPrisonDoor (shared AudioContext)
  tips.ts                        # localStorage helpers for one-time first-time tips (vv_tip_*)
  swaps.ts                       # displayedName() — Envy swap + duplicate-name indexing. Takes optional viewerId so swap participants see real names.
  blocks.ts                      # In-game block list (localStorage per room, useBlockedIds hook). Hides a player's chat for you + removes them from your outreach partner list. Client-only display filter; never touches game state. Works for guests + accounts.
  reports.ts                     # Player reports: reportPlayer() calls the report_player RPC (auto-mutes after 3 distinct reporters); useReportedIds hook tracks "Reported" state per room (localStorage).
  profanity.ts                   # Tiered English filter. PROFANITY -> censorText() stars it (still sends); SLURS -> cleanForSend() hard-blocks (throws BlockedMessageError, used by every chat send path). containsProfanity() rejects bad names; containsSlur() is the hard-block check. Normalizes leetspeak/symbols/stretched letters + Unicode (NFKD/homoglyph/zero-width) + spaced-out single letters ("f u c k"). Tune via STEMS/WHOLE_WORDS (censor) + SLUR_STEMS/SLUR_WORDS (block).
  winConditions.ts               # checkWinner() — counts dead+imprisoned as out; Murder+1 endgame
  messages.ts                    # camp messages (Worshipper/Seeker)
  dm.ts                          # 1-on-1 messages (outreach) — takes `day` for per-day reset
  consultationChat.ts            # public chat during consultation
  deadChat.ts                    # dead-only chat across phases
src/components/
  Centered.tsx                   # full-screen centered layout helper
  RoleCard.tsx                   # role reveal card (uses /cards/<role-id>.png)
  TopBar.tsx                     # persistent: day, phase progress, host skip, player chip (camp RoleIcon) + role detail modal
  Lobby.tsx                      # create-room screen + kick/leave + account avatars + each player's featured badges
  GameOverview.tsx               # "The game begins": Walkthrough slideshow + clickable role list (this game's roles); all-proceed gate
  LoreIntro.tsx                  # castle bg + 3.5s zoom + 0.5s fade-to-black, synced via phase_ends_at
  RoleReveal.tsx                 # ready-up + card
  RoleAction.tsx                 # 30s window; per-role ability dispatch; CampMessagesPanel embed
  MurderSuccession.tsx           # dying-Murder picker / others see "resolving…"
  EventSummary.tsx               # role-action results: name + first-letter avatar in neutral brown, no role/camp shown; host clicks Continue
  Minigame.tsx                   # 95s timer, V/V/? tagging (? default-highlighted), Torment seeded name shuffle
  Result.tsx                     # scoreboard; "Common clue" panel (most-read player + correct/total, from room.minigame_clue); explainer banner for non-scoring players; always "Continue to outreach"
  Outreach.tsx                   # 120s, partner list ↔ chat thread; cross-chat notification; Done doesn't lock you out; DM history per-day
  GroupAction.tsx                # two camp ballots: Vice Eye (Yes/No) + Virtue free-a-prisoner; no vote counts shown
  Consultation.tsx               # voting + tally + re-vote + result; Eye/freed Proceed popups (EventNotice) over the vote screen; imprisoned emblem on result; Truthfulness; Sacrifice; plays playPrisonDoor
  NewDay.tsx                     # 4s splash before next day's role-action
  ViceVictoryIntro.tsx           # 1s silent beat + lore text + host Continue; plays victory song
  VirtueVictoryIntro.tsx         # mirror of vice intro
  GameOver.tsx                   # win-banner emblem, new-badges-this-game panel, all roles revealed (camp RoleIcon + each player's featured badges), "Play again" re-queue button, victory image bg
  CampMessagesPanel.tsx          # vice/virtue chat panel during role-action
  ConsultationChat.tsx           # public chat for consultation phase (per-day)
  BlockedStrip.tsx               # compact "Blocked: name ✕" unblock strip (mid-game unblock, since the lobby isn't reachable). Used in the chats + outreach.
  DeadChat.tsx                   # dead-only chat embedded on all passive "you're dead" screens
  RulesGuide.tsx                 # fullscreen rules overlay (Walkthrough carousel on top + scoring/camp-powers/states reference + role list with camp RoleIcons)
  Walkthrough.tsx                # swipeable illustrated day-cycle carousel; shared by RulesGuide + GameOverview (optional endNote prop)
  AuthControl.tsx                # top-right login/sign-up control + logged-in menu (Profile/Friends/Log out)
  AuthModal.tsx                  # login / sign-up / forgot-password modal; confirm-password; eye toggles
  PasswordField.tsx              # password input with a show/hide eye toggle (shared by AuthModal + reset page)
  PhaseTip.tsx                   # one-time dismissible "first-time tip" banner per phase
  ClickSound.tsx                 # global document-click listener → playClick (mounted in layout)
  ProfileStats.tsx               # shared stats display (summary + per-role wins + recent games)
  BadgesShowcase.tsx             # painted-frame tier badge medallions (punched frames + tinted character icons + per-tier glyph coins); hover bubble / tap popup; exports BadgesShowcase + BadgeTile + Medallion
  RoleIcon.tsx                   # camp-tinted character role icon (red vice / blue virtue) on a dark disc; used in guide, overview, top bar, Certainty, game-over
  ShowcaseBadges.tsx             # renders a player's featured badges as small medallions (lobby + game-over)
  FeaturedBadges.tsx             # /profile picker: two slots + an earned-badge modal to choose your 2 featured badges
  Leaderboard.tsx                # /profile button → popup of the top 10 by wins (gold/silver/bronze, featured badges, rows link to /profile/[id])
  abilities/
    EmpathyAction.tsx, CertaintyAction.tsx, MurderAction.tsx,
    JusticeAction.tsx, IntoxicationAction.tsx, VengeanceAction.tsx,
    TruthfulnessAction.tsx, SacrificeAction.tsx (mode: "queued" | "instant"),
    WorshipperSeekerAction.tsx, EnvyAction.tsx, TormentAction.tsx
src/app/
  page.tsx                       # home — logo, name + join/create (create gated behind login), AuthControl top-right, "no account to join" caption, Discord (auto-awards badge), rules modal, ClickSound
  layout.tsx                     # metadata title + metadataBase (viceandvirtue.io), OG/Twitter cards, Geist font, <ClickSound/>
  globals.css                    # Tailwind v4 @theme with phase color tokens + bg classes (viewport-pinned via fixed ::before + isolation:isolate)
  icon.png / apple-icon.png / opengraph-image.png / twitter-image.png  # file-convention assets auto-wired by Next.js
  welcome/page.tsx               # post-email-confirmation "you're in" landing
  reset-password/page.tsx        # set a new password from the reset email (recovery session)
  profile/page.tsx               # own profile — avatar upload, Friends link, Leaderboard button, stats, Featured-badges picker, badge grid
  profile/[id]/page.tsx          # read-only view of another player (badges, stats, games-together)
  friends/page.tsx               # friend search/requests/list (realtime)
  room/[code]/page.tsx           # phase router — loads room + players, realtime, dispatches to phase components, wraps in TopBar. Auto-resyncs (re-pulls room+players) on realtime re-subscribe, tab-visible, window focus, and network online — so a dropped/desynced client recovers without a manual refresh.
```

**`public/` assets of note:** phase backgrounds (`start-bg`, `lore-bg`, `minigame-bg`, `outreach-bg`, `consultation-bg`, `vices/virtues-win-bg`), `cards/<role>.png` (full role-reveal card art + lobby avatars), **`badge-frame-<tier>.png`** (painted badge frames; Divine/Noble/Primal have punched-out centres), **`badge-icons/<role>-<tier>.png`** (tier-tinted character heads for role badges), **`role-icons/<role>.png`** (camp-tinted character heads for in-game role icons), `email-banner-v3.png` (auth email header), `eye-emblem`/`freed-emblem`/`imprisoned-emblem.png` (group-action notices), `virtues-win-text`/`vices-win-text.png` (win banners), `logo.png`. New images often come from Matthijs's `Downloads/` with a near-white **or black** background — strip it to transparency with PIL (edge flood-fill); badge frames/icons are produced by reusable PIL scripts.

## Database schema (current — see `db/schema.sql` for full definition)

**rooms**
`id, code(unique), status(lobby|in_game|ended), is_public(public lobby flag, default false/Private), phase, phase_ends_at, day, outreach_enabled(legacy — outreach is now mandatory), last_imprisoned_player, vote_reveal, envy_swap_a/b, torment_target, pending_murder_death, revote_candidates(jsonb), recent_successor_id, last_events(jsonb), group_action_result(legacy/unused), group_action_freed_id, eye_revealed, eye_uses_left, free_uses_left, role_pool(jsonb), next_room_code(re-queue target lobby), minigame_clue(jsonb — shared most-read-player clue), created_at`

Where `phase` is one of: `lobby | game_overview | lore_intro | role_reveal | role_action | murder_succession | event_summary | minigame | result | outreach | group_action | consultation | new_day | vice_victory_intro | virtue_victory_intro | game_over`.

**players**
`id, room_id, user_id(→auth.users, NULL for guests), name, is_host, connected, role, ready, minigame_score, minigame_submitted_at, soul_energy, vote, in_prison, dead, in_hospital, acted_this_day, pending_action(kill|protect|intox|vengeance_guess|sacrifice|envy_swap|torment), pending_target, murder_kills, muted(auto-muted after repeated reports), created_at`

**reports** — `id, room_id(→rooms cascade), reporter_id, reported_id, reported_user_id(account, if any), reason, created_at`, unique(room_id, reporter_id, reported_id). RLS locked (no client policies) — only the `report_player()` SECURITY DEFINER RPC writes it; **review via the Supabase dashboard**. The RPC auto-mutes (sets `players.muted`) after 3 distinct reporters in a game.

**messages** — `room_id, camp, sender_id, text, created_at` (camp chat from Worshipper/Seeker; anonymous in UI)

**dm_messages** — `room_id, sender_id, recipient_id, day, text, created_at` (1-on-1 outreach chat, filtered to current day)

**consultation_messages** — `room_id, sender_id, day, text, created_at` (public consultation chat, per-day)

**dead_messages** — `room_id, sender_id, text, created_at` (dead-only side channel, no day filter — spans the game)

**profiles** — `id(→auth.users), username(unique, case-insensitive), favorite_role(unused), avatar_url, featured_badges(text[] — up to 2 showcased badge ids), created_at`. An `on_auth_user_created` trigger creates the row from sign-up metadata. RLS: world-readable, write-your-own. The `leaderboard_top_wins(p_limit)` SECURITY DEFINER function aggregates `game_results` wins joined to `profiles` for the leaderboard.

**game_results** — `id, user_id(→auth.users), room_id(no FK — survives room cleanup), role, camp, won, created_at`. One row per account per finished game. RLS: open (MVP).

**user_achievements** — `(user_id, key)` PK, `created_at`. Event/claim badge keys. RLS: world-readable, insert-your-own; plus a SECURITY DEFINER `grant_achievements(jsonb)` RPC the host uses to award keys to any player.

**friendships** — `id, requester_id, addressee_id, status(pending|accepted), created_at`, unique(requester,addressee). RLS: see-your-own; insert as requester; only addressee updates (accept); either party deletes.

RLS: the six game tables (`rooms`, `players`, `messages`, `dm_messages`, `consultation_messages`, `dead_messages`) + `game_results` use open policies (MVP). `profiles`, `friendships`, `user_achievements` use real per-user policies. Realtime publication includes the game/chat tables + `profiles` + `friendships`.

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
20. `020_profiles.sql` — `profiles` table + username unique index + on-signup trigger + RLS
21. `021_avatars_storage.sql` — public `avatars` Storage bucket + per-user write policies
22. `022_game_results.sql` — `players.user_id`; `game_results` table
23. `023_friendships.sql` — `friendships` table + per-user RLS
24. `024_camp_group_actions.sql` — `rooms.eye_revealed`; `free_uses_left` default → 1
25. `025_achievements.sql` — `user_achievements` table + RLS
26. `026_achievement_events.sql` — `players.murder_kills`; `grant_achievements(jsonb)` SECURITY DEFINER RPC
27. `027_room_cleanup.sql` — `pg_cron` + `cleanup_old_rooms()` SECURITY DEFINER fn; nightly job (`cleanup-old-rooms`, 04:00 UTC) deletes rooms >24h old, cascading to players + all chat tables. `game_results`/account tables unaffected.
28. `028_player_secrets.sql` — locked `player_secrets` table + `vv_role_camp()` + `submit_minigame_guesses()` (server-side scoring). ("Hide roles" batch 1.)
29. `029_reveal_abilities.sql` — `reveal_role` (Certainty) + `reveal_votes_empathy`. (batch 2)
30. `030_resolve_role_action.sql` — `vv_check_winner` + `resolve_role_action` + `choose_murder_successor` (role-action engine server-side). (batch 3a)
31. `031_resolve_consultation.sql` — `resolve_consultation` + `start_revote` + `instant_sacrifice`. (batch 3b-i)
32. `032_has_voted_and_tally.sql` — public `players.has_voted` + `consultation_tally`. (batch 3b-ii)
33. `033_truthfulness_vengeance.sql` — `reveal_votes_truthfulness` + `get_revealed_voters` + `vengeance_available`. (batch 3b-iii)
34. `034_group_action.sql` — `resolve_group_action` + `group_action_ready` + `count_active_camps`. (batch 3b-iv)
35. `035_lockdown_reads.sql` — `get_my_secrets` + `eligible_successors` + `reveal_all_roles` + `rooms.role_pool` (all secret READS server-sourced). (batch 4 step 1)
36. `036_lockdown.sql` — write RPCs (`submit_vote`/`queue_action`/`clear_room_votes`/`assign_roles_and_start`); **drop `players.role/vote/pending_action/pending_target`** + bridge triggers. Roles/votes stop being sent. (batch 4 step 2 — the lockdown)
37. `037_room_tells.sql` — `get_display_names` (Envy swap rendered server-side) + `get_my_secrets` returns per-viewer `is_dying_murder`/`is_recent_successor`/`is_tormented`; client stops reading the room "tells".
38. `038_featured_badges.sql` — `profiles.featured_badges text[]` (up to 2 showcased badge ids; picked on /profile, shown next to names in lobby + game-over)
39. `039_requeue.sql` — `rooms.next_room_code` (end-screen "Play again": the first re-queuer creates a new lobby and records its code here so others join the same one)
40. `040_leaderboard.sql` — `leaderboard_top_wins(p_limit)` SECURITY DEFINER fn aggregating `game_results` wins joined to `profiles` (profile-screen worldwide most-wins leaderboard)
41. `041_public_lobbies.sql` — `rooms.is_public` (default false/Private) + partial index for matchmaking. Host Public/Private toggle in the lobby.
42. `042_find_public_room.sql` — `find_or_create_public_room(name, user_id)` SECURITY DEFINER fn: "Find Public Session" joins the fullest open public lobby (< 12 players, FOR UPDATE SKIP LOCKED) or creates + hosts a new one. 12 is a matchmaking ceiling only; code-joins fill to the 20-player hard cap (enforced in `joinRoom`).
43. `043_find_public_rejoin.sql` — adds a 3rd arg `p_existing_player_id` to `find_or_create_public_room` (drops the 2-arg overload). Rejoin guard: if the browser already holds a seat in an open public lobby, return it instead of inserting a duplicate "puppet" row. Fixes back-then-research duplicating players (and orphaning the host row → stuck lobby).
44. `044_reports_mute.sql` — `players.muted` + locked `reports` table + `report_player(room, reporter, reported, reason)` SECURITY DEFINER RPC that logs a report (deduped per reporter/target/game) and auto-mutes after 3 distinct reporters. Review the `reports` table in the dashboard.
45. `045_minigame_clue.sql` — `player_secrets.minigame_guesses` (stores each player's V/V/? guesses) + `rooms.minigame_clue` + `compute_minigame_clue()` SECURITY DEFINER fn. `submit_minigame_guesses` now persists guesses; `endMinigame` (game.ts) calls `compute_minigame_clue` to publish the most-correctly-read player + counts (camp NOT revealed) as a shared clue on the Result screen.

## Key design decisions (rationale, not just behavior)

- **Soul Energy formula simplified** from `Y × M` (M = 1000/scoring-players) to `100 × 0.93^(rank-1)` so a rank is worth the same regardless of player count.
- **Wrong-guess penalty in minigame**: any explicit V/V mismatch zeroes both the raw score AND the SE awarded for that round. Implemented in two places (`computeScore` short-circuits to 0; `rankPlayers` awards 0 SE when raw score ≤ 0). Encourages players to leave uncertain rows as "?".
- **Guests + accounts coexist** — guests still use `localStorage` (`vv_player_id`/`vv_player_name`) and each join makes a new player row. Accounts (Supabase Auth) are required only to **create** a room; a logged-in player's `players.user_id` links the row so stats/badges accrue. Login is email-only on purpose (username login would need to expose emails).
- **Camp-restricted group action** — the old democratic Eye/Free/Skip vote was split into a Vice-only Revealing Eye and a Virtue-only free-a-prisoner, decided simultaneously, each once per game. No vote counts are shown in-phase because the eligible-voter count per camp would leak camp sizes. The `group_action_target` follow-up phase was removed (the prisoner choice folds into the Virtue ballot).
- **Badges** — derived badges (games/wins/per-role/account-age) are computed live from `game_results` + `profiles`; event/claim badges are recorded keys in `user_achievements`. Self-detectable events (minigame 1st, no-"?" minigame) are written by the player's own client; resolution-level events (Murder kills, kill-teammate, Justice protect, Envy escape, murdered-while-hospitalised, freed-from-prison) are granted by the **host** via the `grant_achievements` SECURITY DEFINER RPC (since RLS otherwise only lets a user write their own). The RPC bypasses RLS and is callable by anyone — an accepted MVP trust trade-off, on the pre-launch tightening list.
- **Action queue resolution** in `endRoleAction`: collect protects first → apply kills (skipping protected) → apply hospitalizations (skipping protected and just-killed) → check for Murder death → if successor candidates exist, enter `murder_succession` phase; else apply kill + win check. Sacrifice contributes to deaths from both sides (protect can spare either side). Vengeance hospital isn't blocked by protect.
- **Envy swap is purely visual** — `displayedName()` swaps names; clicking a row stores the real underlying id (the deceived outcome). **The swap is hidden from the swap participants themselves** (Envy + the victim see real names everywhere via the optional `viewerId` arg) so the victim can't catch the swap by seeing their own name on someone else's row.
- **Host orchestrates phase advances.** Most phases auto-advance on timer + all-ready (with a `resetSeen` guard). Result, Event Summary, Consultation result, Lore Intro, victory intros need explicit host clicks. TopBar exposes a "Skip" button.
- **Murder's role-card persists on the dead old Murder** when succession transfers the role — old dead row keeps `role="murder"` for the GameOver reveal; the new alive Vice gets their role updated to `"murder"`. Two rows with `role="murder"` is the intended state (one dead, one alive).
- **Outreach scope simplification:** any active or imprisoned player can chat with any other (dead/hospital see passive screens with the dead chat). After clicking Done you stay on the partner list / threads (no waiting screen) so you can still see and send messages until the phase ends.
- **DM history resets each day** so Empathy's voter reveal can't be cross-referenced with stale DMs about yesterday's votes. Messages stay in the DB; the Outreach component filters by `room.day`.
- **Anonymous role-action deaths**: EventSummary shows the dead player's name + first-letter avatar in neutral brown, but no role / camp / Fallen breakdown. Roles are only revealed publicly at `game_over`.
- **Group action uses are decremented only when the action fires** (Eye fired; a prisoner was actually freed). A tie / "don't free" lead frees no one and consumes no use.
- **Reset-seen guard for phases entered after a vote-clearing transition** (Consultation, GroupAction): the host's auto-advance only fires after we've observed `vote=null` on every active player. Without this, the previous phase's votes still appear set in the client's local state and the host auto-advances within ~1s.
- **Sync animations via `phase_ends_at`**: the LoreIntro zoom and victory intro fade-to-black are anchored to the absolute db timestamp, not to a local setTimeout from when the client received the realtime update. Otherwise slow clients miss the climax.
- **Transparent PNG via plain `<img>`**: Tailwind v4 compiles `scale-*` to CSS-variable updates which don't reliably trigger transform transitions, and Next.js's `<Image>` optimiser repackaged transparent PNGs in a way that left a visible checker pattern. The logo on home + lobby uses plain `<img>` (with a `?v=N` cache-buster) to dodge both.
- **Outreach is mandatory** — the lobby toggle was removed; Result and the host Skip always advance to outreach (`outreach_enabled` is now a dead column).
- **Viewport-pinned backgrounds** — the `cover` phase backgrounds zoomed in on tall/scrolling pages because `background-size:cover` scaled to the element's full height. Fixed by painting the image on a `position:fixed; inset:0; z-index:-1` `::before` (viewport-sized) with `isolation:isolate` on the host so the layer shows above the element's solid colour. **Do NOT put `position:relative` on these classes** — it overrides a `fixed` utility on overlays that reuse the class (this broke the rules overlay once). In-game screens use `pt-16` so content clears the (now taller, labelled) fixed TopBar.
- **Sounds are synthesized, not files** — see `lib/sound.ts`. One shared `AudioContext`, unlocked by the first click, reused for click/whoosh/victory/prison-door. Web Audio scheduled nodes keep playing after a component unmounts, so victory songs carry into the scoreboard.
- **Auth emails live in the Supabase dashboard**, not the repo — only the banner image (`email-banner-v3.png`) is in the repo. Gold buttons must be "bulletproof" (bg on a `<td>`, Gmail strips `<a>` bg); use `bgcolor` attrs + `font-size:0` image cell + no `border-radius` to avoid white edges on mobile; bake the banner as one `<img>` (no CSS bg images in email).
- **`grant_achievements` host RPC** — resolution-level event badges are granted by the host to any player via a SECURITY DEFINER RPC (RLS otherwise only allows writing your own). Record game results BEFORE flipping to `game_over` so the "new badges this game" diff is accurate.
- **Painted badge frames are punched, not layered** — Divine/Noble/Primal frame PNGs have a transparent centre hole, and the icon is drawn *behind* the frame so the ring + inward cardinal gems render in front of (and slightly over) the icon. A clean elliptical hole would clip the gems' inward-protruding gold settings, so the punch preserves warm-gold pixels near the cardinal axes that connect to the ring (drops floating crystal "wisps" via the same connectivity check). Verdant/Earthen keep a solid frame with the icon on top. The per-tier hole + window numbers are baked into the PNGs by a reusable PIL script and mirrored by `FRAME_WINDOW`/`PUNCHED` in `BadgesShowcase.tsx`. Icons are pre-tinted PNGs (not CSS-tinted) for exact per-tier/per-camp colour.
- **Re-queue = opt-in new lobby, not a same-room reset** — the end-screen "Play again" creates a *fresh* room; the first re-queuer (must be an account — room creation needs one) records its code on the finished room's `next_room_code` (atomic claim if still null, so simultaneous taps converge on one lobby), and everyone else who taps joins that code. Avoids resetting the finished room's locked `player_secrets`/state and lets non-participants stay on the results screen.

## Workflow conventions

- Verify before pushing: `npx tsc --noEmit` then `npm run build` (build is what Vercel runs).
- Commits are messages like `"Playtest batch 2: consultation timer, host force-proceed, total SE on scoreboard, lobby kick/leave"`. Matthijs commits + pushes via VS Code Source Control (`Ctrl+Shift+G`).
- **I (Claude) propose a commit message at the end of each turn**; Matthijs pastes it into VS Code, commits, then pushes. Always provide one after a feature change.
- When changing the database, **always** create a numbered migration in `db/` AND update `db/schema.sql` to match. Matthijs runs migrations manually in Supabase's SQL Editor — include the SQL inline in chat so he can copy-paste.
- Realtime subscriptions are filtered by `room_id=eq.${roomId}`. Inserts/updates/deletes all trigger the same reload pattern (`event: "*"`) — the component re-fetches the relevant slice.
- Ask clarifying questions BEFORE building substantial features. Matthijs prefers a quick `AskUserQuestion` round with recommended defaults over me guessing wrong and rebuilding.
- **Image assets:** Matthijs drops AI-generated art in `C:\Users\matth\Downloads\` (often a near-white or checkerboard background). I copy it into `public/` myself via Bash and **strip the background to transparency with Python + Pillow** (flood-fill from the edges so frames stay intact; clear enclosed pure-white if needed), then verify by Read-ing the image. I can't write the image bytes from a pasted chat image — it must exist as a file on disk. Composite/resize (e.g. the email banner) the same way (PIL).
- **Build to verify after every change** (`tsc --noEmit` + `npm run build`); they're cheap and catch issues before Matthijs pushes.

## Communication style with Matthijs

- **Direct, technical, and concise.** Matthijs codes solo with AI; he can read JSX/TS and benefits from precise commit messages, file links, and short explanations of trade-offs.
- **He wants real feedback when I have a view.** If something he proposes would be wrong, harmful, or there's a better alternative, say so plainly. Example exchange from this codebase: *"what do you think? would it be good to make it 0.5 second longer?"* — don't just agree; recommend with reasoning, then apply.
- **Iteration loops via screenshots + short asks.** He'll often paste an image with a one-line "do this" instruction. Read the image, propose the change, ask only if genuinely ambiguous.
- **He chooses recommended options.** When I use `AskUserQuestion` with a (Recommended) tag, he almost always picks it. Use that to move fast — make sensible defaults and label them clearly.
- **Step-by-step on big batches.** This is a strong preference he stated up front: *"after every batch you should ask for feedback, so don't build everything in one go."* Split multi-feature work into logical sub-batches, build between each, and **stop for feedback** before moving on — even when he says "add everything."
- **Always offer a commit message.** End of every functional change → a ready-to-paste commit message block. He commits + pushes himself via VS Code; he then runs any SQL migration in the Supabase SQL Editor (give it inline).
- **He provides assets + dashboard config, I provide code + guidance.** Emails, SMTP, domain DNS, running migrations, and pasting templates are his side (in dashboards) — give exact click-by-click steps. Art comes from his Downloads; I wire it in.
- **Avoid emojis** unless he uses them first (this applies to my prose; in-game UI icons/emblems are fine).
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
- Multiple players show up live as they join (account players show their avatar + featured badges; guests show an initial).
- Host can kick; players can leave.
- Start Game → Game Overview ("The game begins": walkthrough slideshow + this game's role list) → Lore Intro → Role Reveal flow. (No outreach toggle — outreach is always on.)
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

### Group action (Vice Eye + Virtue free-a-prisoner, simultaneous)
- Vices see the Eye Yes/No ballot only while `eye_uses_left > 0`; Virtues see the free-a-prisoner ballot only with prisoners present and `free_uses_left > 0`.
- Players with no available action (wrong camp / used up / no prisoners / dead-prison-hospital) see "Nothing to decide" and wait.
- **No vote counts are shown** anywhere in this phase (would leak camp sizes).
- Eye fires only if Yes > No; freeing is most-votes-wins (tie / "don't free" → nobody freed).
- Both can fire the same round → both banners show in consultation (Eye counts to everyone; freed player).
- Use counts decrement ONLY when an action actually fires; each is once per game.
- Consultation chat input is NOT wiped while the phase timer ticks.
- **Important sync check:** test multiple consecutive days — the phase should NOT auto-skip on day 2+ (resetSeen guard); and when both abilities are exhausted it should advance promptly (no 60s dead wait).

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
- Account players show their camp RoleIcon + featured badges on each revealed row.
- **Re-queue:** the first logged-in player taps "Play again" → lands in a fresh lobby as host; other players' button flips to "Join the re-queue" (realtime) and lands them in the same lobby; guests can join once it exists but can't start it; non-tappers stay on the results screen.

### Accounts / profiles / friends / badges
- Sign up (email + username + password) → confirmation email → log in → username shows top-right.
- "Create a room" is blocked when logged out, works when logged in; joining works as a guest.
- Profile: upload a photo (crops square), stats reflect game_results, badges show earned/locked grouped by tier (painted frames; Divine/Noble glyph coins white/purple-gold; Founder shows "19" + your n/19 spot).
- Friends: search → request → accept; friends list shows games-together; tap opens their read-only profile.
- Event badges record going forward for logged-in players (Sharpest Eye, Unwavering, Jailbreak, Bloodletter/Reaper, Betrayer, Guardian, No Mercy, Face Stealer).
- **Featured badges:** pick 2 on /profile (slots + earned-badge modal); they show next to your name in the lobby + game-over and persist until replaced; guests show none.
- **Leaderboard:** the /profile button opens the top-10-by-wins popup (gold/silver/bronze, featured badges, your row highlighted); each row links to that player's /profile/[id].
- In-game role icons (guide, overview, top-bar chip, Certainty reveal, game-over) show the camp-tinted character head (red vice / blue virtue).

### Sound, emails & onboarding
- A wooden click plays on button presses; the castle-entry whoosh plays during the lore zoom; victory songs play on the win screens; the prison-gate slam plays when someone is imprisoned. (All synth; need a prior click to unlock audio — gameplay provides that.)
- Group action: Eye / freed show as queued "Proceed" popups over the vote screen; imprisonment shows the emblem on the result screen (no popup).
- First-time tips show once per phase (clear localStorage / incognito to re-see); they sit below the TopBar, don't block the timer.
- "How to play" opens with the swipeable walkthrough, then the reference; opens as a full-screen overlay (not pushed below the home screen).
- Auth emails: branded banner + gold bulletproof button, no white edges on mobile; confirm link → /welcome; reset link → /reset-password.

### Sync / race conditions
- All resetSeen-guarded phases (Consultation, GroupAction) must NOT auto-skip on day 2+.
- LoreIntro fade-to-black appears on every client (host + slow phone).
- Phase advances on all clients within ~500ms of each other.
- Reload mid-phase: client picks up the current state cleanly (no permanent loading state).

## Status and what's left

Implementation status: the **complete designed game is playable** plus several iteration batches on top. 12/12 abilities work; the full day-cycle loops through all sub-phases; win conditions trigger (including Murder endgame); succession, re-vote, camp-restricted group action, victory intros, dead chat, rules guide, custom backgrounds, logo + favicon + OG metadata, Discord link all wired in.

**Accounts & social layer (done):** Supabase Auth accounts, profile page with avatar upload + favorite-role-replaced-by-badges, lifetime stats from `game_results`, friends (request/accept + games-together), and an 83-badge achievements system (derived + in-game event badges). Custom domain `viceandvirtue.io` connected.

**Polish layer (done):** branded auth emails (confirm + reset + 4 more) with a custom domain banner; full forgot-password flow + post-confirmation `/welcome`; synthesized sound design (clicks, castle whoosh, victory songs, prison-door); illustrated win-banner emblems on GameOver + new-badges-this-game panel; group-action "Proceed" popups + imprisonment emblem; badge hover/tap descriptions; role art used for in-game role icons + lobby account avatars; outreach made mandatory; a clarity/onboarding pass (camp goal, SE↔ability, labelled loop, expanded rules) + an illustrated walkthrough + per-phase first-time tips.

**Badges & profile (latest batch — done):** the badge medallions were rebuilt on **painted per-tier frame art** (`badge-frame-<tier>.png`), with punched centres on Divine/Noble/Primal so the ring + cardinal gems sit over the icon, **tier-tinted character icons** for role badges, and per-tier glyph coins (white+gold Divine, purple+gold Noble). The **Founder** badge is now first-19 and shows the viewer's "n/19" spot. In-game role icons are **camp-tinted character heads** (red vice / blue virtue, `RoleIcon`) across the guide, overview, top bar, Certainty and game-over. Players can **feature 2 badges** that show next to their name in the lobby + game-over; the pre-game "The game begins" screen plays the **walkthrough slideshow** + this game's role list; the end screen has an opt-in **re-queue** button (gathers re-queuers into a fresh lobby); and `/profile` has a **worldwide most-wins leaderboard** popup (top 10, gold/silver/bronze, featured badges, rows link to player profiles). Migrations 038–040.

Outstanding design items (all deferred, none blocking play):

- **Sacrifice-win condition** — majority self-sacrifice for a chosen player + team. Optional secondary win path; not yet built.
- **Hide secret fields — DONE (migrations 028–037, "hide roles for real").** Players' `role`/`vote`/`pending_action`/`pending_target` moved to a locked-down `player_secrets` table (no anon access; not in the realtime publication) and the `players` columns were **dropped**. The whole engine now runs in Postgres `SECURITY DEFINER` functions reading `player_secrets`: minigame scoring (`submit_minigame_guesses`), reveals (`reveal_role`/`reveal_votes_empathy`/`reveal_votes_truthfulness`/`get_revealed_voters`/`count_active_camps`/`vengeance_available`), resolution (`resolve_role_action`/`resolve_consultation`/`resolve_group_action`/`choose_murder_successor`/`instant_sacrifice`/`start_revote`/`vv_check_winner`), writes (`submit_vote`/`queue_action`/`clear_room_votes`/`assign_roles_and_start`), and reads (`get_my_secrets` for your own, `eligible_successors`/`reveal_all_roles`/`get_display_names` for others, `rooms.role_pool` for the role list). The browser only ever receives **its own** secrets. Threat model: no per-player auth, so RPCs are keyed on a `player_id` only bypassable by someone who already knows another player's hidden UUID — fine for in-person play; add Supabase anonymous auth + RLS for true enforcement later.
  - Room "tells" (`envy_swap_a/b`, `torment_target`, `pending_murder_death`, `recent_successor_id`) are hidden from the client via per-viewer RPCs (`get_my_secrets` flags + `get_display_names`); they remain in the `rooms` table server-side (a `room_secrets` split would also remove them from raw realtime frames — optional follow-up).
- **RLS tightening (still open)** — the open game-table policies + `game_results` + the anyone-callable `grant_achievements` RPC are still permissive; tighten before public launch (the role data itself is now protected regardless, since it lives in the locked `player_secrets`).
- **Custom SMTP (Resend)** — recommended before launch so confirmation/reset emails actually deliver (the built-in Supabase sender is rate-limited and spam-prone). Dashboard config.
- **PWA manifest** — `next-pwa` integration not set up.
- **i18n** — design calls for EN/NL/ES; Next.js i18n routing not wired.
- **Optional niceties discussed, not built:** a "reset tips" control to replay first-time tips; matching portrait email banners already swapped to `email-banner-v3.png`.

## Gotchas learned the hard way

- **Stale ready flags / votes** ended phases instantly when realtime delivered the phase change before the clearing-write landed. Fixed with `resetSeen` guards in Minigame, RoleAction, Outreach, Consultation, GroupAction. **Apply the same pattern any time a new phase is entered with vote/ready clearing.**
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
