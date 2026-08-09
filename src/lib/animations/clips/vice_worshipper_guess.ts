// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Vice Worshipper Guess Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";
import { GUESS_LINEUP } from "./shared_rigs";

// A reticle sweeps the line-up and locks on; the target is unmasked as the
// Virtue Seeker (blue emblem) — a correct guess, and the slash strikes true.
const clip: ClipConfig = {
  name: "vice_worshipper_guess",
  bg: "#0c0406",
  poster: 1.5,
  duration: 2.0,
  video: "/animations/vice_worshipper_guess.mp4",
  fadeFromBlack: true,
  draw(c, t, AB) {
 GUESS_LINEUP(c,t,AB,{camp:'vice',emblemCamp:'virtue',emblem:'circle',mode:'kill',target:3}); 
  },
};

export default clip;
