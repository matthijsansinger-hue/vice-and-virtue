// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Virtue Seeker Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";
import { CLOAK_REVEAL } from "./shared_rigs";

// The seeker throws their cloak open — the virtue sigil shines on their
// chest for a heartbeat, then the cloak falls shut again.
const clip: ClipConfig = {
  name: "virtue_seeker",
  bg: "#050818",
  poster: 1.0,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/virtue_seeker.mp4",
  draw(c, t, AB) {
 CLOAK_REVEAL(c,t,AB,{camp:'virtue',sigil:'circle'}); 
  },
};

export default clip;
