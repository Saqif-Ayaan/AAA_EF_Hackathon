import styles from "./styles";

/** A faint, still grid floor behind the title. Decorative only. */
export function Backdrop() {
  return (
    <div className={styles.scene} aria-hidden>
      <div className={styles.floor}>
        <div className={styles.floorPlane} />
      </div>
    </div>
  );
}
