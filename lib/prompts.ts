import type { NewsBrief, NewsScene, NewsSource, NewsTone, TargetAudience, VideoDuration } from "@/types/news";

type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const NEWS_IMAGE_PROMPT_RULE =
  "Vertical 9:16 composition, editorial news visual style, symbolic visual, cinematic lighting, clean background, high contrast, no text, no logo, no watermark, no real person's face, no copyrighted character, safe for all audiences.";

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
        "너는 뉴스 숏츠 작가이자 영상 디렉터다. 뉴스 브리프를 바탕으로 사실 기반 유튜브 숏츠 스크립트를 만든다. 첫 2초에 핵심 훅을 제시한다. 허위, 과장, 왜곡을 금지한다. 원문에 없는 사실을 추가하지 않는다. 선정적이거나 공포 조장 표현을 피한다. 정치/사회 뉴스는 중립적으로 작성한다. 자막은 짧고 명확하게 쓴다. 내레이션은 자연스러운 한국어로 쓴다. 각 씬은 source_reference를 포함한다. 이미지 프롬프트는 실제 보도사진 복제가 아니라 상징적/설명적 비주얼로 만든다. 유명인 얼굴, 정치인 얼굴, 회사 로고, 저작권 이미지 복제를 금지한다. YouTube 업로드용 metadata도 함께 생성한다. 결과는 JSON만 반환한다."
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
                image_prompt: "string",
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
  const rawPrompt = [
    scene.image_prompt,
    !scene.image_prompt?.trim() ? scene.visual_description : "",
    !scene.image_prompt?.trim() ? scene.scene_title : "",
    !scene.image_prompt?.trim() ? scene.narration : ""
  ]
    .filter(Boolean)
    .join(". ");
  const prompt = `${rawPrompt || `뉴스 쇼츠 장면 ${scene.scene_number}`}. ${NEWS_IMAGE_PROMPT_RULE}`;
  return prompt
    .replace(/\blogo\b/gi, "generic symbol")
    .replace(/\bwatermark\b/gi, "clean frame")
    .replace(/\bface\b/gi, "silhouette");
}
