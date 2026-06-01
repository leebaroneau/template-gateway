export interface DevApiServiceDetail {
  configured: boolean;
  [key: string]: boolean | number | string | null | undefined;
}

export interface DevApiRegionRecord {
  region: string;
  domain: string | null;
  brand_alias: string | null;
  public: boolean;
  services: Record<string, DevApiServiceDetail>;
}

export interface DevApiBrandRecord {
  slug: string;
  name: string;
  regions: DevApiRegionRecord[];
}

export interface DevApiBrandsResponse {
  brands: DevApiBrandRecord[];
}
