import { ExperimentPanel } from "@/components/experiment/experiment-panel";
import { ExperimentProvider } from "@/components/experiment/experiment-provider";
import { PlantStage } from "@/components/experiment/plant-stage";
import { HistorySection } from "@/components/history/history-section";
import { HeroCopy } from "@/components/layout/hero-copy";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ShareSection } from "@/components/share/share-section";

export default function HomePage() {
  return (
    <ExperimentProvider>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
        <div className="grid gap-6 pt-2 sm:pt-4 lg:grid-cols-[1.05fr_1fr] lg:gap-8">
          <div className="flex flex-col gap-6 lg:gap-8">
            <section aria-label="Introduction">
              <HeroCopy />
            </section>
            <PlantStage className="lg:flex-1" />
          </div>
          <ExperimentPanel />
        </div>
        <div className="mt-12 space-y-14 sm:mt-16 sm:space-y-20">
          <ShareSection />
          <HistorySection />
        </div>
      </main>
      <SiteFooter />
    </ExperimentProvider>
  );
}
