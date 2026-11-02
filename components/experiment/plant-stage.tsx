"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PixelPlant } from "@/components/plant/pixel-plant";
import { healthMood, type HealthMood } from "@/lib/plant";
import { useExperiment } from "./experiment-provider";

const BUBBLE: Record<HealthMood, { text: string; bg: string }> = {
  thriving: { text: "I feel amazing!", bg: "bg-acid" },
  okay: { text: "A sip would be nice.", bg: "bg-cyan" },
  thirsty: { text: "So… thirsty…", bg: "bg-lavender" },
  critical: { text: "Help. Water. Please.", bg: "bg-coral" },
};

const DROPLETS = [
  { x: "34%", delay: 0, size: 22 },
  { x: "44%", delay: 0.12, size: 26 },
  { x: "52%", delay: 0.05, size: 20 },
  { x: "60%", delay: 0.2, size: 24 },
  { x: "48%", delay: 0.32, size: 18 },
  { x: "39%", delay: 0.38, size: 20 },
  { x: "57%", delay: 0.45, size: 22 },
];

function Droplets() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {DROPLETS.map((d, i) => (
        <motion.span
          key={i}
          className="absolute block border-[2.5px] border-ink bg-cyan"
          style={{
            left: d.x,
            width: d.size,
            height: d.size,
            borderRadius: "50% 50% 50% 0",
            rotate: -45,
          }}
          initial={{ top: "-10%", opacity: 0, scale: 0.7 }}
          animate={{ top: ["-10%", "50%", "62%"], opacity: [0, 1, 0], scale: [0.7, 1, 0.9] }}
          transition={{ duration: 1.15, delay: d.delay, ease: "easeIn", times: [0, 0.7, 1] }}
        />
      ))}
    </div>
  );
}

/** A chunky pixel cloud: white blocks with a soft shade, no outline (so it never fights the plant). */
function Cloud({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 6" shapeRendering="crispEdges" className={`absolute w-20 ${className}`}>
      <g fill="#ffffff">
        <rect x="3" y="0" width="5" height="1" />
        <rect x="2" y="1" width="9" height="1" />
        <rect x="0" y="2" width="14" height="2" />
        <rect x="1" y="4" width="12" height="1" />
      </g>
      <g fill="#bfeff1">
        <rect x="1" y="5" width="12" height="1" />
      </g>
    </svg>
  );
}

/**
 * The hero visual: sky, sun, clouds, the pixel-art plant and a watering burst.
 * Everything shown comes from the live experiment state; while it is loading the
 * plant is ghosted instead of pretending to know the numbers.
 */
export function PlantStage({ className = "" }: { className?: string }) {
  const { snapshot, status, burst, offline } = useExperiment();
  const reduce = useReducedMotion();

  const loaded = snapshot !== null;
  const stage = snapshot?.growthStage ?? 1;
  const health = snapshot?.health ?? 70;
  const mood = healthMood(health);
  const bubble = BUBBLE[mood];

  return (
    <div
      className={`card relative aspect-square w-full overflow-hidden bg-gradient-to-b from-cyan/60 via-cyan/20 to-paper sm:aspect-[4/3.4] lg:aspect-auto lg:min-h-[460px] ${className}`}
    >
      <div className="absolute inset-0">
        {/* sun */}
        <div aria-hidden="true" className="absolute right-6 top-6 h-14 w-14 rounded-full border-[3px] border-ink bg-[#ffd84d] shadow-[3px_3px_0_0_var(--color-ink)] sm:h-16 sm:w-16" />
        <Cloud className="left-[8%] top-[22%] animate-float" />
        <Cloud className="left-[44%] top-[9%] w-14 animate-float [animation-delay:-2s]" />

        {/* mood bubble */}
        <AnimatePresence mode="wait">
          {loaded ? (
            <motion.div
              key={mood}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, rotate: -4, scale: 0.9 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, rotate: -3, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className={`sticker absolute left-4 top-4 z-10 max-w-[60%] text-sm sm:left-6 sm:top-6 sm:text-base ${bubble.bg}`}
            >
              {bubble.text}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* the plant */}
        <div className="absolute inset-x-0 bottom-[11%] flex justify-center">
          <motion.div
            key={burst}
            className={`w-[60%] max-w-[380px] origin-bottom sm:w-[56%] lg:w-[64%] transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-40"}`}
            initial={false}
            animate={burst > 0 && !reduce ? { scale: [1, 1.1, 0.97, 1], rotate: [0, -2.5, 2, 0] } : undefined}
            transition={{ duration: 0.9, delay: 0.7, ease: "easeOut" }}
          >
            <PixelPlant stage={stage} health={health} animate={!reduce && loaded} className="pixelated block h-auto w-full drop-shadow-[0_6px_0_rgba(28,26,22,0.12)]" />
          </motion.div>
        </div>

        {burst > 0 && !reduce ? <Droplets key={burst} /> : null}

        {/* ground */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[11%] border-t-[3px] border-ink bg-acid">
          <div className="h-full w-full opacity-30 [background-image:repeating-linear-gradient(90deg,transparent_0,transparent_14px,#1c1a16_14px,#1c1a16_16px)]" />
        </div>

        {/* stage / status tag */}
        <div className="absolute bottom-[13%] left-4 sm:left-6">
          <span className="sticker bg-white text-xs sm:text-sm">
            {loaded ? snapshot.stageName : status === "error" ? "Plant unreachable" : "Waking up the plant…"}
          </span>
        </div>
        {offline ? (
          <div className="absolute bottom-[13%] right-4 sm:right-6">
            <span className="sticker bg-coral text-xs sm:text-sm">Offline</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
