"use client";

import { useId } from "react";

// A 9-pointed gold star with the account level in the centre. Used both as the
// overlay on a visited player's banner and in place of the "Level N" text on
// your own profile banner.
const STAR_9 =
  "50,4 60.6,20.9 79.6,14.8 76.8,34.5 95.3,42 80.5,55.4 89.8,73 69.9,73.7 65.7,93.2 50,81 34.3,93.2 30.1,73.7 10.2,73 19.5,55.4 4.7,42 23.2,34.5 20.4,14.8 39.4,20.9";

export function LevelStar({ level, size = 58 }: { level: number; size?: number }) {
  const id = useId();
  const grad = `lvlstar-${id}`;
  const digits = String(level).length;
  // Scale the number down a touch as it grows, relative to the 100-unit viewBox.
  const fontSize = digits >= 3 ? 30 : digits === 2 ? 38 : 44;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-label={`Level ${level}`}
      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,.6))" }}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe8a3" />
          <stop offset="50%" stopColor="#e3b510" />
          <stop offset="100%" stopColor="#9a7415" />
        </linearGradient>
      </defs>
      <polygon
        points={STAR_9}
        fill={`url(#${grad})`}
        stroke="#fff3c4"
        strokeWidth="2.5"
        strokeOpacity="0.9"
        strokeLinejoin="round"
      />
      <text
        x="50"
        y="51"
        textAnchor="middle"
        dominantBaseline="central"
        fontWeight={800}
        fontSize={fontSize}
        fill="#3a2c08"
        style={{ fontFamily: "var(--font-cinzel), serif" }}
      >
        {level}
      </text>
    </svg>
  );
}
