/** Matches the mile filters. Spoken distances snap up to the smallest tier that covers them. */
export const DISTANCE_OPTIONS_MI = [100, 250, 500, 1000, 3000] as const;

export type DistanceMi = (typeof DISTANCE_OPTIONS_MI)[number];

export type Origin = {
  lat: number;
  lng: number;
};

export type TagStrength = "strong" | "weak";

export type SpotTag = {
  name: string;
  name_en?: string;
  strength: TagStrength;
  weight: number;
};

export type WeatherSlice = {
  period: string;
  text: string | null;
  pop: string | null;
  precip: string | null;
  wind_dir: string | null;
  wind_scale: string | null;
};

export type AirBrief = {
  aqi: string | null;
  category: string | null;
  city_name: string | null;
};

export type SpotWeather =
  | {
      status: "unavailable";
      message: string;
    }
  | {
      status: "ok";
      source: "qweather" | "open-meteo";
      location_id: string | null;
      location_name: string | null;
      city_id: string | null;
      city_name: string | null;
      temp_max: string | null;
      temp_min: string | null;
      uv_index: string | null;
      precip_scope: "all_day" | "split";
      precip_unit?: "mm" | "in";
      day: WeatherSlice;
      night: WeatherSlice;
      air: AirBrief;
      attributions: string[];
    };

type SpotBase = {
  spot_id: string;
  display_name: string;
  province: string;
  city: string;
  summary_100w: string;
  description: string;
  image_url: string | null;
  tags: SpotTag[];
  distance_mi?: number;
  matched_tags?: SpotTag[];
  match_score?: number;
  match_ratio?: number;
  weather?: SpotWeather;
  events_and_discounts?: string | null;
  ai_strategy?: string | null;
  tag_interpretation?: string | null;
};

/** 列表和未解锁详情：没有全名、票价和精确坐标。 */
export type LockedSpot = SpotBase & {
  unlocked: false;
  can_review: false;
};

/** 提交行程计划之后的完整态。 */
export type UnlockedSpot = SpotBase & {
  unlocked: true;
  can_review: true;
  full_name: string;
  adult_ticket_price: number;
  location: Origin;
};

export type PublicSpot = LockedSpot | UnlockedSpot;

export function isUnlockedSpot(spot: PublicSpot): spot is UnlockedSpot {
  return spot.unlocked;
}

export type RecommendRequest = {
  query: string;
  origin: Origin;
  max_distance_mi?: DistanceMi;
};

/** 大模型由 ROBOTZERO 提供。客户端只有公司名，没有密钥。 */
export type LlmProvider = {
  company: string;
  service: "llm";
  user_supplies_key: false;
};

export type RecommendResponse = {
  query: string;
  parser: "keyword" | "llm";
  parsed_tags: string[];
  parsed_max_distance_mi: number | null;
  max_distance_mi: DistanceMi;
  origin: Origin;
  distance_options_mi: DistanceMi[];
  llm: LlmProvider;
  spots: LockedSpot[];
};

export type SpotListResponse = {
  max_distance_mi: DistanceMi;
  distance_options_mi: DistanceMi[];
  spots: LockedSpot[];
};

export type SpotDetailResponse = {
  spot: PublicSpot;
};

/** 详情页表单：日期、人数、交通方式。days 不填时请求层按 1 天提交。 */
export type UnlockPlanInput = {
  depart_date: string;
  companions: number;
  transport: string;
  days?: number;
  itinerary?: string;
  budget?: number | null;
};

export type UnlockPlan = {
  depart_date: string;
  days: number;
  companions: number;
  transport: string | null;
  budget: number | null;
  note: string | null;
};

export type UnlockResponse = {
  plan_id: number;
  unlock_token: string;
  unlocked: true;
  plan: UnlockPlan;
  spot: UnlockedSpot;
};

export type TripPlan = {
  id: number;
  spot_id: string;
  unlock_token: string;
  full_name: string;
  province: string;
  city: string;
  image_url: string | null;
  depart_date: string;
  companions: number;
  transport: string;
  days: number;
  itinerary: string;
  created_at: string;
};

export type PlanUpdateInput = {
  depart_date: string;
  days: number;
  companions: number;
  transport: string;
  itinerary: string;
};

export type HeatDate = {
  date: string;
  people: number;
};

export type AccountUser = {
  id: number;
  phone: string;
  sign_in?: "phone" | "apple" | "google";
  nickname: string;
  unlock_count: number;
  unlock_limit: number;
  is_vip: boolean;
  vip_expires_at: string | null;
};

export type PurchaseRecord = {
  id: number;
  plan_code: "monthly" | "quarterly" | "yearly";
  title: string;
  amount_usd: number;
  vip_expires_at: string;
  purchased_at: string;
};

export type VipPlanCode = PurchaseRecord["plan_code"];

export type Review = {
  id: number;
  spot_id: string;
  rating: number;
  content: string;
  created_at: string;
};

export type MetaResponse = {
  tag_count: number;
  catalog_tag_count: number;
  custom_tag_count: number;
  spot_count: number;
  distance_options_mi: DistanceMi[];
  weights: { strong: number; weak: number };
  blind_visible_chars: number;
  llm: LlmProvider;
};

export type HealthResponse = {
  ok: boolean;
};

export type TimeCapsule = {
  capsule_id: string;
  image_url: string;
  content: string;
  created_at: string;
  author: string;
};

export type RadarSpot = LockedSpot & {
  strong_tags: string[];
  match_score: number;
};

export type RadarResponse = {
  spots: RadarSpot[];
  parsed_tags: string[];
};
