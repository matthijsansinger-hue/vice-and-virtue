// The tools roles wield on the castle map: each is the role's cursor over the
// map, the icon on its action button and the mark left on its target. One
// drawing per tool (a 32×32 SVG), so the three always match.
//
//   Murder        dagger  — tip at the top-left
//   Vengeance     hammer  — aim with the head
//   Intoxication  fist    — aim with the knuckles
//   Fanaticism    bomb    — aim with the bomb, fuse lit
//   Torment       quill   — nib at the top-left, dripping ink
//   Greed         purse   — aim with the purse
//   Envy          mask    — aim with the mask
//   Wrath         flame   — aim with the tip
//   Generosity    gift    — aim with the box
//   Sociability   bell    — aim with the bell
//   Certainty     lens    — aim with the glass
//   Love          arrow   — heart tip at the top-left

const INK = "#120a1f";
const GOLD = "#e3b510";

type Tool = { inner: string; hotspot: [number, number] };

const KNIFE: Tool = {
  hotspot: [2, 2],
  inner: `<path d='M2 2 L17.4 14.2 L14.2 17.4 Z' fill='#eceaf5' stroke='${INK}' stroke-width='1.3' stroke-linejoin='round'/><path d='M3.6 3.6 L15.4 15.4' stroke='#9c98b0' stroke-width='0.9'/><path d='M12.4 20.6 L20.6 12.4' stroke='${INK}' stroke-width='4.4' stroke-linecap='round'/><path d='M12.4 20.6 L20.6 12.4' stroke='${GOLD}' stroke-width='2.4' stroke-linecap='round'/><path d='M17.6 17.6 L25.4 25.4' stroke='${INK}' stroke-width='4.6' stroke-linecap='round'/><path d='M17.6 17.6 L25.4 25.4' stroke='#7a1424' stroke-width='2.8' stroke-linecap='round'/><circle cx='27.2' cy='27.2' r='2.6' fill='${GOLD}' stroke='${INK}' stroke-width='1.2'/>`,
};

// An iron smith's hammer, head up-left, handle down-right. Drawn upright and
// turned 45°.
const HAMMER: Tool = {
  hotspot: [11, 11],
  inner: `<g transform='rotate(-45 16 16)'><rect x='14' y='13' width='4.4' height='16.5' rx='2' fill='#8a5a2b' stroke='${INK}' stroke-width='1.2'/><path d='M14.3 22.5 H18.1 M14.3 25.5 H18.1' stroke='#5a3a1c' stroke-width='1.1'/><path d='M11 5.5 H21 L26 7.6 V11 L21 13 H11 Z' fill='#767b8c' stroke='${INK}' stroke-width='1.2' stroke-linejoin='round'/><rect x='6.6' y='4.2' width='5.2' height='10' rx='1' fill='#9095a6' stroke='${INK}' stroke-width='1.2'/><rect x='13.3' y='12.2' width='5.8' height='3.2' rx='0.6' fill='#4a4d5a' stroke='${INK}' stroke-width='1'/><path d='M8 6.2 H24' stroke='#dcdeea' stroke-width='1' stroke-linecap='round'/></g>`,
};

// A clenched fist, knuckles up-left, in a tavern-green sleeve. Drawn pointing
// up and turned 45°.
const SKIN = "#f0c39a";
const SKIN_SHADE = "#d9a277";
const FIST: Tool = {
  hotspot: [8, 8],
  inner: `<g transform='rotate(-45 16 16)'><rect x='11' y='21.5' width='10' height='8' rx='1.5' fill='#3f6b3a' stroke='${INK}' stroke-width='1.2'/><path d='M11.6 24.6 H20.4' stroke='#27461f' stroke-width='1'/><rect x='12.3' y='17' width='7.4' height='6' fill='${SKIN}' stroke='${INK}' stroke-width='1.2'/><rect x='8' y='4.5' width='16' height='15' rx='5' fill='${SKIN}' stroke='${INK}' stroke-width='1.3'/><path d='M12 5 V11.4 M16 4.6 V11.4 M20 5 V11.4' stroke='${INK}' stroke-width='1' stroke-linecap='round'/><path d='M8.6 13.6 Q9 11.6 11.8 11.9 L19.2 12.5 Q21.6 12.9 21.2 14.9 Q20.8 16.6 18.2 16.4 L11.2 16 Q8.7 15.8 8.6 13.6 Z' fill='${SKIN_SHADE}' stroke='${INK}' stroke-width='1.1' stroke-linejoin='round'/><path d='M9.9 6.7 Q10.1 5.9 10.9 5.7 M13.8 6.3 Q14 5.5 14.8 5.4 M17.8 6.3 Q18 5.5 18.8 5.4 M21.5 6.7 Q21.7 5.9 22.3 5.9' stroke='#fff2df' stroke-width='0.9' stroke-linecap='round'/></g>`,
};

// A black-powder bomb, fuse sparking at the top-right.
const BOMB: Tool = {
  hotspot: [13, 19],
  inner: `<circle cx='13' cy='19' r='11.1' fill='none' stroke='#cfc6ec' stroke-width='1' opacity='0.85'/><circle cx='13' cy='19' r='10' fill='#2b2735' stroke='${INK}' stroke-width='1.3'/><ellipse cx='9.4' cy='15.2' rx='3.2' ry='1.9' transform='rotate(-38 9.4 15.2)' fill='#77738a'/><circle cx='15.5' cy='24.5' r='1' fill='#4a4658'/><rect x='17.6' y='9.6' width='5.4' height='4.6' rx='1' transform='rotate(45 20.3 11.9)' fill='#4a4655' stroke='${INK}' stroke-width='1.1'/><path d='M21.8 9.8 Q22.6 5.6 26.6 5.2' fill='none' stroke='${INK}' stroke-width='2.8' stroke-linecap='round'/><path d='M21.8 9.8 Q22.6 5.6 26.6 5.2' fill='none' stroke='#c9a26a' stroke-width='1.5' stroke-linecap='round'/><circle cx='27.4' cy='4.8' r='3' fill='#ff8a1f' opacity='0.85'/><path d='M27.4 0.6 V2.6 M27.4 7 V9 M23.2 4.8 H25.2 M29.6 4.8 H31.6 M24.5 1.9 L25.8 3.2 M29 6.4 L30.3 7.7 M30.3 1.9 L29 3.2' stroke='#ffd23f' stroke-width='1.2' stroke-linecap='round'/><circle cx='27.4' cy='4.8' r='1.4' fill='#fff6d0'/>`,
};

// A quill pen, nib up-left, a drop of ink falling from it. Drawn upright and
// turned 45°; the drop falls straight down.
const QUILL: Tool = {
  hotspot: [5, 5],
  inner: `<g transform='rotate(-45 16 16)'><path d='M16 10 C10.2 13 9.2 20.5 13 28.2 L16 29.4 C21.4 22.5 22.2 15 16 10 Z' fill='#f4f0ff' stroke='${INK}' stroke-width='1.1' stroke-linejoin='round'/><path d='M16 13 L12 16.5 M16 16.5 L11.4 20.5 M16 20 L12 24.4 M16.4 13.5 L20 16 M16.4 17.5 L20.2 20.2 M16.4 21.5 L19.2 23.8' stroke='#b4abd0' stroke-width='0.7'/><path d='M16 8.6 V31' stroke='${INK}' stroke-width='2.4' stroke-linecap='round'/><path d='M16 9 V30.6' stroke='#e9e1c9' stroke-width='1.1' stroke-linecap='round'/><path d='M16 0.8 L18.2 6.8 L16 9.6 L13.8 6.8 Z' fill='#2c2546' stroke='${INK}' stroke-width='1' stroke-linejoin='round'/><path d='M16 2.8 V6.6' stroke='#9790b4' stroke-width='0.8'/></g><path d='M5.6 9 C4.4 11 3.6 12.2 3.6 13.2 A2 2 0 0 0 7.6 13.2 C7.6 12.2 6.8 11 5.6 9 Z' fill='#1d1846' stroke='#cfc6ec' stroke-width='0.7'/>`,
};

// A leather coin purse, drawstring tied, a gold coin stamped on it.
const PURSE: Tool = {
  hotspot: [16, 20],
  inner: `<path d='M12 11.2 Q10.6 6.8 13.6 7.8 Q16 4.6 18.4 7.8 Q21.4 6.8 20 11.2 Z' fill='#8a5a2b' stroke='${INK}' stroke-width='1'/><path d='M9.4 14 C3.8 18 4 28.6 16 29.4 C28 28.6 28.2 18 22.6 14 Z' fill='#8a5a2b' stroke='${INK}' stroke-width='1.3' stroke-linejoin='round'/><path d='M10.2 14.4 L21.8 14.4 L20.2 10.8 L11.8 10.8 Z' fill='#6e4520' stroke='${INK}' stroke-width='1' stroke-linejoin='round'/><path d='M10.6 13 H21.4' stroke='#d9b36c' stroke-width='1.4'/><path d='M21 13 q4 1.2 2.8 5.2' fill='none' stroke='#d9b36c' stroke-width='1.3' stroke-linecap='round'/><path d='M9.6 18 C8.4 21 8.6 24.4 10.6 26.4' fill='none' stroke='#b27c46' stroke-width='1.2' stroke-linecap='round'/><circle cx='16' cy='22' r='4.6' fill='#e3b510' stroke='${INK}' stroke-width='1'/><circle cx='16' cy='22' r='2.8' fill='none' stroke='#a87d08' stroke-width='0.9'/>`,
};

// A masquerade half-mask with gold trim, on its stick.
const MASK: Tool = {
  hotspot: [16, 15],
  inner: `<path d='M24.5 19.5 L28.6 30' stroke='${INK}' stroke-width='3' stroke-linecap='round'/><path d='M24.5 19.5 L28.6 30' stroke='#7a5530' stroke-width='1.6' stroke-linecap='round'/><path d='M3 13 C5 8 11 8 16 11 C21 8 27 8 29 13 C30 19 25 23 20 21 C18 20 17 18 16 18 C15 18 14 20 12 21 C7 23 2 19 3 13 Z' fill='#2fa866' stroke='${INK}' stroke-width='1.3' stroke-linejoin='round'/><path d='M4.4 12.4 C6.4 9.2 11 9.4 16 12.2 C21 9.4 25.6 9.2 27.6 12.4' fill='none' stroke='#e3b510' stroke-width='1.1' stroke-linecap='round'/><ellipse cx='10.2' cy='14.6' rx='3.2' ry='1.9' transform='rotate(10 10.2 14.6)' fill='${INK}'/><ellipse cx='21.8' cy='14.6' rx='3.2' ry='1.9' transform='rotate(-10 21.8 14.6)' fill='${INK}'/><path d='M6 18.6 C8 20.4 10.6 20.4 12.4 19.2' fill='none' stroke='#8ff0b8' stroke-width='0.9' stroke-linecap='round' opacity='0.8'/>`,
};

// A flame of corruption, violet with a pale core, tip up.
const FLAME: Tool = {
  hotspot: [16, 3],
  inner: `<path d='M16 1.6 C19 7 26 11 25.2 19 C24.6 25.6 20.6 29.6 16 29.6 C11.4 29.6 7.4 25.6 7 19.6 C6.6 14.6 10 12 11.6 8.4 C12.6 12 14 13 15 13 C14.5 9 15 5 16 1.6 Z' fill='#5d1a8a' stroke='${INK}' stroke-width='1.3' stroke-linejoin='round'/><path d='M16 9 C18 13 22 16 21.6 21 C21.2 25 18.6 27 16 27 C13.4 27 11 25 11 21.6 C11 18.6 13 17 14 15 C14.5 17.5 15.6 18 16.5 18 C16 15 16 12 16 9 Z' fill='#c05cff'/><ellipse cx='16' cy='23.4' rx='2.6' ry='3.4' fill='#f3dcff'/>`,
};

// A wrapped present with a ribbon and bow.
const GIFT: Tool = {
  hotspot: [16, 19],
  inner: `<rect x='6' y='15' width='20' height='14' rx='1.5' fill='#4f7be0' stroke='${INK}' stroke-width='1.3'/><rect x='4.5' y='11' width='23' height='5' rx='1.2' fill='#6f97f2' stroke='${INK}' stroke-width='1.2'/><rect x='14.2' y='11' width='3.6' height='18' fill='#ffd75e' stroke='${INK}' stroke-width='0.8'/><path d='M16 11 C12 4.6 6.6 6.8 9.8 10.4 C11.4 12 14 11.6 16 11 Z' fill='#ffd75e' stroke='${INK}' stroke-width='1' stroke-linejoin='round'/><path d='M16 11 C20 4.6 25.4 6.8 22.2 10.4 C20.6 12 18 11.6 16 11 Z' fill='#ffd75e' stroke='${INK}' stroke-width='1' stroke-linejoin='round'/><circle cx='16' cy='11' r='1.7' fill='#f0b72f' stroke='${INK}' stroke-width='0.9'/>`,
};

// A brass handbell, handle up.
const BELL: Tool = {
  hotspot: [16, 18],
  inner: `<rect x='14.3' y='1.6' width='3.4' height='8.4' rx='1.5' fill='#6b4a2a' stroke='${INK}' stroke-width='1.1'/><rect x='12.5' y='9' width='7' height='2.6' rx='1' fill='#8f6a20' stroke='${INK}' stroke-width='1'/><path d='M10 12 C10 11 22 11 22 12 C23 18 24 22 27 25 L5 25 C8 22 9 18 10 12 Z' fill='#d9a63a' stroke='${INK}' stroke-width='1.3' stroke-linejoin='round'/><path d='M12.6 14 C12.2 18 11.2 21 9.6 23' fill='none' stroke='#f6dc9a' stroke-width='1.3' stroke-linecap='round'/><rect x='4' y='24.4' width='24' height='2.8' rx='1.3' fill='#b8862a' stroke='${INK}' stroke-width='1.1'/><circle cx='16' cy='28.8' r='2' fill='#6b4a2a' stroke='${INK}' stroke-width='1'/>`,
};

// A magnifying glass, lens up-left.
const LENS: Tool = {
  hotspot: [12, 12],
  inner: `<path d='M19.6 19.6 L27.4 27.4' stroke='${INK}' stroke-width='5.6' stroke-linecap='round'/><path d='M19.6 19.6 L27.4 27.4' stroke='#6b4a2a' stroke-width='3.6' stroke-linecap='round'/><path d='M17.6 17.6 L20.4 20.4' stroke='${INK}' stroke-width='6.2'/><path d='M17.8 17.8 L20.2 20.2' stroke='#c9cbd6' stroke-width='4.6'/><circle cx='12' cy='12' r='8.4' fill='#bfe3ff' fill-opacity='0.35' stroke='${INK}' stroke-width='3.8'/><circle cx='12' cy='12' r='8.4' fill='none' stroke='#c9cbd6' stroke-width='2.2'/><path d='M7.6 10 A5 5 0 0 1 11.4 6.8' fill='none' stroke='#ffffff' stroke-width='1.4' stroke-linecap='round' opacity='0.85'/>`,
};

// Cupid's arrow, its heart-shaped head at the top-left.
const ARROW: Tool = {
  hotspot: [4, 4],
  inner: `<path d='M7 7 L27 27' stroke='${INK}' stroke-width='3.2' stroke-linecap='round'/><path d='M7 7 L27 27' stroke='#c99a5c' stroke-width='1.7' stroke-linecap='round'/><path d='M22.4 22.4 L20.6 28.2 L24.6 29.6 L26.6 26.6 Z' fill='#ffd0dc' stroke='${INK}' stroke-width='1' stroke-linejoin='round'/><path d='M22.4 22.4 L28.2 20.6 L29.6 24.6 L26.6 26.6 Z' fill='#ffd0dc' stroke='${INK}' stroke-width='1' stroke-linejoin='round'/><g transform='translate(7.2 7.2) rotate(135) scale(1.45)'><path d='M0 3 C-6 -1 -4 -6 0 -3 C4 -6 6 -1 0 3 Z' fill='#ff5c8a' stroke='${INK}' stroke-width='0.75' stroke-linejoin='round'/></g>`,
};

// CSS `cursor` value; browsers without SVG cursors fall back to a crosshair.
function cursorOf(t: Tool): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${t.inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${t.hotspot[0]} ${t.hotspot[1]}, crosshair`;
}

export const KNIFE_CURSOR = cursorOf(KNIFE);
export const HAMMER_CURSOR = cursorOf(HAMMER);
export const FIST_CURSOR = cursorOf(FIST);
export const BOMB_CURSOR = cursorOf(BOMB);
export const QUILL_CURSOR = cursorOf(QUILL);
export const PURSE_CURSOR = cursorOf(PURSE);
export const MASK_CURSOR = cursorOf(MASK);
export const FLAME_CURSOR = cursorOf(FLAME);
export const GIFT_CURSOR = cursorOf(GIFT);
export const BELL_CURSOR = cursorOf(BELL);
export const LENS_CURSOR = cursorOf(LENS);
export const ARROW_CURSOR = cursorOf(ARROW);

export type ToolIconProps = { className?: string };

// The markup is the fixed drawings above (no user content).
function ToolIcon({ tool, className = "h-5 w-5" }: { tool: Tool; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      focusable="false"
      dangerouslySetInnerHTML={{ __html: tool.inner }}
    />
  );
}

export const KnifeIcon = ({ className }: ToolIconProps) => <ToolIcon tool={KNIFE} className={className} />;
export const HammerIcon = ({ className }: ToolIconProps) => <ToolIcon tool={HAMMER} className={className} />;
export const FistIcon = ({ className }: ToolIconProps) => <ToolIcon tool={FIST} className={className} />;
export const BombIcon = ({ className }: ToolIconProps) => <ToolIcon tool={BOMB} className={className} />;
export const QuillIcon = ({ className }: ToolIconProps) => <ToolIcon tool={QUILL} className={className} />;
export const PurseIcon = ({ className }: ToolIconProps) => <ToolIcon tool={PURSE} className={className} />;
export const MaskIcon = ({ className }: ToolIconProps) => <ToolIcon tool={MASK} className={className} />;
export const FlameIcon = ({ className }: ToolIconProps) => <ToolIcon tool={FLAME} className={className} />;
export const GiftIcon = ({ className }: ToolIconProps) => <ToolIcon tool={GIFT} className={className} />;
export const BellIcon = ({ className }: ToolIconProps) => <ToolIcon tool={BELL} className={className} />;
export const LensIcon = ({ className }: ToolIconProps) => <ToolIcon tool={LENS} className={className} />;
export const ArrowIcon = ({ className }: ToolIconProps) => <ToolIcon tool={ARROW} className={className} />;
