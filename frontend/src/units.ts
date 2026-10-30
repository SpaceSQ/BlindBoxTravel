const KM_PER_MILE = 1.609344;

export function formatMiles(miles: number, unit = "mi"): string {
  const count = miles >= 100 ? String(Math.round(miles)) : miles.toFixed(1);
  return `${count} ${unit}`;
}

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

const TRANSPORT_KEYS: Record<string, "transport.drive" | "transport.train" | "transport.flight" | "transport.coach" | "transport.cruise"> = {
  自驾: "transport.drive",
  Drive: "transport.drive",
  drive: "transport.drive",
  高铁: "transport.train",
  Train: "transport.train",
  train: "transport.train",
  飞机: "transport.flight",
  Flight: "transport.flight",
  flight: "transport.flight",
  大巴: "transport.coach",
  Coach: "transport.coach",
  coach: "transport.coach",
  Bus: "transport.coach",
  bus: "transport.coach",
  游轮: "transport.cruise",
  Cruise: "transport.cruise",
  cruise: "transport.cruise",
};

export function transportKey(value: string) {
  return TRANSPORT_KEYS[value] ?? "transport.drive";
}
