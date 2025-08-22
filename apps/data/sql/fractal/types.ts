export type FractalRowGet = {
  id: number;
  ticker: string;
  interval: string;
  time: Date; // DateTime as ISO string
  timenow: Date; // DateTime as ISO string
  volumeStrength: number;
  priceStrength: number;
  priceVolumeStrength: number;
  volumeStrengthMa: number;
  priceStrengthMa: number;
  priceVolumeStrengthMa: number;
  server_name: string;
  app_name: string;
  node_env: string;
  created_at: Date; // DateTime as ISO string
};

export type FractalRowAdd = {
  ticker: string;
  interval: string;
  time: Date;
  timenow: Date;
  volumeStrength: number;
  priceStrength: number;
  priceVolumeStrength: number;
  volumeStrengthMa: number;
  priceStrengthMa: number;
  priceVolumeStrengthMa: number;
  server_name?: string;
  app_name?: string;
  node_env?: string;
};
