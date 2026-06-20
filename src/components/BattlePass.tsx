"use client";

import { useEffect, useState } from "react";
import {
  IconX,
  IconLock,
  IconCheck,
  IconSparkles,
  IconChevronLeft,
  IconChevronRight,
  IconGhost2,
} from "@tabler/icons-react";
import {
  getSeason,
  claimSeasonTier,
  buySeasonPremium,
  tierReward,
  SEASON_NAME,
  SEASON_TIERS,
  SEASON_XP_PER_TIER,
  SEASON_PREMIUM_PRICE,
  type SeasonState,
  type SeasonRewardKind,
} from "@/lib/season";
import { type AccountEconomy } from "@/lib/economy";
import { plaqueStyle, PlaqueLayers, CornerFrame } from "@/components/ui/royal";
import { SoulShardIcon, LifeProficiencyIcon, ManoIcon } from "./CurrencyIcons";

type NodeState = "locked" | "claimable" | "claimed" | "needs_premium";

const PER_PAGE = 5; // tiers shown per desktop page
const PAGE_BG =
  "linear-gradient(rgba(10,9,28,.55), rgba(10,9,28,.72)), url('/spirit-bg.png?v=1') center / cover";

// The season pass overlay. Two tracks (free + premium); each tier's reward is
// claimable once reached. Desktop shows 5 bigger tiers per page (arrow-paged)
// with the premium row on top; mobile scrolls all tiers with premium on the
// right. Every tier is a brown-plaque panel like the hub's Play cards.
export function BattlePass({
  econ,
  onClose,
  onChanged,
}: {
  econ: AccountEconomy | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [season, setSeason] = useState<SeasonState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    getSeason().then((s) => {
      setSeason(s);
      if (s) {
        const last = Math.ceil(SEASON_TIERS / PER_PAGE) - 1;
        setPage(Math.min(last, Math.max(0, Math.floor((Math.max(1, s.tier) - 1) / PER_PAGE))));
      }
    });
  }, []);

  async function refresh() {
    const s = await getSeason();
    setSeason(s);
    onChanged();
  }

  async function claim(t: number, premium: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await claimSeasonTier(t, premium);
      if (res.ok) await refresh();
      else if (res.reason === "no_premium") setError("Unlock the premium pass first.");
      else if (res.reason === "locked") setError("You haven't reached that tier yet.");
      else if (res.reason !== "claimed") setError("Couldn't claim that tier.");
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function buyPremium() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await buySeasonPremium();
      if (res.ok || res.reason === "owned") await refresh();
      else if (res.reason === "insufficient") setError("Not enough Mano.");
      else setError("Couldn't unlock the premium pass.");
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const tier = season?.tier ?? 0;
  const maxed = tier >= SEASON_TIERS;
  const intoTier = maxed ? SEASON_XP_PER_TIER : (season?.seasonXp ?? 0) - tier * SEASON_XP_PER_TIER;
  const prog = maxed ? 1 : Math.max(0, Math.min(1, intoTier / SEASON_XP_PER_TIER));
  const mano = econ?.mano ?? 0;

  function stateFor(t: number, premium: boolean): NodeState {
    const reached = t <= tier;
    if (premium && !season?.premium) return "needs_premium";
    const claimed = (premium ? season?.claimedPremium : season?.claimedFree)?.includes(t) ?? false;
    if (claimed) return "claimed";
    if (!reached) return "locked";
    return "claimable";
  }

  const allTiers = Array.from({ length: SEASON_TIERS }, (_, i) => i + 1);
  const pageCount = Math.ceil(SEASON_TIERS / PER_PAGE);
  const pageTiers = allTiers.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <div className="fixed inset-0 z-30 flex flex-col text-cream" style={{ background: PAGE_BG }}>
      {/* Header */}
      <div className="shrink-0 border-b border-gold/20 bg-black/30 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.3em] text-cream/55">Season 1</p>
            <h1
              className="truncate text-2xl font-bold"
              style={{ color: "#c9b8ff", textShadow: "0 1px 3px rgba(40,30,80,.9)", fontFamily: "var(--font-uncial), serif" }}
            >
              {SEASON_NAME}
            </h1>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/50 text-cream/80 transition-colors hover:text-cream"
          >
            <IconX size={20} aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="shrink-0 text-sm font-semibold text-gold">
            Tier {tier}
            <span className="text-cream/40"> / {SEASON_TIERS}</span>
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/45 ring-1 ring-white/10">
            <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.round(prog * 100)}%` }} />
          </span>
          <span className="shrink-0 text-xs text-cream/55">
            {maxed ? "Maxed" : `${Math.round(intoTier)}/${SEASON_XP_PER_TIER} XP`}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {season?.premium ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/60 bg-violet-500/20 px-3 py-1 text-xs font-semibold text-violet-100">
              <IconCheck size={13} aria-hidden /> Premium unlocked
            </span>
          ) : (
            <button
              onClick={buyPremium}
              disabled={busy || mano < SEASON_PREMIUM_PRICE}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              title={mano >= SEASON_PREMIUM_PRICE ? "Unlock the premium pass" : "Not enough Mano"}
            >
              <IconSparkles size={15} aria-hidden /> Unlock Premium
              <span className="inline-flex items-center gap-1">
                <ManoIcon size={13} /> {SEASON_PREMIUM_PRICE}
              </span>
            </button>
          )}
          {error && <span className="text-xs text-red-200">{error}</span>}
        </div>
      </div>

      {/* Mobile: vertical scroll of all tiers (premium on the right). */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 lg:hidden">
        {allTiers.map((t) => (
          <TierPanel
            key={t}
            t={t}
            freeKind={tierReward(t, false)}
            premKind={tierReward(t, true)}
            freeState={stateFor(t, false)}
            premState={stateFor(t, true)}
            onClaim={claim}
          />
        ))}
      </div>

      {/* Desktop: 5 bigger tiers per page with left/right arrows. */}
      <div className="hidden flex-1 items-center gap-3 px-4 py-6 lg:flex">
        <PageArrow dir="left" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} />
        <div className="flex flex-1 items-stretch justify-center gap-4">
          {pageTiers.map((t) => (
            <TierPanel
              key={t}
              t={t}
              freeKind={tierReward(t, false)}
              premKind={tierReward(t, true)}
              freeState={stateFor(t, false)}
              premState={stateFor(t, true)}
              onClaim={claim}
              desktop
            />
          ))}
        </div>
        <PageArrow dir="right" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} />
      </div>

      {/* Footer: page indicator (desktop) + legend. */}
      <div className="shrink-0 border-t border-gold/20 bg-black/30 px-4 py-2 text-center text-[11px] text-cream/55 backdrop-blur-sm sm:px-6">
        <span className="hidden lg:inline">
          Tiers {page * PER_PAGE + 1}–{Math.min(SEASON_TIERS, (page + 1) * PER_PAGE)} of {SEASON_TIERS} ·{" "}
        </span>
        Premium = violet · rotates Soul Fragment → 100 LP → 10 Mano · premium T1 = Spirit banner, T50 = First Soul badge
      </div>
    </div>
  );
}

function PageArrow({ dir, disabled, onClick }: { dir: "left" | "right"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Previous tiers" : "Next tiers"}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gold/50 bg-black/40 text-gold transition-colors hover:bg-black/60 disabled:opacity-25"
    >
      {dir === "left" ? <IconChevronLeft size={26} aria-hidden /> : <IconChevronRight size={26} aria-hidden />}
    </button>
  );
}

function TierPanel({
  t,
  freeKind,
  premKind,
  freeState,
  premState,
  onClaim,
  desktop = false,
}: {
  t: number;
  freeKind: SeasonRewardKind;
  premKind: SeasonRewardKind;
  freeState: NodeState;
  premState: NodeState;
  onClaim: (t: number, premium: boolean) => void;
  desktop?: boolean;
}) {
  return (
    <div
      className={
        "group relative overflow-hidden rounded-2xl border border-gold/30 " +
        (desktop ? "flex flex-1 flex-col items-center justify-center gap-3 p-4" : "flex flex-row-reverse items-center justify-center gap-3 p-2.5")
      }
      style={plaqueStyle()}
    >
      <PlaqueLayers />
      <CornerFrame />
      <div className="relative">
        <TierNode kind={premKind} state={premState} premium big={desktop} onClaim={() => onClaim(t, true)} />
      </div>
      <span
        className={
          "relative flex shrink-0 items-center justify-center rounded-full border border-gold/50 bg-black/40 font-bold text-gold " +
          (desktop ? "h-9 w-9 text-base" : "h-7 w-7 text-xs")
        }
      >
        {t}
      </span>
      <div className="relative">
        <TierNode kind={freeKind} state={freeState} big={desktop} onClaim={() => onClaim(t, false)} />
      </div>
    </div>
  );
}

function TierNode({
  kind,
  state,
  premium = false,
  big = false,
  onClaim,
}: {
  kind: SeasonRewardKind;
  state: NodeState;
  premium?: boolean;
  big?: boolean;
  onClaim: () => void;
}) {
  const claimable = state === "claimable";
  const ring =
    state === "claimable"
      ? "border-gold bg-gold/20 shadow-[0_0_14px_rgba(227,181,16,.6)] cursor-pointer"
      : state === "claimed"
        ? "border-cream/20 bg-black/35 opacity-65"
        : state === "needs_premium"
          ? "border-violet-400/50 bg-black/30 opacity-75"
          : "border-cream/15 bg-black/25 opacity-50";
  return (
    <button
      type="button"
      onClick={claimable ? onClaim : undefined}
      disabled={!claimable}
      className={
        "relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border-2 transition-shadow " +
        (big ? "h-20 w-20 " : "h-14 w-14 ") +
        (premium ? "ring-1 ring-violet-400/40 " : "") +
        ring
      }
    >
      <RewardIcon kind={kind} big={big} />
      {state === "claimed" && (
        <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
          <IconCheck size={big ? 30 : 22} className="text-green-300" aria-hidden />
        </span>
      )}
      {state === "needs_premium" && (
        <span className="absolute right-1 top-1 text-violet-300">
          <IconLock size={big ? 14 : 12} aria-hidden />
        </span>
      )}
    </button>
  );
}

function RewardIcon({ kind, big }: { kind: SeasonRewardKind; big: boolean }) {
  if (kind === "cosmetic") {
    return (
      <>
        <span
          className={"rounded bg-cover bg-center " + (big ? "h-9 w-14" : "h-6 w-10")}
          style={{ backgroundImage: "url('/banners/spirit.png?v=1')" }}
        />
        <span className={(big ? "text-[10px]" : "text-[8px]") + " font-semibold text-cream/75"}>Spirit</span>
      </>
    );
  }
  if (kind === "badge") {
    return (
      <>
        <IconGhost2 size={big ? 34 : 24} className="text-violet-200" aria-hidden />
        <span className={(big ? "text-[10px]" : "text-[8px]") + " font-semibold text-violet-200"}>Badge</span>
      </>
    );
  }
  if (kind === "fragment") {
    return (
      <>
        <SoulShardIcon size={big ? 32 : 22} />
        <span className={(big ? "text-[10px]" : "text-[8px]") + " font-semibold text-cream/75"}>Fragment</span>
      </>
    );
  }
  if (kind === "lp") {
    return (
      <>
        <LifeProficiencyIcon size={big ? 28 : 20} />
        <span className={(big ? "text-[11px]" : "text-[9px]") + " font-semibold text-violet-300"}>100</span>
      </>
    );
  }
  return (
    <>
      <ManoIcon size={big ? 28 : 20} />
      <span className={(big ? "text-[11px]" : "text-[9px]") + " font-semibold text-gold"}>10</span>
    </>
  );
}
