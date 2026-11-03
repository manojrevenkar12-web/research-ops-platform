// The campaign at a glance: one mark per shot, height by delivered energy, colour by outcome. A shot whose
// entry was corrected carries a small ring. The table below holds the same data for reading and for screen
// readers; this picture is for seeing a campaign's rhythm in one look.
import { motion } from "motion/react";
import { DURATION, EASE, STAGGER } from "../../shared/theme/motion";
import type { Shot } from "./api";

const VIEW_H = 64;
const BAR_W = 10;
const GAP = 5;
const MIN_H = 3;

export function ShotStrip({ shots }: { shots: Shot[] }) {
  const ordered = [...shots].sort((a, b) => a.shot_no - b.shot_no);
  const max = Math.max(1, ...ordered.map((s) => Number(s.energy_j ?? 0)));
  const width = ordered.length * (BAR_W + GAP);
  const counts: Record<string, number> = {};
  for (const s of ordered) counts[s.outcome] = (counts[s.outcome] ?? 0) + 1;
  const label = `${ordered.length} shots: ${Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ")}. Highest energy ${max} J.`;
  return (
    <figure className="strip">
      <svg
        className="strip__svg"
        viewBox={`0 0 ${Math.max(width, BAR_W)} ${VIEW_H}`}
        preserveAspectRatio="xMinYMax meet"
        role="img"
        aria-label={label}
      >
        {ordered.map((s, i) => {
          const h = Math.max(MIN_H, (Number(s.energy_j ?? 0) / max) * (VIEW_H - 2 * GAP));
          return (
            <g key={s.id}>
              <motion.rect
                x={i * (BAR_W + GAP)}
                width={BAR_W}
                rx={1}
                className={`strip__bar strip__bar--${s.outcome}`}
                initial={{ height: 0, y: VIEW_H }}
                animate={{ height: h, y: VIEW_H - h }}
                transition={{ duration: DURATION.reveal, ease: EASE.out, delay: i * STAGGER }}
              />
              {s.corrections > 0 ? (
                <circle
                  cx={i * (BAR_W + GAP) + BAR_W / 2}
                  cy={GAP}
                  r={BAR_W / 3}
                  className="strip__corrected"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="strip__legend">
        {(["nominal", "partial", "misfire", "aborted"] as const).map((o) => (
          <span key={o} className="strip__key">
            <span className={`strip__swatch strip__bar--${o}`} aria-hidden="true" />
            {o} {counts[o] ?? 0}
          </span>
        ))}
        <span className="strip__key">
          <span className="strip__ring" aria-hidden="true" />
          corrected
        </span>
      </figcaption>
    </figure>
  );
}
