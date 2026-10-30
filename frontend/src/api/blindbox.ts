import { Platform } from "react-native";

import { http } from "./http";
import type {
  DistanceMi,
  HeatDate,
  HealthResponse,
  MetaResponse,
  Origin,
  PublicSpot,
  RecommendRequest,
  RecommendResponse,
  SpotListResponse,
  PlanUpdateInput,
  Review,
  TripPlan,
  RadarResponse,
  RadarSpot,
  TimeCapsule,
  UnlockPlanInput,
  UnlockResponse,
} from "./types";

export function fetchHealth(): Promise<HealthResponse> {
  return http.get<HealthResponse>("/api/health").then((response) => response.data);
}

export function fetchMeta(): Promise<MetaResponse> {
  return http.get<MetaResponse>("/api/meta").then((response) => response.data);
}

export function recommendSpots(input: {
  query: string;
  origin: Origin;
  maxDistanceMi?: DistanceMi;
}): Promise<RecommendResponse> {
  const body: RecommendRequest = {
    query: input.query,
    origin: input.origin,
  };
  if (input.maxDistanceMi != null) {
    body.max_distance_mi = input.maxDistanceMi;
  }
  return http.post<RecommendResponse>("/api/recommend", body).then((response) => response.data);
}

export function fetchSpots(origin: Origin, maxDistanceMi: DistanceMi): Promise<SpotListResponse> {
  return http
    .get<SpotListResponse>("/api/spots", {
      params: {
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        max_distance_mi: maxDistanceMi,
      },
    })
    .then((response) => response.data);
}

export function fetchSpot(
  spotId: string,
  options?: { unlockToken?: string; origin?: Origin },
): Promise<PublicSpot> {
  return http
    .get<{ spot: PublicSpot }>(`/api/spots/${encodeURIComponent(spotId)}`, {
      params: {
        unlock_token: options?.unlockToken,
        origin_lat: options?.origin?.lat,
        origin_lng: options?.origin?.lng,
      },
    })
    .then((response) => response.data.spot);
}

export function unlockSpot(spotId: string, plan: UnlockPlanInput): Promise<UnlockResponse> {
  return http
    .post<UnlockResponse>(`/api/spots/${encodeURIComponent(spotId)}/unlock`, {
      depart_date: plan.depart_date,
      days: plan.days ?? 1,
      companions: plan.companions,
      transport: plan.transport,
      itinerary: plan.itinerary ?? "",
      budget: plan.budget ?? null,
    })
    .then((response) => response.data);
}

export function fetchPlans(): Promise<{ plans: TripPlan[] }> {
  return http.get<{ plans: TripPlan[] }>("/api/plans").then((response) => response.data);
}

export function updatePlan(planId: number, body: PlanUpdateInput): Promise<TripPlan> {
  return http.put<{ plan: TripPlan }>(`/api/plans/${planId}`, body).then((response) => response.data.plan);
}

export function deletePlan(planId: number): Promise<void> {
  return http.delete(`/api/plans/${planId}`).then(() => undefined);
}

export function sharePlan(planId: number): Promise<{ share_token: string }> {
  return http.post<{ share_token: string }>(`/api/plans/${planId}/share`).then((response) => response.data);
}

export function importShare(token: string): Promise<TripPlan> {
  return http
    .post<{ plan: TripPlan }>(`/api/shares/${encodeURIComponent(token)}/import`)
    .then((response) => response.data.plan);
}

export function fetchHeat(spotId: string): Promise<HeatDate[]> {
  return http
    .get<{ dates: HeatDate[] }>(`/api/spots/${encodeURIComponent(spotId)}/heat`)
    .then((response) => response.data.dates);
}

export function fetchReviews(spotId: string): Promise<Review[]> {
  return http
    .get<{ reviews: Review[] }>(`/api/spots/${encodeURIComponent(spotId)}/reviews`)
    .then((response) => response.data.reviews);
}

export function fetchRadar(input?: { limit?: number; query?: string; exclude?: string }): Promise<RadarResponse> {
  return http
    .get<RadarResponse>("/api/radar/spots", {
      params: {
        limit: input?.limit ?? 15,
        query: input?.query ?? "",
        exclude: input?.exclude ?? "",
      },
    })
    .then((response) => response.data);
}

export function saveWishlist(spotId: string): Promise<{ created: boolean; spot: RadarSpot }> {
  return http
    .post<{ created: boolean; spot: RadarSpot }>("/api/wishlists", { spot_id: spotId })
    .then((response) => response.data);
}

export function fetchWishlists(): Promise<{ spots: RadarSpot[] }> {
  return http.get<{ spots: RadarSpot[] }>("/api/wishlists").then((response) => response.data);
}

export function fetchCapsules(spotId: string): Promise<TimeCapsule[]> {
  return http
    .get<{ capsules: TimeCapsule[] }>(`/api/spots/${encodeURIComponent(spotId)}/capsules`)
    .then((response) => response.data.capsules);
}

export async function publishCapsule(
  spotId: string,
  input: { content: string; lat: number; lng: number; imageUri: string },
): Promise<TimeCapsule> {
  const body = new FormData();
  body.append("content", input.content);
  body.append("lat", String(input.lat));
  body.append("lng", String(input.lng));
  if (Platform.OS === "web") {
    const file = await fetch(input.imageUri).then((response) => response.blob());
    body.append("image", file, "capsule.jpg");
  } else {
    body.append("image", {
      uri: input.imageUri,
      name: "capsule.jpg",
      type: "image/jpeg",
    } as unknown as Blob);
  }
  return http
    .post<{ capsule: TimeCapsule }>(`/api/spots/${encodeURIComponent(spotId)}/capsules`, body, {
      transformRequest: (data, headers) => {
        if (headers && typeof headers.delete === "function") {
          headers.delete("Content-Type");
        }
        return data;
      },
    })
    .then((response) => response.data.capsule);
}

export function createReview(spotId: string, body: { rating: number; content: string }): Promise<Review> {
  return http
    .post<{ review: Review }>(`/api/spots/${encodeURIComponent(spotId)}/reviews`, body)
    .then((response) => response.data.review);
}
