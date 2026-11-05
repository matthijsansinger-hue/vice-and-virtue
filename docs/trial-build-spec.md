# BUILD SPEC — The Trial (Consultation rework) · 2026-11-05

**Authoritative.** Overrides `docs/consultation-procedure.md` wherever they differ (that file: background, examples, side effects).
Read `AGENTS.md` first (Next.js version differs — check `node_modules/next/dist/docs/`). All amounts = Soul Energy (SE). Numbers are *tunable* constants.

## 1 · Rules
**Flow:** `docket` 75 s → (no charges ⇒ "Court adjourned", nobody jailed ⇒ `new_day`) → `against` 30 s → `defence` 30 s → `verdict` 45 s → `settlement` → `new_day`.
**Can act** (press, back, file exhibit, object, vote) = alive, not in prison, not in hospital. **Witness** = any living player (hospital/prison OK).

**Docket.** *Press* 1×/player/day: `vice` (always) · `murder` (victim died today, from `kill_log`; return ids only — the log is secret) · `false_witness` (defendant sent the presser a DM today). Defendant: alive, not in prison, not self. Stake 25/50/75/100. Pressing an identical charge (defendant + kind + victim) backs it instead and doesn't use the press. *Back* in +25 steps, cap 100 per player per charge (press stake counts), never on a charge against yourself, **no withdrawals**. Everything public, live (charge, pot, every backer + amount, feed).
**Close:** per-defendant total = all backing on all charges against them. **Highest total is the only defendant** (tie → more distinct backers → earliest press). Banner shows their largest charge (tie: vice > murder > false_witness) plus the others. **Every backer of any charge against them is a prosecutor; all other charges are refunded at close.**

**Trial (one).** Majority-advance per half (`useMajorityAdvance`, 10 s). Every new exhibit or counterproof adds 10 s to the current half, max +30 s per trial.
- **Exhibit** (`P1, P2…`): `against` half only; any actor except defendant/witness; 1 per player; **50 → pot**.
- **Witness:** defendant calls 1 player with no stake (not a backer, not an exhibit filer), either half; 15 s to accept/refuse, half held open while pending; no answer = refused. Public.
- **Counterproof** (`D1`): the accepted witness only, **exactly 1 per trial**, 50 (witness's own stake, not in pot).
- **Exhibit kinds (v1):** `quiz_peek{day,target,camp}` · `quiz_hint{day,a,b,form:'opposite'|'at_least_one',camp?}` · `msg_received{day,from,payload}` · `msg_sent{day,to,payload}`. Composer pre-fills the filer's genuine data; editing = forgery (private warning to filer only). Only *plausible* filings allowed: quiz kind must match the filer's `quiz_log` for that day; a msg needs a DM between those two that day. Genuineness computed at filing, stored **locked**.
- **Objections** (50, each piece once, ruling instantly public as `FORGED`/`UPHELD` — never the underlying truth):

| Target | Who may object | Forged | Genuine |
|---|---|---|---|
| Prosecution exhibit | actors except its filer | objector gets **100** (own 50 + filer's 50); exhibit struck, its 50 leaves the pot | objector's 50 → filer; marked upheld |
| Counterproof D1 (**max 1 objection**) | actors except defendant and witness | objector gets **100** (own 50 + witness's 50); D1 struck | objector's 50 → **defendant**; D1 marked upheld |

- Defendant may speak, call the witness, object to prosecution exhibits — **may not file exhibits**.

**Verdict** (all-voted or timer; no majority-advance). Jurors = actors except the defendant. **Guilty = `player_secrets.vote = <defendant id>`, Not guilty = `'skip'`, blank = null** — reuse `submit_vote` so Iron Will (×2), Empathy, Truthfulness, Vengeance jailers and the vote-reveal potion keep working. **Guilty ⇔ weighted Guilty > weighted Not guilty and Guilty ≥ 2.** Tie → Love's armed tie-break decides by Love's vote, else Not guilty. No re-vote. Guilty ⇒ **imprisoned**; Not guilty ⇒ **spared**. Wandering Soul ward blocks prison ⇒ everyone refunded.

**Settlement** (inside `resolve_consultation_impl`, after imprisonment). Pot = all backing + standing prosecution exhibits. **Imprisoned:** every prosecutor gets **2×** what they put in (backing + standing exhibits); counterproof lost. **Spared:** pot split 50/50 defendant/witness (all to defendant if no witness accepted); standing counterproof back **2×** to witness. SE floor 0. Show **every player's** payout lines publicly (all derived from public data) + own total highlighted. Update reputation counters.

**Visibility.** Public: docket, stakes, exhibits + status, witness call/answer, objections + rulings, Guilty/Not-guilty counts after close, outcome, payouts, reputation, **court record** (per player per day: quiz kind `points|hint|peek`, DM pairs → / ↔, dead marked †, past trials). Private: own SE; filer's forgery warning; witness prompt; genuineness of unchallenged exhibits (filer + dead only); individual votes (dead + vote-reveal holder, as today). Never shown: quiz targets/results, message text (unless filed), roles, votes.

## 2 · Build
**First (prereqs):** `player_secrets.quiz` is **overwritten daily** → add `quiz_log(room_id, day, player_id, kind, target_id, result jsonb)` written by the 122 quiz functions; record + quiz exhibits read it. Confirm `dm_messages` persist for every day.
**Migration 136+** (mirror into `db/schema.sql`): `court_charges(id, room_id, day, defendant_id, kind, victim_id, pressed_by, created_at)` · `court_stakes(charge_id, player_id, amount)` · `court_exhibits(id, room_id, day, number, side 'P'|'D', filer_id, kind, payload, cost, status 'standing'|'upheld'|'forged')` · `court_exhibit_truth(exhibit_id, genuine)` **locked** · `court_witness(room_id, day, witness_id, status, called_at)` · `court_objections(exhibit_id unique, objector_id, ruling)` · `court_reputation(room_id, player_id, counters jsonb)` · `rooms.court_step`, `rooms.court_defendant_id`.
**RPCs** (each `vv_is_me` + phase/step guards + per-day limits; logic in `<fn>_impl`, never overwrite a gated wrapper — see `db/112_host_gate_repair.sql`): `press_charge`, `back_charge`, `file_exhibit`, `call_witness`, `answer_witness`, `file_counterproof`, `object_exhibit`; `court_close_docket`, `court_settle` (host/server only). Exhibit/counterproof RPCs push `phase_ends_at` (cap +30 s).
**Phase machine:** host rooms → `game.ts` (replace `CONSULTATION_SECONDS` with per-step constants); server rooms → `vv_tick_room` + `vv_srv_start_consultation` step `court_step`; `vv_srv_electorate` counts bots ready. Gates count humans only (`pacers()` in `lib/bots.ts`).
**Client:** split `Consultation.tsx` (896 lines) → `CourtDocket`, `CourtTrial` (both halves), `ExhibitComposer`, `ExhibitCard`, `CourtVerdict`, `CourtSettlement`, `CourtRecord`. Delete the dead `minigame_clue` block (not computed since 122). Update `RulesGuide`, `lib/tips.ts`, `PROJECT.md`.
**Bots:** press/back vs known or suspected enemy (never into `vv_bot_reserve`); file genuine exhibits, Vices forge at bluff rate; accept witness only for believed allies; object when an exhibit contradicts `bot_memory.known`; `vv_bot_vote` restricted to `{defendant, 'skip'}`.
**Out of scope (phase 2):** ability/market exhibits — need a `player_results` log.
**Workflow:** Matthijs runs SQL in the Supabase SQL editor and commits himself — end every change with the migration inline + a ready-to-paste commit message.

## 3 · Acceptance
1. No charges ⇒ adjourned, nobody jailed, no SE moved. 2. Bob Vice 100 + Murder 25, Anna 100 ⇒ Bob tried, all 3 Bob-backers prosecutors, Anna's backers refunded. 3. 5th +25 on one charge rejected; withdrawal impossible. 4. Exhibit in `defence` rejected; 2nd exhibit by same player rejected; defendant can't file. 5. 2nd counterproof rejected; 2nd objection on D1 rejected; defendant/witness can't object to D1. 6. D1 forged ⇒ objector +50 net, witness −50, all see FORGED; D1 genuine ⇒ objector −50, defendant +50. 7. Forged P-exhibit ⇒ struck, pot −50. 8. 4G–3NG ⇒ jailed, prosecutors 2×; 3G–3NG no Love ⇒ spared, pot split, counterproof 2×; 1G–0NG ⇒ spared. 9. Defendant's own vote rejected; Iron Will counts 2. 10. Truthfulness/Vengeance/Empathy read Guilty voters unchanged. 11. Server room full of bots completes without a stall. 12. Hospitalised: can't press/back/vote/object; can be witness and file counterproof.
