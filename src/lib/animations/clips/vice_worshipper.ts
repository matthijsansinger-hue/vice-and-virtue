// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Vice Worshipper Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";
import { CLOAK_REVEAL } from "./shared_rigs";

// The worshipper throws their cloak open — the vice sigil burns on their
// chest for a heartbeat, then the cloak falls shut again.
const clip: ClipConfig = {
  name: "vice_worshipper",
  bg: "#0c0406",
  poster: 1.0,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/vice_worshipper.mp4",
  draw(c, t, AB) {
 CLOAK_REVEAL(c,t,AB,{camp:'vice',sigil:'triangle'}); 
  },
};

export default clip;
