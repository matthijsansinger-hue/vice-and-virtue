// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Intoxication Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";
import { PUNCH_HOSPITAL } from "./shared_rigs";

// A hooded brawler decks a victim who crashes onto a hospital cot.
const clip: ClipConfig = {
  name: "intoxication",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/intoxication.mp4",
  draw(c, t, AB) {
 PUNCH_HOSPITAL(c,t,AB,{}); 
  },
};

export default clip;
