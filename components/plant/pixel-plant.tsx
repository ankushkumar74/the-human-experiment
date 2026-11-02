import { healthMood, stageNameFor, type HealthMood } from "@/lib/plant";
import { buildPlantGrid, GRID_H, GRID_W, gridToRects, PLANT_ROWS, STAGE_COUNT } from "./pixel-art";

const DROOP: Record<HealthMood, string> = {
  thriving: "rotate(0deg)",
  okay: "rotate(-1deg)",
  thirsty: "rotate(-6deg) translateY(0.3px)",
  critical: "rotate(-13deg) translateY(0.8px)",
};

interface Props {
  stage: number;
  health: number;
  /** Sway gently (disabled for reduced motion and for static uses such as icons). */
  animate?: boolean;
  className?: string;
  title?: string;
}

/** The pixel-art plant as an inline SVG. Pure and server-renderable. */
export function PixelPlant({ stage, health, animate = true, className, title }: Props) {
  const mood = healthMood(health);
  const s = Math.min(Math.max(Math.floor(stage), 0), STAGE_COUNT - 1);
  const rects = gridToRects(buildPlantGrid(s, mood), mood, s === 6);
  // title="" marks the plant as purely decorative (e.g. the logo): hidden from assistive tech.
  const decorative = title === "";
  const label = title || `Pixel-art ${stageNameFor(s).toLowerCase()}, health ${health} out of 100`;

  const plantRects = rects.filter((r) => r.plant);
  const potRects = rects.filter((r) => !r.plant);

  return (
    <svg
      viewBox={`0 0 ${GRID_W} ${GRID_H}`}
      className={className}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      shapeRendering="crispEdges"
    >
      {decorative ? null : <title>{label}</title>}
      <g
        className={animate ? "animate-wobble" : undefined}
        style={{ transformOrigin: `8px ${PLANT_ROWS}px`, transformBox: "view-box" }}
      >
        <g style={{ transform: DROOP[mood], transformOrigin: `8px ${PLANT_ROWS}px`, transition: "transform 900ms ease" }}>
          {plantRects.map((r) => (
            <rect key={`p${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
          ))}
        </g>
      </g>
      {potRects.map((r) => (
        <rect key={`b${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
