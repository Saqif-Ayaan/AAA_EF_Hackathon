import { Wireframe } from "./wireframe";
import styles from "./styles";

/**
 * Decorative stage behind the hero: glowing orbs, a receding grid floor, a
 * dark portal on the horizon and floating wireframe sculptures. Scrolls away
 * with the hero so the reading-heavy sections below sit on a calm background.
 * Everything here is aria-hidden and ignores the pointer.
 */
export function Backdrop() {
  return (
    <>
      <div className={styles.scene} aria-hidden>
        <div className={`${styles.orb} ${styles.orbA}`} />
        <div className={`${styles.orb} ${styles.orbB}`} />
        <div className={`${styles.orb} ${styles.orbC}`} />

        <div className={styles.floor}>
          <div className={styles.floorPlane} />
        </div>
        <div className={styles.horizonLine} />

        <div className={styles.portal}>
          <span className={styles.portalEcho} />
          <span className={styles.portalEcho} />
          <span className={styles.portalEcho} />
          <div className={styles.portalArch}>
            <div className={styles.portalScan} />
          </div>
        </div>
        <div className={styles.portalReflection} />
        <div className={styles.crosshair} />

        {/* Placed in the gaps of the hero: portal ↔ readout, above the readout, beside the portal's base. */}
        <Wireframe
          shape="icosahedron"
          size={190}
          className={`${styles.wire} hidden lg:block`}
          style={{ left: "61vw", top: "14vh" }}
        />
        <Wireframe
          shape="crystal"
          size={130}
          speed={-0.8}
          pitch={0.25}
          className={`${styles.wire} ${styles.wireAlt}`}
          style={{ right: "6vw", top: "8vh" }}
        />
        <Wireframe
          shape="octahedron"
          size={84}
          speed={1.4}
          className={`${styles.wire} hidden lg:block`}
          style={{ left: "38vw", top: "calc(var(--horizon) - 4vh)" }}
        />
      </div>
      <div className={styles.scanlines} aria-hidden />
    </>
  );
}

/** Fixed camera frame around the viewport: corner brackets plus two tiny readouts up top. */
export function Viewfinder({ caseId, palette }: { caseId: string; palette: string }) {
  return (
    <div className={`${styles.viewfinder} hidden sm:block`} aria-hidden>
      <span className={styles.corners} style={{ "--corner-size": "34px" } as React.CSSProperties}>
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className={styles.vfLabel} style={{ left: 44, top: 8 }}>
        CAM-01 · O-1A vetting feed · case {caseId}
      </span>
      <span className={styles.vfLabel} style={{ right: 44, top: 8 }}>
        {palette} · 24 fps · poll 500 ms
      </span>
    </div>
  );
}
