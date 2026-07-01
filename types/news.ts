export type NewsInputMode = "keyword" | "url" | "text";

export type NewsSource = {
  id: string;
  title: string;
  publisher?: string;
  author?: string;
  url?: string;
  published_at?: string;
  fetched_at: string;
  content: string;
  summary?: string;
};

export type NewsCandidate = {
  id: string;
  title: string;
  publisher?: string;
  url?: string;
  published_at?: string;
  one_line_summary: string;
  why_it_matters: string;
  shorts_angle: string;
  reliability_note: string;
};

export type NewsBrief = {
  title: string;
  one_line_summary: string;
  key_points: string[];
  background: string;
  why_it_matters: string;
  uncertainty_notes: string[];
  source_ids: string[];
};

export type NewsShortsScript = {
  title: string;
  hook: string;
  summary: string;
  total_duration_sec: number;
  narration: string;
  source_summary: string;
  fact_check_notes: string[];
  youtube_metadata: YouTubeUploadMetadata;
  scenes: NewsScene[];
};

export type NewsScene = {
  scene_number: number;
  duration_sec: number;
  scene_title: string;
  visual_description: string;
  narration: string;
  subtitle: string;
  image_prompt: string;
  source_reference?: string;
};

export type GeneratedSceneImage = {
  scene_number: number;
  image_url?: string;
  image_prompt: string;
  status: "success" | "failed";
  error?: string;
};

export type GeneratedVoice = {
  audio_url?: string;
  segments?: GeneratedVoiceSegment[];
  status: "success" | "failed";
  error?: string;
};

export type GeneratedVoiceSegment = {
  scene_number: number;
  audio_url?: string;
  status: "success" | "failed";
  error?: string;
};

export type GeneratedVideo = {
  video_url?: string;
  file_name?: string;
  mime_type?: string;
  size_bytes?: number;
  blob?: Blob;
  duration_sec?: number;
  status: "success" | "failed";
  error?: string;
};

export type YouTubePrivacyStatus = "private" | "unlisted" | "public";

export type YouTubeUploadMetadata = {
  title: string;
  description: string;
  tags: string[];
  categoryId?: string;
  privacyStatus: YouTubePrivacyStatus;
  madeForKids: boolean;
  selfDeclaredMadeForKids: boolean;
};

export type YouTubeUploadResult = {
  videoId?: string;
  videoUrl?: string;
  status: "success" | "failed";
  error?: string;
};

export type NewsCategory =
  | "전체"
  | "정치"
  | "경제"
  | "사회"
  | "국제"
  | "기술"
  | "AI"
  | "과학"
  | "문화"
  | "스포츠";

export type NewsTone =
  | "중립 브리핑"
  | "쉽게 설명"
  | "긴급 속보"
  | "팩트 체크"
  | "학생용 설명"
  | "투자자 관점"
  | "테크 분석";

export type TargetAudience =
  | "일반인"
  | "중학생"
  | "고등학생"
  | "대학생"
  | "직장인"
  | "개발자"
  | "투자 관심자";

export type VideoDuration = 30 | 45 | 60 | 90 | 120 | 180;

export type NewsGenerationStep =
  | "idle"
  | "collecting_news"
  | "news_ready"
  | "generating_brief"
  | "brief_ready"
  | "generating_script"
  | "script_ready"
  | "generating_images"
  | "images_ready"
  | "generating_voice"
  | "voice_ready"
  | "rendering_video"
  | "video_ready"
  | "uploading_youtube"
  | "uploaded"
  | "error";

export type CollectNewsRequest = {
  mode: NewsInputMode;
  keyword?: string;
  url?: string;
  text?: string;
  category?: NewsCategory;
};

export type CollectNewsResponse = {
  sources: NewsSource[];
  candidates: NewsCandidate[];
};

export type GenerateNewsBriefRequest = {
  sources: NewsSource[];
  tone: NewsTone;
  targetAudience: TargetAudience;
};

export type GenerateNewsBriefResponse = {
  brief: NewsBrief;
};

export type GenerateNewsScriptRequest = {
  brief: NewsBrief;
  sources: NewsSource[];
  tone: NewsTone;
  targetAudience: TargetAudience;
  duration: VideoDuration;
};

export type GenerateNewsScriptResponse = {
  script: NewsShortsScript;
};

export type GenerateImagesRequest = {
  scenes?: NewsScene[];
  script?: Pick<NewsShortsScript, "scenes">;
};

export type GenerateImagesResponse = {
  images: GeneratedSceneImage[];
};

export type GenerateVoiceRequest = {
  narration?: string;
  scenes?: NewsScene[];
  voice?: string;
  script?: Pick<NewsShortsScript, "narration" | "scenes">;
};

export type GenerateVoiceResponse = {
  voice: GeneratedVoice;
  audio?: GeneratedVoice;
};

export type RenderVideoRequest = {
  script: NewsShortsScript;
  images: GeneratedSceneImage[];
  audio?: GeneratedVoice;
};

export type RenderVideoResponse = {
  video: GeneratedVideo;
};

export type UploadToYouTubeRequest = {
  video: GeneratedVideo;
  metadata: YouTubeUploadMetadata;
};

export type UploadToYouTubeResponse = {
  result: YouTubeUploadResult;
};

export type NewsStudioState = {
  mode: NewsInputMode;
  keyword: string;
  url: string;
  text: string;
  category: NewsCategory;
  tone: NewsTone;
  targetAudience: TargetAudience;
  duration: VideoDuration;
  sources: NewsSource[];
  candidates: NewsCandidate[];
  selectedSourceId?: string;
  brief?: NewsBrief;
  script?: NewsShortsScript;
  images: GeneratedSceneImage[];
  voice?: GeneratedVoice;
  video?: GeneratedVideo;
  step: NewsGenerationStep;
};
