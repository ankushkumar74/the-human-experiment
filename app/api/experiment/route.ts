import { handleGetExperiment } from "@/lib/handlers";

// Per-visitor, always fresh: never cached.
export const GET = handleGetExperiment;
