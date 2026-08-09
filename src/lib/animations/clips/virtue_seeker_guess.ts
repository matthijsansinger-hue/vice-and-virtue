// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Virtue Seeker Guess Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";
import { GUESS_LINEUP } from "./shared_rigs";

// A reticle sweeps the line-up and locks on; the target is unmasked as the
// Vice Worshipper (red emblem) — a correct guess, and the bars slam down.
const clip: ClipConfig = {
  name: "virtue_seeker_guess",
  bg: "#050818",
  poster: 1.6,
  duration: 2.0,
  video: "/animations/virtue_seeker_guess.mp4",
  fadeFromBlack: true,
  draw(c, t, AB) {
 GUESS_LINEUP(c,t,AB,{camp:'virtue',emblemCamp:'vice',emblem:'triangle',mode:'jail',target:1}); 
  },
};

export default clip;
