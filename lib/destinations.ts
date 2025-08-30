export type Destination = {
  id: string;
  city: string;
  country: string;
  lat: number; lon: number;
  tags: string[];
  bestMonths?: number[];
};

export const DESTINATIONS: Destination[] = [
  { id: "tallinn", city: "Tallinn", country: "Estonia", lat: 59.437, lon: 24.753, tags: ["culture","food","uncrowded"], bestMonths: [5,6,7,8,9] },
  { id: "algarve", city: "Algarve", country: "Portugal", lat: 37.017, lon: -7.933, tags: ["beach","family","allInclusive"], bestMonths: [4,5,6,7,8,9,10] },
];
