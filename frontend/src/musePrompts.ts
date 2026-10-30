import type { DistanceMi } from "./api/types";

export type MusePrompt = {
  id: string;
  promptKey: string;
  distance?: DistanceMi;
  days?: number;
  companions?: number;
};

export const MUSE_PROMPTS: MusePrompt[] = [
  { id: "weekend", promptKey: "muse.weekend", distance: 250, days: 2 },
  { id: "rainy", promptKey: "muse.rainy", distance: 100 },
  { id: "family", promptKey: "muse.family", distance: 250, companions: 4, days: 2 },
  { id: "photo", promptKey: "muse.photo", distance: 250 },
  { id: "food", promptKey: "muse.food", distance: 500 },
  { id: "hours48", promptKey: "muse.hours48", distance: 250, days: 2 },
];

export const ITINERARY_PROMPTS: MusePrompt[] = [
  { id: "slow", promptKey: "muse.itinerarySlow" },
  { id: "foodDay", promptKey: "muse.itineraryFood" },
  { id: "rainPlan", promptKey: "muse.itineraryRain" },
];

let pending: { days?: number; companions?: number } = {};

export function rememberMuseContext(prompt: Pick<MusePrompt, "days" | "companions">): void {
  pending = { days: prompt.days, companions: prompt.companions };
}

export function peekMuseContext(): { days?: number; companions?: number } {
  return pending;
}
