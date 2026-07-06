import futureCityImage from "../assets/mock-media/future-city-astronaut.png";

export const previewImage = futureCityImage;

export interface MediaAssetMock {
  id: string;
  name: string;
  duration?: string;
  kind: "video" | "image" | "audio";
  thumbnail?: string;
  variant?: string;
}

export const mediaAssets: MediaAssetMock[] = [
  {
    id: "shot-01",
    name: "shot_01.mp4",
    duration: "00:12",
    kind: "video",
    thumbnail: futureCityImage,
    variant: "warm"
  },
  {
    id: "shot-02",
    name: "shot_02.mp4",
    duration: "00:08",
    kind: "video",
    thumbnail: futureCityImage,
    variant: "interior"
  },
  {
    id: "shot-03",
    name: "shot_03.mp4",
    duration: "00:10",
    kind: "video",
    thumbnail: futureCityImage,
    variant: "lake"
  },
  {
    id: "shot-04",
    name: "shot_04.mp4",
    duration: "00:06",
    kind: "video",
    thumbnail: futureCityImage,
    variant: "sunset"
  },
  {
    id: "segment-still",
    name: "分镜_St1.png",
    duration: "00:09",
    kind: "image",
    thumbnail: futureCityImage,
    variant: "ruin"
  },
  {
    id: "store",
    name: "Store_01.png",
    kind: "image",
    thumbnail: futureCityImage,
    variant: "desert"
  },
  {
    id: "scene",
    name: "scene_02.png",
    kind: "image",
    thumbnail: futureCityImage,
    variant: "wide"
  },
  {
    id: "audio",
    name: "bgm_ambient.wav",
    kind: "audio"
  },
  {
    id: "voiceover",
    name: "voiceover_take_01.wav",
    kind: "audio"
  }
];

export interface StoryboardCardMock {
  index: string;
  title: string;
  duration: string;
  thumbnail: string;
  variant: string;
}

export const storyboardCards: StoryboardCardMock[] = [
  {
    index: "01",
    title: "宇航员站在山崖上，望向未来城市",
    duration: "8s",
    thumbnail: futureCityImage,
    variant: "wide"
  },
  {
    index: "02",
    title: "飞船起飞，穿越云层",
    duration: "6s",
    thumbnail: futureCityImage,
    variant: "ship"
  },
  {
    index: "03",
    title: "飞行在未来城市上空",
    duration: "6s",
    thumbnail: futureCityImage,
    variant: "skyline"
  },
  {
    index: "04",
    title: "飞船降落在平台",
    duration: "6s",
    thumbnail: futureCityImage,
    variant: "landing"
  },
  {
    index: "05",
    title: "角色走出飞船",
    duration: "8s",
    thumbnail: futureCityImage,
    variant: "interior"
  }
];

export const timelineVideoClips = [
  { label: "shot_01.mp4", left: 0, width: 10, variant: "wide" },
  { label: "", left: 10.5, width: 11, variant: "lake" },
  { label: "shot_02.mp4", left: 22, width: 15, variant: "warm" },
  { label: "AI 生成片段_01", left: 38, width: 19, variant: "wide", selected: true },
  { label: "", left: 57.5, width: 11, variant: "ship" },
  { label: "shot_04.mp4", left: 69, width: 16, variant: "skyline" },
  { label: "", left: 85.5, width: 12, variant: "interior" }
];

export const timelineAudioClips = [
  { label: "bgm_ambient.wav", left: 6, width: 41 },
  { label: "voiceover_take_01.wav", left: 48, width: 29 }
];
