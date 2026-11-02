import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { plantToSvg } from "@/components/plant/pixel-art";
import type { HealthMood } from "@/lib/plant";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

// Read from disk (next.config.ts makes sure assets/fonts ships with the serverless functions).
async function loadFont(): Promise<Buffer> {
  return readFile(join(process.cwd(), "assets/fonts/SpaceGrotesk-Bold.woff"));
}

const svgDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

export interface ShareCard {
  kicker: string;
  headline: string;
  detail?: string;
  /** Headline size in px (default 96). Long headlines need a smaller one. */
  headlineSize?: number;
  stage: number;
  mood?: HealthMood;
}

/**
 * Branded 1200x630 share card. Built only from public, non-identifying values
 * (a watering number and a growth stage).
 */
export async function renderShareCard(card: ShareCard): Promise<ImageResponse> {
  const font = await loadFont();
  const plant = svgDataUri(plantToSvg(card.stage, card.mood ?? "thriving"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#fff8ec",
          fontFamily: "Space Grotesk",
          color: "#1c1a16",
          padding: 36,
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            border: "8px solid #1c1a16",
            borderRadius: 48,
            background: "#ffffff",
            boxShadow: "14px 14px 0 0 #1c1a16",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1.25, padding: "48px 24px 44px 56px" }}>
            <div style={{ display: "flex" }}>
              <div
                style={{
                  display: "flex",
                  background: "#a98bff",
                  border: "5px solid #1c1a16",
                  borderRadius: 999,
                  padding: "6px 26px",
                  fontSize: 30,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {card.kicker}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: card.headlineSize ?? 96, lineHeight: 0.98, letterSpacing: -3 }}>{card.headline}</div>
              {card.detail ? (
                <div style={{ display: "flex", fontSize: 38, marginTop: 20, color: "#5b564b" }}>{card.detail}</div>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 28 }}>
              <div style={{ display: "flex", color: "#1c1a16" }}>One planet. Millions of strangers.</div>
              <div style={{ display: "flex", color: "#1c1a16" }}>One very thirsty plant.</div>
              <div style={{ display: "flex", marginTop: 10, fontSize: 24, color: "#5b564b" }}>The Human Experiment</div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              flex: 1,
              background: "#5cdde2",
              borderLeft: "8px solid #1c1a16",
              paddingBottom: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={plant} width={400} height={500} alt="" style={{ imageRendering: "pixelated" }} />
              <div style={{ display: "flex", width: "100%", height: 54, background: "#c8ff55", borderTop: "8px solid #1c1a16" }} />
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: "Space Grotesk", data: font, weight: 700, style: "normal" }],
    },
  );
}
