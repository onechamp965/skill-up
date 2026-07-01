import type { NewsBrief, NewsScene, NewsSource, NewsTone, TargetAudience, VideoDuration } from "@/types/news";

type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const NEWS_IMAGE_PROMPT_RULE =
  "9:16 photorealistic editorial news photo, one clear subject, documentary realism, natural light, realistic color, shallow depth of field, no text, no overlays.";

export const NEWS_IMAGE_NEGATIVE_PROMPT =
  "text, letters, words, captions, subtitles, headlines, title, logo, watermark, sign, poster, label, interface text, qr code, infographic text, meme, illustration, cartoon, anime, CGI, surreal, distorted hands, extra fingers, blurry, low quality, duplicated objects, copyrighted character, real celebrity face";

export function buildRealisticNewsImagePrompt(
  scene: Pick<NewsScene, "image_prompt" | "scene_title" | "subtitle" | "visual_description">
) {
  const subject = scene.visual_description || scene.image_prompt || scene.subtitle || scene.scene_title || "";
  const concisePrompt = [
    subject,
    "realistic editorial news photo",
    "documentary style",
    "clear focal subject",
    "natural light",
    "no text",
    "no logo"
  ].filter(Boolean);

  return sanitizeImagePrompt(`${concisePrompt.join(", ")}. ${NEWS_IMAGE_PROMPT_RULE}`);
}

export function buildNewsBriefPrompt(
  sources: NewsSource[],
  tone: NewsTone,
  targetAudience: TargetAudience
): PromptMessage[] {
  return [
    {
      role: "system",
      content:
        "너는 뉴스 편집자이자 팩트 기반 요약 전문가다. 제공된 기사 원문과 출처 정보만 사용해 뉴스 브리프를 작성한다. 원문에 없는 사실을 만들지 않는다. 인명, 기업명, 숫자, 날짜는 원문 기준으로 유지한다. 확인되지 않은 내용은 uncertainty_notes에 넣는다. 의견과 사실을 구분한다. 정치적/사회적 이슈는 중립적으로 표현한다. 출처 ID를 명시한다. 결과는 JSON만 반환한다."
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          tone,
          targetAudience,
          requiredSchema: {
            title: "string",
            one_line_summary: "string",
            key_points: ["string"],
            background: "string",
            why_it_matters: "string",
            uncertainty_notes: ["string"],
            source_ids: ["string"]
          },
          sources
        },
        null,
        2
      )
    }
  ];
}

export function buildNewsScriptPrompt(
  brief: NewsBrief,
  sources: NewsSource[],
  tone: NewsTone,
  targetAudience: TargetAudience,
  duration: VideoDuration
): PromptMessage[] {
  return [
    {
      role: "system",
      content:
        "너는 뉴스 숏츠 작가이자 영상 디렉터다. 뉴스 브리프를 바탕으로 사실 기반 유튜브 숏츠 스크립트를 만든다. 첫 2초에 핵심 훅을 제시한다. 허위, 과장, 왜곡을 금지한다. 원문에 없는 사실을 추가하지 않는다. 선정적이거나 공포 조장 표현을 피한다. 정치/사회 뉴스는 중립적으로 작성한다. 자막은 짧고 명확하게 쓴다. 내레이션은 자연스러운 한국어로 쓴다. 각 씬은 source_reference를 포함한다. 이미지 프롬프트는 실제 보도사진처럼 보이는 현실적 장면으로 쓰되, 인물 식별이 가능한 얼굴과 로고, 화면 속 읽을 수 있는 텍스트는 피한다. YouTube 업로드용 metadata도 함께 생성한다. 결과는 JSON만 반환한다."
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          tone,
          targetAudience,
          duration,
          sceneRules: {
            perSceneSeconds: "4-8",
            sceneCounts: {
              "30": "4-5",
              "60": "7-9",
              "90": "10-12",
              "180": "18-24"
            }
          },
          imagePromptRequiredSuffix: NEWS_IMAGE_PROMPT_RULE,
          requiredSchema: {
            title: "string",
            hook: "string",
            summary: "string",
            total_duration_sec: "number",
            narration: "string",
            source_summary: "string",
            fact_check_notes: ["string"],
            youtube_metadata: {
              title: "string <= 100 chars",
              description: "string including sources",
              tags: ["string"],
              privacyStatus: "private",
              madeForKids: false,
              selfDeclaredMadeForKids: false
            },
            scenes: [
              {
                scene_number: "number",
                duration_sec: "number",
                scene_title: "string",
                visual_description: "string",
                narration: "string",
                subtitle: "string",
                image_prompt: "realistic editorial photo prompt",
                source_reference: "string"
              }
            ]
          },
          brief,
          sources
        },
        null,
        2
      )
    }
  ];
}

export function normalizeNewsImagePrompt(scene: NewsScene) {
  return buildRealisticNewsImagePrompt(scene)
    .replace(/\bheadline[s]?\b/gi, "visual cue")
    .replace(/\btitle\b/gi, "visual cue")
    .replace(/\bcaption[s]?\b/gi, "visual cue")
    .replace(/\bsubtitle[s]?\b/gi, "visual cue")
    .replace(/\btext\b/gi, "visual cue")
    .replace(/\blogo\b/gi, "generic symbol")
    .replace(/\bwatermark\b/gi, "clean frame")
    .replace(/\bface\b/gi, "person")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeImagePrompt(value: string) {
  return dedupePromptClauses(value.replace(/\s+/g, " ").trim(), 70);
}

function dedupePromptClauses(value: string, maxWords: number) {
  const seen = new Set<string>();
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const words: string[] = [];
  for (const part of parts) {
    const next = part.split(/\s+/);
    if (words.length + next.length > maxWords) break;
    words.push(...next);
  }

  return words.join(" ").replace(/\s+,/g, ",").trim();
}
