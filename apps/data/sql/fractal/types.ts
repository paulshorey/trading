export type FractalRowGet = {
  id: number;
  ticker: string;
  interval: number;
  time: string; // DateTime as ISO string
  timenow: string; // DateTime as ISO string
  volumeStrength: number;
  priceStrength: number;
  priceVolumeStrength: number;
  volumeStrengthMa: number;
  priceStrengthMa: number;
  priceVolumeStrengthMa: number;
  server_name: string;
  app_name: string;
  node_env: string;
  created_at: string; // DateTime as ISO string
};

export type FractalRowAdd = {
  ticker: string;
  interval: number;
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
