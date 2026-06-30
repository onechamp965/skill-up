import { NextResponse } from "next/server";
import type { GenerateImagesRequest, GenerateImagesResponse, GeneratedSceneImage, NewsScene } from "@/types/news";
import { generateImageWithOpenAI } from "@/lib/openai";
import { normalizeNewsImagePrompt } from "@/lib/prompts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateImagesRequest;
    const images: GeneratedSceneImage[] = [];

    for (const scene of body.scenes || []) {
      const image_prompt = normalizeNewsImagePrompt(scene);
      try {
        const image_url = await generateImageWithOpenAI(image_prompt);
        images.push({ scene_number: scene.scene_number, image_prompt, image_url, status: "success" });
      } catch (error) {
        images.push({
          scene_number: scene.scene_number,
          image_prompt,
          image_url: createFallbackSceneImage(scene),
          status: "success",
          error: `OpenAI 이미지 생성 실패로 대체 비주얼을 사용했습니다: ${
            error instanceof Error ? error.message : "이미지 생성에 실패했습니다."
          }`
        });
      }
    }

    const response: GenerateImagesResponse = { images };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "이미지 생성 요청에 실패했습니다." },
      { status: 500 }
    );
  }
}

function createFallbackSceneImage(scene: NewsScene) {
  const palette = scene.scene_number % 2 === 0
    ? { top: "#18324a", bottom: "#0f766e", accent: "#ffcf70" }
    : { top: "#16312f", bottom: "#334155", accent: "#70e0cc" };
  const title = escapeXml(scene.scene_title || `Scene ${scene.scene_number}`);
  const subtitle = escapeXml(scene.subtitle || scene.visual_description || "뉴스 쇼츠 장면");
  const sceneLabel = escapeXml(`SCENE ${scene.scene_number}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.top}"/>
      <stop offset="1" stop-color="${palette.bottom}"/>
    </linearGradient>
    <radialGradient id="glow" cx="35%" cy="20%" r="70%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1536" fill="url(#bg)"/>
  <rect width="1024" height="1536" fill="url(#glow)"/>
  <rect x="72" y="98" width="880" height="12" rx="6" fill="rgba(255,255,255,0.38)"/>
  <rect x="72" y="98" width="420" height="12" rx="6" fill="${palette.accent}"/>
  <text x="72" y="180" fill="#ffffff" font-family="Arial, sans-serif" font-size="42" font-weight="800">NEWS SHORTS</text>
  <text x="72" y="860" fill="${palette.accent}" font-family="Arial, sans-serif" font-size="46" font-weight="900">${sceneLabel}</text>
  <foreignObject x="72" y="900" width="880" height="280">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; color: white; font-size: 74px; font-weight: 900; line-height: 1.08; word-break: keep-all;">${subtitle}</div>
  </foreignObject>
  <foreignObject x="72" y="1230" width="880" height="120">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; color: rgba(255,255,255,0.86); font-size: 38px; font-weight: 700; line-height: 1.25; word-break: keep-all;">${title}</div>
  </foreignObject>
  <text x="72" y="1420" fill="rgba(255,255,255,0.68)" font-family="Arial, sans-serif" font-size="28" font-weight="700">AI fallback visual</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
