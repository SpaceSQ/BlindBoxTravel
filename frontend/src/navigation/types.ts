import type { NavigatorScreenParams } from "@react-navigation/native";

import type { DistanceMi, LockedSpot, Origin } from "../api/types";

export type ExploreStackParamList = {
  Home: undefined;
  List: {
    spots: LockedSpot[];
    origin: Origin;
    query: string;
    maxDistanceMi: DistanceMi;
  };
  Detail: {
    spotId: string;
    origin?: Origin;
    unlockToken?: string;
  };
  Radar: {
    query?: string;
  };
};

export type RootTabParamList = {
  Explore: NavigatorScreenParams<ExploreStackParamList> | undefined;
  Trips: { importToken?: string } | undefined;
  Wishlist: undefined;
  Account: undefined;
};
