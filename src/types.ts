export type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type SpriteBox = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected?: boolean;
  method?: string;
};

export type SpritePreview = SpriteBox & {
  dataUrl: string;
};

export type DetectionOptions = {
  tolerance: number;
  padding: number;
  minArea: number;
  maxArea: number;
  mergeDistance: number;
  gapThreshold: number;
  minSpriteWidth: number;
  minSpriteHeight: number;
  ignoreThinLines: boolean;
  removeSmallNoise: boolean;
  preserveShadow: boolean;
  pixelArt: boolean;
  ignoreText: boolean;
  ignoreLargePortraits: boolean;
  splitLargeEffects: boolean;
  exportScale: number;
  background: Rgba | null;
};

export type DetectionResult = {
  boxes: SpriteBox[];
  method: string;
};
