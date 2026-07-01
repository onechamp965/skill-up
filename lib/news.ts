import type {
  NewsBrief,
  NewsCandidate,
  NewsCategory,
  NewsShortsScript,
  NewsSource,
  NewsTone,
  TargetAudience,
  VideoDuration
} from "@/types/news";
import { buildRealisticNewsImagePrompt } from "@/lib/prompts";

const KEYWORD_SEARCH_NOT_CONFIGURED =
  "키워드 기반 뉴스 검색은 아직 설정되지 않았습니다. 기사 URL 또는 뉴스 텍스트를 입력해주세요.";

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function summarizeText(content: string, maxLength = 150) {
  const clean = content.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, maxLength).trim()}...`;
}

export function candidateFromSource(source: NewsSource): NewsCandidate {
  return {
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    published_at: source.published_at,
    one_line_summary: source.summary || summarizeText(source.content, 90),
    why_it_matters: "입력된 출처를 바탕으로 핵심 쟁점을 짧은 뉴스 쇼츠로 설명할 수 있습니다.",
    shorts_angle: "핵심 사실 3가지를 차분하게 정리하는 브리핑",
    reliability_note: source.url
      ? "사용자가 제공한 URL에서 수집했습니다. 업로드 전 원문 확인이 필요합니다."
      : "사용자가 직접 제공한 텍스트입니다. 원출처와 발행일 확인이 필요합니다."
  };
}

export function sourceFromText(text: string, category?: NewsCategory): NewsSource {
  const title = firstLikelyTitle(text) || `${category || "뉴스"} 입력 텍스트`;
  return {
    id: createId("source"),
    title,
    publisher: "직접 입력",
    fetched_at: new Date().toISOString(),
    content: text.trim(),
    summary: summarizeText(text, 140)
  };
}

function firstLikelyTitle(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length >= 8 && line.length <= 90);
}

export async function sourceFromUrl(url: string): Promise<NewsSource> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "NewsShortsStudio/0.1 (+https://example.com)"
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`기사 URL을 가져오지 못했습니다. (${response.status})`);
  }

  const html = await response.text();
  const title = extractMeta(html, "og:title") || extractTitle(html) || "URL 기사";
  const publisher = extractMeta(html, "og:site_name") || extractMeta(html, "article:publisher");
  const publishedAt = extractMeta(html, "article:published_time") || extractMeta(html, "date");
  const content = extractArticleText(html);

  if (content.length < 120) {
    throw new Error("기사 본문을 충분히 추출하지 못했습니다. 직접 텍스트 붙여넣기를 사용해주세요.");
  }

  return {
    id: createId("source"),
    title,
    publisher,
    url,
    published_at: publishedAt,
    fetched_at: new Date().toISOString(),
    content,
    summary: summarizeText(content, 140)
  };
}

export async function collectKeywordNews(): Promise<NewsSource[]> {
  if (!process.env.NEWS_API_KEY || !process.env.NEWS_PROVIDER) {
    throw new Error(KEYWORD_SEARCH_NOT_CONFIGURED);
  }

  throw new Error("NEWS_PROVIDER adapter가 아직 구현되지 않았습니다. 기사 URL 또는 뉴스 텍스트를 입력해주세요.");
}

function extractMeta(html: string, property: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1]);
    }
  }
  return undefined;
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1].replace(/\s+/g, " ").trim()) : undefined;
}

function extractArticleText(html: string) {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const source = articleMatch?.[1] || html;
  return decodeHtml(
    source
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, 12000);
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function fallbackBrief(
  sources: NewsSource[],
  tone: NewsTone,
  targetAudience: TargetAudience
): NewsBrief {
  const source = sources[0];
  const sourceIds = sources.map((item) => item.id);
  const sentences = source.content
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+|다\.\s*/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const points = sentences.slice(0, 4).map((sentence) => summarizeText(sentence, 120));

  return {
    title: source.title,
    one_line_summary: source.summary || summarizeText(source.content, 120),
    key_points: points.length ? points : [summarizeText(source.content, 120)],
    background: `${targetAudience} 대상의 ${tone} 톤으로 이해할 수 있도록, 제공된 원문 범위에서만 배경을 정리했습니다.`,
    why_it_matters: "이 뉴스는 사용자가 제공한 출처의 핵심 사실을 짧은 영상으로 확인할 수 있게 해줍니다.",
    uncertainty_notes: [
      source.published_at ? "원문 외 추가 검증은 별도로 필요합니다." : "발행일이 확인되지 않았습니다.",
      sources.length === 1 ? "한 출처에서만 확인된 내용입니다." : "출처별 표현 차이를 업로드 전 확인하세요."
    ],
    source_ids: sourceIds
  };
}

export function fallbackScript(
  brief: NewsBrief,
  sources: NewsSource[],
  tone: NewsTone,
  targetAudience: TargetAudience,
  duration: VideoDuration
): NewsShortsScript {
  const sceneCount = getSceneCount(duration);
  const durationPerScene = Math.max(4, Math.round(duration / sceneCount));
  const sourceSummary = sources
    .map((source) => `${source.publisher || "출처"}: ${source.title}${source.url ? `\n${source.url}` : ""}`)
    .join("\n");
  const basePoints = [brief.one_line_summary, ...brief.key_points, brief.why_it_matters].filter(Boolean);

  const scenes = Array.from({ length: sceneCount }, (_, index) => {
    const point = basePoints[index % basePoints.length];
    const visual_description = buildVisualDescription(index, brief.title);
    return {
      scene_number: index + 1,
      duration_sec: index === sceneCount - 1 ? duration - durationPerScene * (sceneCount - 1) : durationPerScene,
      scene_title: index === 0 ? "핵심 훅" : `핵심 포인트 ${index}`,
      visual_description,
      narration: index === 0 ? `${brief.title}. 핵심은 이겁니다. ${point}` : point,
      subtitle: summarizeText(index === 0 ? "핵심만 짧게 정리합니다" : point, 42),
      image_prompt: buildRealisticNewsImagePrompt({
        image_prompt: visual_description,
        visual_description,
        subtitle: index === 0 ? "핵심만 짧게 정리합니다" : summarizeText(point, 42),
        scene_title: index === 0 ? "핵심 훅" : `핵심 포인트 ${index}`
      }),
      source_reference: brief.source_ids[0]
    };
  });

  const narration = scenes.map((scene) => scene.narration).join("\n");

  return {
    title: brief.title,
    hook: scenes[0]?.narration || brief.one_line_summary,
    summary: brief.one_line_summary,
    total_duration_sec: duration,
    narration,
    source_summary: sourceSummary,
    fact_check_notes: brief.uncertainty_notes,
    youtube_metadata: {
      title: trimTitle(`${brief.title} #Shorts`),
      description: `${brief.one_line_summary}\n\n출처:\n${sourceSummary}\n\nAI가 생성한 요약은 오류가 있을 수 있습니다. 업로드 전 원문 출처와 사실관계를 반드시 확인하세요.`,
      tags: buildTags(tone, targetAudience),
      privacyStatus: "private",
      madeForKids: false,
      selfDeclaredMadeForKids: false
    },
    scenes
  };
}

function getSceneCount(duration: VideoDuration) {
  if (duration <= 30) return 5;
  if (duration <= 60) return 8;
  if (duration <= 90) return 11;
  if (duration <= 120) return 15;
  return 22;
}

function buildVisualDescription(index: number, title: string) {
  const visuals = [
    `newsroom desk with a phone, laptop, and printed notes about ${title}`,
    "person checking a news app on a phone during a commute",
    "press briefing room with microphones and cameras",
    "close-up of documents, calendar pages, and a laptop",
    "hands scrolling a phone on a train"
  ];
  return visuals[index % visuals.length];
}

function buildTags(tone: NewsTone, targetAudience: TargetAudience) {
  return ["뉴스", "뉴스요약", "Shorts", "#Shorts", "브리핑", tone, targetAudience].slice(0, 15);
}

function trimTitle(title: string) {
  return title.length > 100 ? title.slice(0, 97).trimEnd() + "..." : title;
}
