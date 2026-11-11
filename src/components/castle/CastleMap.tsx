"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import { CastleFloorPlan } from "./CastleFloorPlan";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { heading } from "@/components/ui/royal";
import {
  CASTLE_ROOMS,
  labelPos,
  MAP_H,
  MAP_W,
  mapMetrics,
  placeTokens,
  roomById,
  type CastleRoom,
  type TokenKind,
} from "@/lib/castle";
import { gameColors } from "@/lib/gameColors";
import { displayedName } from "@/lib/swaps";
import { usePlayerCharacters } from "@/lib/usePlayerCharacters";
import type { Player, Room } from "@/lib/types";

// The interactive castle map for role actions. Every living player stands
// somewhere in the castle as their avatar + this game's name bar; tapping one
// opens the role's menu for them (Murder: Kill). Each role brings its own
// cursor, accent colour and menu — the map, the scatter and the tokens are
// shared. Where people stand: lib/castle.ts.

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
  marks = [],
  markIcon,
  dimOthers = true,
  dimUnpickable = false,
  showDead = false,
  label = "Castle map",
}: {
  room: Room;
  players: Player[];
  myPlayerId: string | null;
  // CSS cursor over the map (Murder: the knife).
  cursor?: string;
  // This role's colour: hover, the open token, the mark.
  accent: string;
  // Whether a player's token opens the menu.
  canPick: (p: Player) => boolean;
  renderMenu: (p: Player, ctx: CastleMenuContext) => ReactNode;
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
    p.id === myPlayerId ? "You" : displayedName(p, room, players, myPlayerId);

  // Placement uses the width rounded to 16 px, so small resizes (a scrollbar
  // appearing) don't reshuffle everyone.
  const bucket = Math.round(mapPx / 16) * 16;
  const placeKey = living
    .map((p) => `${p.id}:${kindOf(p)}:${nameOf(p)}`)
    .join("|");
  const placed = useMemo(() => {
    if (bucket <= 0) return [];
    return placeTokens(
      living.map((p) => ({ id: p.id, name: nameOf(p), kind: kindOf(p) })),
      `${room.id}:${room.day}:${myPlayerId ?? ""}`,
      mapMetrics(bucket)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, bucket, room.id, room.day, myPlayerId]);

  const m = mapMetrics(mapPx || 360);
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
      <CastleFloorPlan />

      {CASTLE_ROOMS.map((r) => (
        <span
          key={r.id}
          aria-hidden
          className={`pointer-events-none absolute whitespace-nowrap leading-none tracking-[0.04em] text-[#cbbdf0]/75 ${heading}`}
          style={{
            left: pct(labelPos(r).x, MAP_W),
            top: pct(labelPos(r).y, MAP_H),
            fontSize: m.labelFont,
            textShadow: "0 1px 3px rgba(5,3,12,.9)",
          }}
        >
          {r.name}
        </span>
      ))}

      {mapPx > 0 &&
        drawOrder.map((spot) => {
          const p = living.find((x) => x.id === spot.id);
          if (!p) return null;
          const name = nameOf(p);
          const isMe = p.id === myPlayerId;
          const pickable = !isMe && canPick(p);
          const isOpen = menuOpen && openId === p.id;
          const isMarked = marks.includes(p.id);
          const dim =
            !isMe &&
            !isMarked &&
            ((dimOthers && marks.length > 0) || (dimUnpickable && !pickable));
          const gc = colors.get(p.id);
          const roomName = roomById(spot.roomId)?.name ?? "castle";
          // The dead are ghosts: faded and grey until picked.
          const ghost = p.dead && !isOpen && !isMarked;

          const style = {
            left: pct(spot.x, MAP_W),
            top: pct(spot.y, MAP_H),
            zIndex: isOpen ? 30 : isMarked ? 20 : 10,
            cursor: "inherit",
            "--ring": gc?.hex ?? "#b9a7e3",
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
                <CharacterAvatar
                  character={characters[p.id] ?? null}
                  initials={name.charAt(0).toUpperCase()}
                  className="h-full w-full"
                  textClass="text-sm"
                />
                {p.in_prison && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full"
                    style={{ background: BARS }}
                  />
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
                  background: gc?.background ?? "#3b3b3b",
                  color: gc && !gc.lightText ? "#1d1430" : "#ffefc5",
                }}
              >
                {name}
              </span>
            </>
          );

          const base =
            "group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-[opacity,filter] duration-300 " +
            (dim ? "opacity-45 saturate-50 " : ghost ? "opacity-60 grayscale " : "");
          const where = p.dead ? `dead, in the ${roomName}` : `in the ${roomName}`;

          if (!pickable) {
            return (
              <div
                key={p.id}
                className={base + (isMe ? "opacity-90" : "")}
                style={style}
                role="img"
                aria-label={isMe ? `You, ${where}` : `${name}, ${where}`}
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
              aria-label={`${name}, ${where}`}
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setOpenId(isOpen ? null : p.id)}
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

      {menuOpen && openPlayer && openSpot && (
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
            room={roomById(openSpot.roomId) ?? CASTLE_ROOMS[0]}
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
