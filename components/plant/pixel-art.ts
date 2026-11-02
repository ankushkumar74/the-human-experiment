import type { HealthMood } from "@/lib/plant";

/**
 * Pixel-art plant, generated procedurally so all seven growth stages share one
 * visual language. The grid is 16 wide x 20 tall: rows 0-11 hold the plant,
 * rows 12-19 hold the pot.
 *
 * Palette keys
 *   g leaf   G leaf shade   l leaf light     s stem   S stem shade
 *   d soil   D soil dark    c pot   C pot shade   h pot rim
 *   f petal  F petal shade  y flower centre   e seed   E seed shade   W seed shine
 *   z sparkle / tear   a aura   k face (ink)
 */

export const GRID_W = 16;
export const GRID_H = 20;
export const PLANT_ROWS = 12;
export const STAGE_COUNT = 7;

type Grid = string[][];

const blank = (): Grid => Array.from({ length: GRID_H }, () => Array<string>(GRID_W).fill("."));

function put(grid: Grid, x: number, y: number, ch: string): void {
  if (x < 0 || x >= GRID_W || y < 0 || y >= PLANT_ROWS) return;
  grid[y][x] = ch;
}

function stem(grid: Grid, topRow: number): void {
  for (let y = topRow; y < PLANT_ROWS; y++) {
    put(grid, 7, y, "s");
    put(grid, 8, y, "S");
  }
}

/** A leaf of length `len` growing sideways from the stem, with a light top and a shaded underside. */
function leaf(grid: Grid, side: "L" | "R", y: number, len: number): void {
  const half = Math.ceil(len / 2);
  const xs = side === "L" ? range(7 - len, 6) : range(9, 8 + len);
  const outer = side === "L" ? xs.slice(0, half) : xs.slice(-half);
  const inner = side === "L" ? xs.slice(-half) : xs.slice(0, half);
  for (const x of xs) put(grid, x, y, "g");
  for (const x of outer) put(grid, x, y - 1, "l");
  for (const x of inner) put(grid, x, y + 1, "G");
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function bud(grid: Grid, y: number): void {
  put(grid, 7, y, "l");
  put(grid, 8, y, "l");
  put(grid, 7, y + 1, "g");
  put(grid, 8, y + 1, "g");
}

function flower(grid: Grid, cx: number, cy: number): void {
  put(grid, cx, cy, "y");
  put(grid, cx - 1, cy, "f");
  put(grid, cx + 1, cy, "f");
  put(grid, cx, cy - 1, "f");
  put(grid, cx, cy + 1, "F");
}

function pot(grid: Grid): void {
  const place = (y: number, x: number, text: string) => {
    [...text].forEach((ch, i) => {
      grid[y][x + i] = ch;
    });
  };
  place(12, 4, "dDdddDdd");
  place(13, 2, "hhhhhhhhhhhh");
  place(14, 2, "cccccccccccC");
  for (const y of [15, 16, 17]) place(y, 3, "cccccccccC");
  place(18, 4, "ccccccccC");
  place(19, 4, "CCCCCCCC");
}

/**
 * A tiny face on the pot. It is the quickest way to read the plant's health at a
 * glance: smiling when thriving, flat when okay, frowning when thirsty and
 * crying when critical.
 */
function face(grid: Grid, mood: HealthMood): void {
  const px = (x: number, y: number, ch: string) => {
    grid[y][x] = ch;
  };
  px(5, 15, "k");
  px(10, 15, "k");
  if (mood === "thriving") {
    for (const [x, y] of [[6, 16], [9, 16], [7, 17], [8, 17]] as const) px(x, y, "k");
  } else if (mood === "okay") {
    px(7, 16, "k");
    px(8, 16, "k");
  } else {
    for (const [x, y] of [[7, 16], [8, 16], [6, 17], [9, 17]] as const) px(x, y, "k");
    if (mood === "critical") {
      px(5, 16, "z");
      px(10, 16, "z");
    }
  }
}

/** Builds the pixel map for a growth stage (0 = Seed ... 6 = Legendary). */
export function buildPlantGrid(stage: number, mood: HealthMood = "okay"): string[] {
  const s = Math.min(Math.max(Math.floor(stage), 0), STAGE_COUNT - 1);
  const grid = blank();

  if (s === 0) {
    // A plump teardrop seed resting on the soil, with a highlight and a shaded side.
    for (const x of [7, 8]) put(grid, x, 8, "e");
    for (const x of [6, 7, 8, 9]) put(grid, x, 9, "e");
    for (const x of [5, 6, 7, 8, 9, 10]) put(grid, x, 10, "e");
    for (const x of [5, 6, 7, 8, 9, 10]) put(grid, x, 11, "e");
    for (const [x, y] of [[7, 8], [6, 9], [6, 10]] as const) put(grid, x, y, "W");
    for (const [x, y] of [[8, 8], [9, 9], [9, 10], [10, 10], [8, 11], [9, 11], [10, 11]] as const) put(grid, x, y, "E");
  }
  if (s === 1) {
    stem(grid, 8);
    leaf(grid, "L", 8, 3);
    leaf(grid, "R", 8, 3);
  }
  if (s === 2) {
    stem(grid, 5);
    for (const y of [9, 7]) {
      leaf(grid, "L", y, 3);
      leaf(grid, "R", y, 3);
    }
    bud(grid, 4);
  }
  if (s === 3) {
    stem(grid, 3);
    for (const [y, len] of [[10, 4], [8, 4], [6, 3], [4, 3]] as const) {
      leaf(grid, "L", y, len);
      leaf(grid, "R", y, len);
    }
    bud(grid, 2);
  }
  if (s >= 4) {
    stem(grid, 2);
    for (const [y, len] of [[10, 6], [8, 5], [6, 4], [4, 3]] as const) {
      leaf(grid, "L", y, len);
      leaf(grid, "R", y, len);
    }
    bud(grid, 1);
  }
  if (s >= 5) {
    flower(grid, 2, 7);
    flower(grid, 13, 7);
    flower(grid, 4, 3);
    flower(grid, 11, 3);
  }
  if (s === 6) {
    // Legendary: a crown flower, sparkles and an acid-green aura.
    flower(grid, 7, 0);
    put(grid, 8, 0, "f");
    for (const [x, y] of [[1, 2], [14, 1], [0, 5], [15, 4], [3, 0], [12, 0]] as const) put(grid, x, y, "z");
    for (const [x, y] of [[5, 1], [10, 2], [1, 9], [14, 9]] as const) put(grid, x, y, "a");
  }

  pot(grid);
  face(grid, mood);
  return grid.map((row) => row.join(""));
}

export const PALETTES: Record<HealthMood, Record<string, string>> = {
  thriving: { g: "#5fcf3a", G: "#2f8a2a", l: "#c8ff55", s: "#3f9b2f", S: "#2f7a25" },
  okay: { g: "#93cc3c", G: "#5f9a2a", l: "#dff070", s: "#6fa02f", S: "#55802a" },
  thirsty: { g: "#c9bf43", G: "#94902f", l: "#e8de7a", s: "#a09a35", S: "#7e7a2a" },
  critical: { g: "#a98a4c", G: "#7a5f32", l: "#c9aa6a", s: "#8a6a3a", S: "#6a5028" },
};

export const FIXED_COLORS: Record<string, string> = {
  d: "#7a4b2a",
  D: "#5a3419",
  c: "#ff795e",
  C: "#d9553c",
  h: "#ffa08c",
  f: "#a98bff",
  F: "#7c5ce0",
  y: "#ffd84d",
  e: "#e3b46a",
  E: "#b07a3a",
  W: "#fff0c4",
  k: "#1c1a16",
  z: "#5cdde2",
  a: "#c8ff55",
};

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  fill: string;
  /** true for rows that belong to the plant (they sway); false for the pot. */
  plant: boolean;
}

/** Horizontal runs of identical pixels merged into single rects (fewer nodes, no seams). */
export function gridToRects(rows: string[], mood: HealthMood, legendary = false): PixelRect[] {
  const palette = { ...FIXED_COLORS, ...PALETTES[mood] };
  if (legendary) palette.h = "#ffd84d"; // golden pot rim for the legendary plant
  const rects: PixelRect[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      if (ch !== "." && palette[ch]) rects.push({ x, y, w: run, fill: palette[ch], plant: y < PLANT_ROWS });
      x += run;
    }
  });
  return rects;
}
