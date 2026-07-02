import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const OPENAI_API_URL = "https://api.openai.com/v1";
const GENERATED_IMAGE_DIR = path.join(process.cwd(), "public", "static", "output", "uploads");
const GENERATED_AUDIO_DIR = path.join(process.cwd(), "public", "generated", "audio");

export function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function generateImageWithOpenAI(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
  const response = await fetch(`${OPENAI_API_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1024x1024"
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(readOpenAIError(raw) || `OpenAI 이미지 생성 실패: ${response.status}`);
  }

  const payload = tryParseJson<{
    data?: Array<{
      b64_json?: string;
      url?: string;
    }>;
  }>(raw);
  const image = payload?.data?.[0];
  if (image?.b64_json) {
    return saveImageBuffer(Buffer.from(image.b64_json, "base64"), "png");
  }
  if (image?.url) {
    return image.url;
  }

  throw new Error("OpenAI 이미지 응답이 비어 있습니다.");
}

export async function generateSpeechWithOpenAI(text: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  const model = process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
  const response = await fetch(`${OPENAI_API_URL}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      voice: "alloy",
      input: text,
      format: "mp3"
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(readOpenAIError(raw) || `OpenAI TTS 생성 실패: ${response.status}`);
  }

  return saveAudioBuffer(Buffer.from(await response.arrayBuffer()), "mp3");
}

export async function createSilentAudioUrl(durationSec = 2) {
  const buffer = buildSilentWav(Math.max(1, Math.min(30, durationSec)));
  return saveAudioBuffer(buffer, "wav");
}

async function saveImageBuffer(buffer: Buffer, extension: "png" | "jpg") {
  try {
    await mkdir(GENERATED_IMAGE_DIR, { recursive: true });
    const fileName = `${randomUUID()}.${extension}`;
    const filePath = path.join(GENERATED_IMAGE_DIR, fileName);
    await writeFile(filePath, buffer);
    return `/static/output/uploads/${fileName}`;
  } catch {
    const mimeType = extension === "jpg" ? "image/jpeg" : "image/png";
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }
}

async function saveAudioBuffer(buffer: Buffer, extension: "mp3" | "wav") {
  try {
    await mkdir(GENERATED_AUDIO_DIR, { recursive: true });
    const fileName = `voice-${Date.now()}-${randomUUID()}.${extension}`;
    const filePath = path.join(GENERATED_AUDIO_DIR, fileName);
    await writeFile(filePath, buffer);
    return `/generated/audio/${fileName}`;
  } catch {
    const mimeType = extension === "mp3" ? "audio/mpeg" : "audio/wav";
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }
}

function buildSilentWav(durationSec: number) {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const sampleCount = sampleRate * durationSec;
  const dataSize = sampleCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function tryParseJson<T>(raw: string): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function readOpenAIError(raw: string) {
  const payload = tryParseJson<{ error?: { message?: string } }>(raw);
  return payload?.error?.message || raw;
}
