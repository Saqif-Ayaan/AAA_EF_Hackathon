/**
 * Class names for war-room.css. It is a global stylesheet (this project's
 * next.config routes every .css file through the Tailwind loader, which turns
 * CSS Modules into plain CSS), so every class is prefixed "wr-" to stay scoped.
 */
import "./war-room.css";

const styles = {
  bar: "wr-bar",
  barFill: "wr-barFill",
  button: "wr-button",
  buttonGhost: "wr-buttonGhost",
  display: "wr-display",
  enter: "wr-enter",
  label: "wr-label",
  mono: "wr-mono",
  navLink: "wr-navLink",
  panel: "wr-panel",
  root: "wr-root",
  topbar: "wr-topbar",
} as const;

export default styles;
