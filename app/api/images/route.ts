import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { GenerateImagesRequest, GenerateImagesResponse, GeneratedSceneImage } from "@/types/news";
import { generateImageWithOpenAI } from "@/lib/openai";
import { normalizeNewsImagePrompt } from "@/lib/prompts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateImagesRequest;
    const scenes = body.scenes?.length ? body.scenes : body.script?.scenes || [];
    const images: GeneratedSceneImage[] = [];
    const shouldPersistToPublic = await canPersistToPublic();

    for (const scene of scenes) {
      const image_prompt = normalizeNewsImagePrompt(scene);
      console.log("[IMAGE] scene:", scene.scene_number);
      console.log("[IMAGE] prompt:", image_prompt);
      try {
        const generatedImage = await generateImageWithOpenAI(image_prompt);
        const image_url = shouldPersistToPublic
          ? await saveSceneImage(scene.scene_number, generatedImage)
          : await toImageDataUrl(generatedImage);
        console.log("[IMAGE] saved:", image_url);
        images.push({ scene_number: scene.scene_number, image_prompt, image_url, status: "success" });
      } catch (error) {
        console.error("[IMAGE] failed:", error);
        images.push({
          scene_number: scene.scene_number,
          image_prompt,
          status: "failed",
          error: error instanceof Error ? error.message : "이미지 생성에 실패했습니다."
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

function getGeneratedImageDir() {
  return path.join(process.cwd(), "public", "generated", "images");
}

async function canPersistToPublic() {
  try {
    await mkdir(getGeneratedImageDir(), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function saveSceneImage(sceneNumber: number, generatedImage: string) {
  const fileName = `scene-${sceneNumber}.png`;
  const filePath = path.join(getGeneratedImageDir(), fileName);
  const buffer = await imageToBuffer(generatedImage);
  await writeFile(filePath, buffer);
  return `/generated/images/${fileName}`;
}

async function imageToBuffer(image: string) {
  if (image.startsWith("data:")) {
    const base64 = image.split(",", 2)[1];
    if (!base64) throw new Error("이미지 data URL을 읽을 수 없습니다.");
    return Buffer.from(base64, "base64");
  }

  const response = await fetch(image);
  if (!response.ok) throw new Error(`이미지 URL 다운로드 실패: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function toImageDataUrl(image: string) {
  if (image.startsWith("data:")) return image;
  const buffer = await imageToBuffer(image);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
