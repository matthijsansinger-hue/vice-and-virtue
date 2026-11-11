"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import { CastleFloorPlan } from "./CastleFloorPlan";
import { CourtyardPlan } from "./CourtyardPlan";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { InkDrop } from "@/components/InkName";
import { heading } from "@/components/ui/royal";
import {
  CASTLE_PLAN,
  CASTLE_ROOMS,
  MAP_H,
  MAP_W,
  mapMetrics,
  placeTokens,
  roomById,
  tokenSize,
  type CastleRoom,
  type MapMetrics,
  type MapPlan,
  type PlacedToken,
  type TokenKind,
} from "@/lib/castle";
import { COURTYARD_PLAN } from "@/lib/courtyard";
import { gameColors } from "@/lib/gameColors";
import { displayedName } from "@/lib/swaps";
import { usePlayerCharacters } from "@/lib/usePlayerCharacters";
import type { Player, Room } from "@/lib/types";

// The interactive map. Every living player stands somewhere on it as their
// avatar + this game's name bar. In role actions it's the castle by night and
// tapping a player opens the role's menu for them (Murder: Kill); each role
// brings its own cursor, accent colour and menu. In Outreach it's the
// courtyard by day: tapping a player opens your chat with them, and the
// people who are talking gather into huddles (`arrange`). Where people stand:
// lib/castle.ts and lib/courtyard.ts.

// A plan plus how to draw it.
export type MapView = {
  plan: MapPlan;
  Drawing: ComponentType;
  // Night (the castle: light labels on dark) or day (the courtyard).
  tone: "night" | "day";
};

export const CASTLE_VIEW: MapView = { plan: CASTLE_PLAN, Drawing: CastleFloorPlan, tone: "night" };
export const COURTYARD_VIEW: MapView = { plan: COURTYARD_PLAN, Drawing: CourtyardPlan, tone: "day" };

// Per-token extras a screen adds (Outreach: unread dot, level star, open chat).
export type TokenDecor = {
  // Top-left of the avatar (e.g. the red "!" for an unread message).
  badge?: ReactNode;
  // Top-right of the avatar (e.g. the account level star).
  corner?: ReactNode;
  // Highlighted in the accent colour (e.g. the chat that's open).
  active?: boolean;
  // Added to the token's accessible name (e.g. "new message").
  note?: string;
};

// Moves tokens after the scatter (Outreach's huddles) and names the pairs to
// join with a link (one per one-on-one chat).
export type MapArrange = (
  placed: PlacedToken[],
  m: MapMetrics,
  nameOf: (id: string) => string
) => { placed: PlacedToken[]; links?: [string, string][] };

export type CastleMenuContext = {
  name: string;
  room: CastleRoom;
  // A dead player (only on maps that show the dead).
  dead: boolean;
  close: () => void;
};

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const kindOf = (p: Player): TokenKind =>
  p.dead ? "dead" : p.in_prison ? "prison" : p.in_hospital ? "hospital" : "free";

// Iron bars across an imprisoned player's face (the name stays readable).
const BARS =
  "repeating-linear-gradient(90deg, transparent 0 22%, rgba(20,18,28,.7) 22% 25%, rgba(150,154,168,.95) 25% 31%, rgba(20,18,28,.7) 31% 34%, transparent 34% 41.5%)";

export function CastleMap({
  room,
  players,
  myPlayerId,
  cursor,
  accent,
  canPick,
  renderMenu,
  onPick,
  marks = [],
  markIcon,
  dimOthers = true,
  dimUnpickable = false,
  showDead = false,
  label = "Castle map",
  view = CASTLE_VIEW,
  seed,
  arrange,
  decorate,
  ink = null,
}: {
  room: Room;
  players: Player[];
  myPlayerId: string | null;
  // CSS cursor over the map (Murder: the knife).
  cursor?: string;
  // This role's colour: hover, the open token, the mark.
  accent: string;
  // Whether a player's token can be tapped.
  canPick: (p: Player) => boolean;
  // What a tap opens: the role's menu for that player…
  renderMenu?: (p: Player, ctx: CastleMenuContext) => ReactNode;
  // …or, instead of a menu, what a tap does straight away (Outreach: chat).
  onPick?: (p: Player) => void;
  // Players this role has acted on or picked (Murder: the victim), shown with
  // the role's tool on their avatar.
  marks?: string[];
  markIcon?: ReactNode;
  // Dim everyone who isn't marked (once the action is done).
  dimOthers?: boolean;
  // Dim everyone who can't be picked, so the few who can stand out
  // (Vengeance in prison: only her jailers).
  dimUnpickable?: boolean;
  // Show the dead too, as ghosts lying in the Chapel (Certainty).
  showDead?: boolean;
  label?: string;
  // Which map (the castle by default).
  view?: MapView;
  // The scatter's seed (default: room + day + viewer).
  seed?: string;
  // Moves tokens after the scatter (huddles).
  arrange?: MapArrange;
  decorate?: (p: Player) => TokenDecor | undefined;
  // Torment: the viewer sees numbered ink blots instead of anyone (no faces,
  // colours, prison bars or reserved rooms — see lib/ink.ts).
  ink?: Map<string, number> | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tokenRefs = useRef(new Map<string, HTMLButtonElement>());
  const [mapPx, setMapPx] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  // The map's drawn width decides the token sizes.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setMapPx(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const characters = usePlayerCharacters(players);
  const { plan } = view;
  const night = view.tone === "night";
  const colors = useMemo(
    () => gameColors(room.id, players.map((p) => p.id)),
    [room.id, players]
  );

  // Everyone on the map: the living, plus the dead when asked.
  const living = useMemo(
    () => players.filter((p) => showDead || !p.dead),
    [players, showDead]
  );
  const nameOf = (p: Player) =>
    p.id === myPlayerId
      ? "You"
      : ink
        ? `#${ink.get(p.id) ?? "?"}`
        : displayedName(p, room, players, myPlayerId);
  // Under an Envy swap a player shows someone else's name, so they wear that
  // person's face and colour too (shown_as, set by the room page).
  const personaOf = (p: Player) => p.shown_as ?? p.id;
  // Where someone stands gives them away to the tormented, so they see
  // everyone scattered in the open.
  const kindFor = (p: Player): TokenKind => (ink && !p.dead ? "free" : kindOf(p));

  // Placement uses the width rounded to 16 px, so small resizes (a scrollbar
  // appearing) don't reshuffle everyone.
  const bucket = Math.round(mapPx / 16) * 16;
  const placeKey = living
    .map((p) => `${p.id}:${kindFor(p)}:${nameOf(p)}`)
    .join("|");
  const scatterSeed = seed ?? `${room.id}:${room.day}:${myPlayerId ?? ""}`;
  const scattered = useMemo(() => {
    if (bucket <= 0) return [];
    return placeTokens(
      living.map((p) => ({ id: p.id, name: nameOf(p), kind: kindFor(p) })),
      scatterSeed,
      mapMetrics(bucket),
      plan
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, bucket, scatterSeed, plan]);

  const m = mapMetrics(mapPx || 360);
  const nameById = (id: string) => {
    const p = living.find((x) => x.id === id);
    return p ? nameOf(p) : "";
  };
  const arranged =
    arrange && scattered.length ? arrange(scattered, mapMetrics(bucket), nameById) : null;
  const placed = arranged?.placed ?? scattered;
  const links = arranged?.links ?? [];
  const tokenH = m.avatar + 3 + m.barH;

  const openPlayer = openId ? living.find((p) => p.id === openId) : undefined;
  const openSpot = openId ? placed.find((t) => t.id === openId) : undefined;
  const menuOpen = !!openPlayer && !!openSpot && canPick(openPlayer);

  function close(refocus = false) {
    const id = openId;
    setOpenId(null);
    if (refocus && id) tokenRefs.current.get(id)?.focus();
  }

  // Escape closes the menu and puts focus back on the token.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, openId]);

  // Lower tokens paint over higher ones, like standing in front of them.
  const drawOrder = [...placed].sort((a, b) => a.y - b.y);

  return (
    <div
      ref={wrapRef}
      role="group"
      aria-label={label}
      className="relative mx-auto touch-manipulation select-none"
      style={{
        aspectRatio: `${MAP_W} / ${MAP_H}`,
        // As wide as the column, but short enough to sit on one screen.
        width: "min(100%, max(20rem, calc((100dvh - 16rem) * 1000 / 1120)))",
        cursor,
      }}
      // A tap on the map itself (not a token or the menu) closes the menu.
      onPointerDown={() => menuOpen && close()}
    >
      <view.Drawing />

      {plan.labels.map((l) => (
        <span
          key={l.text}
          aria-hidden
          className={
            "pointer-events-none absolute whitespace-nowrap leading-none tracking-[0.04em] " +
            (night ? "text-[#cbbdf0]/75 " : "text-[#5b4128]/85 ") +
            heading
          }
          style={{
            left: pct(l.x, MAP_W),
            top: pct(l.y, MAP_H),
            fontSize: m.labelFont,
            textShadow: night ? "0 1px 3px rgba(5,3,12,.9)" : "0 1px 0 rgba(255,250,235,.9)",
          }}
        >
          {l.text}
        </span>
      ))}

      {/* One link per chat — chats are one-on-one, so a person in two
          chats has two links, never a ring around a "group". A dashed line
          across the gap between the two, with a speech bubble in the middle,
          gliding with them. Drawn only between their two tokens and BEHIND
          everyone, so a link that has to pass someone else never looks like
          it includes them. */}
      {mapPx > 0 &&
        links.map(([a, b]) => {
          const ta = placed.find((x) => x.id === a);
          const tb = placed.find((x) => x.id === b);
          if (!ta || !tb) return null;
          const mapH = (mapPx * MAP_H) / MAP_W;
          // Token boxes in px: centre + half-size.
          const boxPx = (t: PlacedToken) => {
            const s = tokenSize(nameById(t.id), m);
            return {
              x: (t.x / MAP_W) * mapPx,
              y: (t.y / MAP_H) * mapH,
              hw: s.w / m.unit / 2,
              hh: s.h / m.unit / 2,
            };
          };
          const A = boxPx(ta);
          const B = boxPx(tb);
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          // Where the centre-to-centre line leaves each box (as a fraction).
          const exit = (q: { hw: number; hh: number }) =>
            Math.min(dx ? q.hw / Math.abs(dx) : Infinity, dy ? q.hh / Math.abs(dy) : Infinity);
          const fa = exit(A);
          const fb = exit(B);
          const pa = fa + fb < 1 ? { x: A.x + dx * fa, y: A.y + dy * fa } : null;
          const pb = fa + fb < 1 ? { x: B.x - dx * fb, y: B.y - dy * fb } : null;
          const mid = pa && pb ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } : { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
          const len = pa && pb ? Math.hypot(pb.x - pa.x, pb.y - pa.y) : 0;
          const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
          const ink = night ? "rgba(203,189,240,.75)" : "rgba(115,83,51,.8)";
          return (
            <motion.span
              key={a < b ? `${a}|${b}` : `${b}|${a}`}
              aria-hidden
              // Fades in once the two have walked over.
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
              className="pointer-events-none absolute inset-0 z-[5]"
            >
            <span
              className="absolute block transition-[left,top,width,rotate] duration-700 ease-out motion-reduce:transition-none"
              style={{
                left: mid.x,
                top: mid.y,
                width: len,
                height: 0,
                translate: "-50% 0",
                rotate: `${deg}deg`,
                borderTop: `2.5px dashed ${ink}`,
              }}
            >
              <span
                className="absolute left-1/2 top-0 flex items-center justify-center rounded-full border-2"
                style={{
                  width: 16,
                  height: 16,
                  translate: "-50% -50%",
                  marginTop: -1.25,
                  rotate: `${-deg}deg`,
                  borderColor: ink,
                  background: night ? "#271d4b" : "#f6efdc",
                }}
              >
                <svg viewBox="0 0 12 4" width="9" height="3" aria-hidden>
                  <circle cx="1.5" cy="2" r="1.3" fill={ink} />
                  <circle cx="6" cy="2" r="1.3" fill={ink} />
                  <circle cx="10.5" cy="2" r="1.3" fill={ink} />
                </svg>
              </span>
            </span>
            </motion.span>
          );
        })}

      {mapPx > 0 &&
        drawOrder.map((spot) => {
          const p = living.find((x) => x.id === spot.id);
          if (!p) return null;
          const name = nameOf(p);
          const isMe = p.id === myPlayerId;
          const pickable = !isMe && canPick(p);
          const isOpen = menuOpen && openId === p.id;
          const decor = decorate?.(p);
          const isMarked = marks.includes(p.id) || !!decor?.active;
          const dim =
            !isMe &&
            !isMarked &&
            ((dimOthers && marks.length > 0) || (dimUnpickable && !pickable));
          const inkNo = ink && !isMe ? ink.get(p.id) ?? 0 : null;
          // The tormented see no colours: they'd tell people apart.
          const gc = inkNo === null ? colors.get(personaOf(p)) : undefined;
          const roomName = roomById(spot.roomId, plan)?.name ?? "castle";
          // The dead are ghosts: faded and grey until picked.
          const ghost = p.dead && !isOpen && !isMarked;

          const style = {
            left: pct(spot.x, MAP_W),
            top: pct(spot.y, MAP_H),
            zIndex: isOpen ? 30 : isMarked ? 20 : 10,
            cursor: "inherit",
            "--ring": gc?.hex ?? (night ? "#b9a7e3" : "#735333"),
            "--accent": accent,
          } as CSSProperties;

          const body = (
            <>
              <span
                className={
                  "relative block rounded-full transition-[transform,box-shadow] duration-150 " +
                  (isOpen || isMarked
                    ? "shadow-[0_0_0_2.5px_var(--accent),0_0_16px_var(--accent)] "
                    : "shadow-[0_0_0_2px_var(--ring),0_3px_8px_rgba(0,0,0,.6)] ") +
                  (pickable && !isOpen
                    ? "group-hover:shadow-[0_0_0_2.5px_var(--accent),0_0_14px_var(--accent)] motion-safe:group-hover:-translate-y-0.5"
                    : "")
                }
                style={{ width: m.avatar, height: m.avatar }}
              >
                {inkNo !== null ? (
                  <InkDrop className="h-full w-full" />
                ) : (
                  <CharacterAvatar
                    character={characters[personaOf(p)] ?? null}
                    initials={name.charAt(0).toUpperCase()}
                    className="h-full w-full"
                    textClass="text-sm"
                  />
                )}
                {p.in_prison && inkNo === null && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full"
                    style={{ background: BARS }}
                  />
                )}
                {decor?.badge && (
                  <span className="absolute -left-1.5 -top-1.5 z-10">{decor.badge}</span>
                )}
                {decor?.corner && !(isMarked && markIcon) && (
                  <span className="absolute -right-2 -top-2 z-10">{decor.corner}</span>
                )}
                {isMarked && markIcon && (
                  <motion.span
                    initial={{ scale: 0, rotate: -40 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 420, damping: 18 }}
                    className="absolute -right-1.5 -top-1.5 flex items-center justify-center rounded-full ring-2 ring-[#120a1f]"
                    style={{
                      width: Math.max(16, m.avatar * 0.58),
                      height: Math.max(16, m.avatar * 0.58),
                      background: accent,
                    }}
                  >
                    {markIcon}
                  </motion.span>
                )}
              </span>
              <span
                className="relative mt-[3px] block overflow-hidden truncate rounded-[5px] px-1.5 font-semibold shadow-[0_2px_6px_rgba(0,0,0,.55)]"
                style={{
                  maxWidth: m.barMax,
                  height: m.barH,
                  lineHeight: `${m.barH}px`,
                  fontSize: m.font,
                  background: gc?.background ?? (night ? "#3b3b3b" : "#f3ecd6"),
                  color: gc ? (gc.lightText ? "#ffefc5" : "#1d1430") : night ? "#ffefc5" : "#3a2a18",
                }}
              >
                {inkNo !== null ? (
                  <span className="flex h-full items-center gap-1">
                    <span
                      aria-hidden
                      className="inline-block h-[55%] w-6 shrink-0 rounded-full"
                      style={{ background: "#150f1c", filter: "blur(0.6px)" }}
                    />
                    #{inkNo}
                  </span>
                ) : (
                  name
                )}
              </span>
            </>
          );

          const base =
            "group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-[left,top,opacity,filter] duration-700 ease-out motion-reduce:transition-none " +
            (dim ? "opacity-45 saturate-50 " : ghost ? "opacity-60 grayscale " : "");
          const who = inkNo !== null ? `Ink-blotted player ${inkNo}` : name;
          const where =
            (p.dead ? `dead, in the ${roomName}` : `in the ${roomName}`) +
            (decor?.note ? `, ${decor.note}` : "");

          if (!pickable) {
            return (
              <div
                key={p.id}
                className={base + (isMe ? "opacity-90" : "")}
                style={style}
                role="img"
                aria-label={isMe ? `You, ${where}` : `${who}, ${where}`}
              >
                {body}
              </div>
            );
          }

          return (
            <button
              key={p.id}
              ref={(el) => {
                if (el) tokenRefs.current.set(p.id, el);
                else tokenRefs.current.delete(p.id);
              }}
              type="button"
              aria-label={`${who}, ${where}`}
              aria-haspopup={onPick ? undefined : "dialog"}
              aria-expanded={onPick ? undefined : isOpen}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => (onPick ? onPick(p) : setOpenId(isOpen ? null : p.id))}
              className={
                base +
                "rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
              }
              style={style}
            >
              {body}
            </button>
          );
        })}

      {menuOpen && openPlayer && openSpot && renderMenu && (
        <MenuAnchor
          x={openSpot.x}
          y={openSpot.y}
          gapPx={tokenH / 2 + 8}
          mapHeightPx={(mapPx * MAP_H) / MAP_W}
          accent={accent}
          name={nameOf(openPlayer)}
        >
          <MenuBody
            render={renderMenu}
            player={openPlayer}
            name={nameOf(openPlayer)}
            room={roomById(openSpot.roomId, plan) ?? CASTLE_ROOMS[0]}
            dead={openPlayer.dead}
            onClose={() => close(true)}
          />
        </MenuAnchor>
      )}
    </div>
  );
}

// The role's menu for one player (a component, so the menu is rendered by
// React rather than called during the map's render).
function MenuBody({
  render,
  player,
  name,
  room,
  dead,
  onClose,
}: {
  render: (p: Player, ctx: CastleMenuContext) => ReactNode;
  player: Player;
  name: string;
  room: CastleRoom;
  dead: boolean;
  onClose: () => void;
}) {
  return <>{render(player, { name, room, dead, close: onClose })}</>;
}

// The menu floats beside its token, leaning inward near the side walls so it
// never leaves the map sideways. Vertically it opens on the side with room for
// it (measured once it's drawn): below the token in the castle's top half,
// above it in the bottom half, flipping when that side is too short. When
// neither side has room (a tall menu with several actions on a phone), it
// slides to stay inside the map, even if that covers the token.
function MenuAnchor({
  x,
  y,
  gapPx,
  mapHeightPx,
  accent,
  name,
  children,
}: {
  x: number;
  y: number;
  gapPx: number;
  mapHeightPx: number;
  accent: string;
  name: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const preferAbove = y > MAP_H * 0.5;
  // The menu's top edge relative to the token, once measured.
  const [topPx, setTopPx] = useState<number | null>(null);
  useLayoutEffect(() => {
    const h = menuRef.current?.offsetHeight ?? 0;
    const tokenPx = (y / MAP_H) * mapHeightPx;
    const roomAbove = tokenPx - gapPx;
    const roomBelow = mapHeightPx - tokenPx - gapPx;
    const fitsPreferred = h <= (preferAbove ? roomAbove : roomBelow);
    const fitsOther = h <= (preferAbove ? roomBelow : roomAbove);
    const above = fitsPreferred ? preferAbove : fitsOther ? !preferAbove : roomAbove > roomBelow;
    let t = above ? -gapPx - h : gapPx;
    // Keep it inside the map when it can be.
    if (h <= mapHeightPx) {
      t = Math.min(t, mapHeightPx - tokenPx - h);
      t = Math.max(t, -tokenPx);
    }
    setTopPx(t);
  }, [y, gapPx, mapHeightPx, preferAbove]);
  const above = topPx === null ? preferAbove : topPx < 0;
  const side = x < MAP_W * 0.33 ? "left" : x > MAP_W * 0.67 ? "right" : "center";
  const style: CSSProperties = {
    // Until measured: just above / below the token.
    ...(topPx !== null ? { top: topPx } : { [preferAbove ? "bottom" : "top"]: gapPx }),
    ...(side === "left" ? { left: -28 } : side === "right" ? { right: -28 } : { left: 0 }),
    borderColor: `${accent}aa`,
    boxShadow: `0 12px 32px rgba(0,0,0,.6), 0 0 18px ${accent}33`,
  };
  return (
    <div
      className="absolute z-40 h-0 w-0"
      style={{ left: pct(x, MAP_W), top: pct(y, MAP_H), cursor: "auto" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <motion.div
        ref={menuRef}
        role="dialog"
        aria-label={name}
        initial={{ opacity: 0, scale: 0.9, y: above ? 6 : -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 460, damping: 30 }}
        className={
          "absolute w-56 rounded-xl border-[1.5px] bg-[#140c28]/95 p-3 text-cream backdrop-blur-sm " +
          (side === "center" ? "-translate-x-1/2 " : "")
        }
        style={{
          ...style,
          transformOrigin: `${side === "left" ? "left" : side === "right" ? "right" : "center"} ${above ? "bottom" : "top"}`,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
