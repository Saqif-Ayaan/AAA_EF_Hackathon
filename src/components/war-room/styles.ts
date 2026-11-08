/**
 * Class names for war-room.css. It is a global stylesheet (this project's
 * next.config routes every .css file through the Tailwind loader, which turns
 * CSS Modules into plain CSS), so every class is prefixed "wr-" to stay scoped.
 */
import "./war-room.css";

const styles = {
  checker: "wr-checker",
  corners: "wr-corners",
  crosshair: "wr-crosshair",
  cta: "wr-cta",
  ctaGhost: "wr-ctaGhost",
  display: "wr-display",
  enter: "wr-enter",
  flash: "wr-flash",
  floor: "wr-floor",
  floorPlane: "wr-floorPlane",
  hex: "wr-hex",
  horizonLine: "wr-horizonLine",
  hoverLift: "wr-hoverLift",
  micro: "wr-micro",
  mono: "wr-mono",
  navLink: "wr-navLink",
  orb: "wr-orb",
  orbA: "wr-orbA",
  orbB: "wr-orbB",
  orbC: "wr-orbC",
  panel: "wr-panel",
  pill: "wr-pill",
  portal: "wr-portal",
  portalArch: "wr-portalArch",
  portalEcho: "wr-portalEcho",
  portalReflection: "wr-portalReflection",
  portalScan: "wr-portalScan",
  rec: "wr-rec",
  root: "wr-root",
  scanlines: "wr-scanlines",
  scene: "wr-scene",
  segActive: "wr-segActive",
  segFill: "wr-segFill",
  segTrack: "wr-segTrack",
  swatch: "wr-swatch",
  swatchInput: "wr-swatchInput",
  tickerPaused: "wr-tickerPaused",
  tickerTrack: "wr-tickerTrack",
  tickerViewport: "wr-tickerViewport",
  vfLabel: "wr-vfLabel",
  viewfinder: "wr-viewfinder",
  wire: "wr-wire",
  wireAlt: "wr-wireAlt",
} as const;

export default styles;
