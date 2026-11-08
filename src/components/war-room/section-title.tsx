import { Micro } from "./hud";
import styles from "./styles";

/** Section heading: mono index + kicker, oversized condensed title with one checkerboard word. */
export function SectionTitle({
  id,
  index,
  kicker,
  plain,
  checker,
  sub,
}: {
  id: string;
  index: string;
  kicker: string;
  plain: string;
  checker: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0">
      <Micro className="mb-2 block">
        <span className="text-[color:var(--accent)]">{index}</span> {"//"} {kicker}
      </Micro>
      <h2 id={id} className={`${styles.display} text-[clamp(2.75rem,4.4vw,4.25rem)]`}>
        {plain} <span className={styles.checker}>{checker}</span>
      </h2>
      {sub && <p className="mt-2 text-lg text-[color:var(--muted)]">{sub}</p>}
    </div>
  );
}
