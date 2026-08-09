// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Vengeance Hospitalise Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";
import { PUNCH_HOSPITAL } from "./shared_rigs";

// A hooded brawler decks a victim who crashes onto a hospital cot.
const clip: ClipConfig = {
  name: "vengeance_hospitalise",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  video: "/animations/vengeance_hospitalise.mp4",
  fadeFromBlack: true,
  draw(c, t, AB) {
 PUNCH_HOSPITAL(c,t,AB,{female:true}); 
  },
};

export default clip;
