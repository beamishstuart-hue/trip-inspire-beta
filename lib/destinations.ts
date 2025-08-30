export type Destination = {
  id: string;
  city: string;
  country: string;
  countryCode: string; // ISO-2
  lat: number; lon: number;
  tags: string[]; // e.g., ["beach","food","allInclusive","uncrowded"]
  bestMonths?: number[]; // 1-12
};

// SAMPLE (replace with your real list)
export const DESTINATIONS: Destination[] = [
  {
    id: "tallinn",
    city: "Tallinn",
    country: "Estonia",
    countryCode: "EE",
    lat: 59.437, lon: 24.753,
    tags: ["culture","food","uncrowded"],
    bestMonths: [5,6,7,8,9]
  },
  {
    id: "algarve",
    city: "Algarve",
    country: "Portugal",
    countryCode: "PT",
    lat: 37.017, lon: -7.933,
    tags: ["beach","family","allInclusive"],
    bestMonths: [4,5,6,7,8,9,10]
  },
  // ...add the rest of your destinations
];
