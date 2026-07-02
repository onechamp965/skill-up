import type { CaptionSettings, GeneratedSceneImage, GeneratedVideo, GeneratedVoice, NewsScene, NewsShortsScript } from "@/types/news";

const VIDEO_WIDTH = 720;
const VIDEO_HEIGHT = 1280;
const FPS = 30;

type RenderShortsVideoInput = {
  script: NewsShortsScript;
  images: GeneratedSceneImage[];
  audio?: GeneratedVoice;
  captions?: CaptionSettings;
};

type LoadedScene = {
  scene: NewsScene;
  image: HTMLImageElement | null;
  startsAt: number;
  endsAt: number;
};

type TimedAudioBuffer = {
  startsAt: number;
  buffer: AudioBuffer;
};

export async function renderShortsVideo({ script, images, audio, captions }: RenderShortsVideoInput): Promise<GeneratedVideo> {
  if (typeof window === "undefined") {
    throw new Error("브라우저에서만 영상 렌더링을 실행할 수 있습니다.");
  }
  if (!("MediaRecorder" in window)) {
    throw new Error("이 브라우저는 영상 녹화를 지원하지 않습니다. Chrome 또는 Edge에서 다시 시도해주세요.");
  }
  const mimeType = pickRecordingMimeType();
  if (!mimeType) {
    throw new Error("이 브라우저에서 YouTube 업로드용 WebM 영상을 만들 수 없습니다.");
  }

  const scenes = buildTimeline(script.scenes, images);
  const audioBuffers = await decodeVoiceAudio(audio);
  const renderDuration = Math.max(
    3,
    Math.min(
      180,
      Math.max(
        script.total_duration_sec || 0,
        scenes.at(-1)?.endsAt || 0,
        ...audioBuffers.map((audioBuffer) => audioBuffer.startsAt + audioBuffer.buffer.duration)
      )
    )
  );

  const loadedScenes = await Promise.all(
    scenes.map(async (entry) => ({
      ...entry,
      image: await loadImage(entry.imageUrl)
    }))
  );

  const canvas = document.createElement("canvas");
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("영상 캔버스를 초기화하지 못했습니다.");
  }

  const videoStream = canvas.captureStream(FPS);
  const audioSetup = audioBuffers.length ? await createAudioSetup(audioBuffers) : undefined;
  const stream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...(audioSetup?.destination.stream.getAudioTracks() || [])
  ]);

  const blob = await recordCanvasStream({
    ctx,
    stream,
    audioContext: audioSetup?.context,
    audioSources: audioSetup?.sources,
    loadedScenes,
    script,
    captions: captions || { enabled: true },
    duration: renderDuration,
    mimeType
  });

  const videoUrl = URL.createObjectURL(blob);
  return {
    status: "success",
    video_url: videoUrl,
    file_name: `news-shorts-${Date.now()}.webm`,
    mime_type: blob.type || mimeType,
    size_bytes: blob.size,
    duration_sec: Math.round(renderDuration),
    blob
  };
}

async function createAudioSetup(audioBuffers: TimedAudioBuffer[]) {
  const AudioContextCtor = window.AudioContext || getWebkitAudioContext();
  if (!AudioContextCtor) {
    throw new Error("이 브라우저는 오디오 합성을 지원하지 않습니다.");
  }

  const context = new AudioContextCtor();
  await context.resume();
  const destination = context.createMediaStreamDestination();
  const sources = audioBuffers.map((timedBuffer) => {
    const source = context.createBufferSource();
    source.buffer = timedBuffer.buffer;
    source.connect(destination);
    return { source, startsAt: timedBuffer.startsAt };
  });
  return { context, sources, destination };
}

function pickRecordingMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

async function decodeAudio(audioUrl: string) {
  const AudioContextCtor = window.AudioContext || getWebkitAudioContext();
  if (!AudioContextCtor) {
    throw new Error("이 브라우저는 오디오 디코딩을 지원하지 않습니다.");
  }
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error("TTS 오디오 파일을 불러오지 못했습니다.");
  }
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new AudioContextCtor();
  try {
    return await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void audioContext.close();
  }
}

async function decodeVoiceAudio(audio: GeneratedVoice | undefined) {
  if (!audio || audio.status !== "success") return [];

  if (audio.audio_url) {
    return [{ startsAt: 0, buffer: await decodeAudio(audio.audio_url) }];
  }

  return [];
}

function getWebkitAudioContext() {
  return (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function buildTimeline(scenes: NewsScene[], images: GeneratedSceneImage[]) {
  let elapsed = 0;
  return scenes.map((scene) => {
    const duration = Math.max(1, scene.duration_sec || 1);
    const image = images.find((item) => item.scene_number === scene.scene_number && item.status === "success");
    const entry = {
      scene,
      imageUrl: image?.image_url,
      startsAt: elapsed,
      endsAt: elapsed + duration
    };
    elapsed += duration;
    return entry;
  });
}

async function loadImage(src?: string) {
  if (!src) return null;
  const image = new Image();
  image.decoding = "async";
  if (!src.startsWith("data:") && !src.startsWith("blob:")) {
    image.crossOrigin = "anonymous";
  }
  image.src = src;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

function recordCanvasStream({
  ctx,
  stream,
  audioContext,
  audioSources,
  loadedScenes,
  script,
  captions,
  duration,
  mimeType
}: {
  ctx: CanvasRenderingContext2D;
  stream: MediaStream;
  audioContext?: AudioContext;
  audioSources?: Array<{ source: AudioBufferSourceNode; startsAt: number }>;
  loadedScenes: LoadedScene[];
  script: NewsShortsScript;
  captions: CaptionSettings;
  duration: number;
  mimeType: string;
}) {
  return new Promise<Blob>((resolve, reject) => {
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    let frameId = 0;
    const delayMs = 120;
    const startedAt = performance.now() + delayMs;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      cancelAnimationFrame(frameId);
      stream.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
      reject(new Error("영상 녹화 중 오류가 발생했습니다."));
    };
    recorder.onstop = () => {
      cancelAnimationFrame(frameId);
      stream.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
      resolve(new Blob(chunks, { type: mimeType }));
    };

    const draw = () => {
      const elapsed = Math.max(0, (performance.now() - startedAt) / 1000);
      drawFrame(ctx, loadedScenes, script, captions, Math.min(elapsed, duration), duration);
      if (elapsed <= duration + 0.1) {
        frameId = requestAnimationFrame(draw);
      }
    };

    drawFrame(ctx, loadedScenes, script, captions, 0, duration);
    recorder.start(500);
    setTimeout(() => {
      if (audioContext && audioSources?.length) {
        const baseTime = audioContext.currentTime;
        audioSources.forEach((audioSource) => {
          audioSource.source.start(baseTime + audioSource.startsAt);
        });
      }
      frameId = requestAnimationFrame(draw);
    }, delayMs);
    setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    }, Math.ceil((duration + 0.35) * 1000));
  });
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  loadedScenes: LoadedScene[],
  script: NewsShortsScript,
  captions: CaptionSettings,
  elapsed: number,
  duration: number
) {
  const scene = pickScene(loadedScenes, elapsed);
  ctx.clearRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  drawBackground(ctx, scene?.image || null, scene?.scene.scene_number || 1);
  drawOverlay(ctx);
  drawTopChrome(ctx, script.title, elapsed, duration);
  if (scene) {
    drawSceneText(ctx, scene.scene, captions);
  }
  drawFooter(ctx, script.source_summary);
}

function pickScene(loadedScenes: LoadedScene[], elapsed: number) {
  return (
    loadedScenes.find((entry) => elapsed >= entry.startsAt && elapsed < entry.endsAt) ||
    loadedScenes.at(-1) ||
    null
  );
}

function drawBackground(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, sceneNumber: number) {
  const gradient = ctx.createLinearGradient(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  gradient.addColorStop(0, sceneNumber % 2 ? "#16312f" : "#182b44");
  gradient.addColorStop(0.55, "#1d2932");
  gradient.addColorStop(1, sceneNumber % 2 ? "#3b2f17" : "#2c3522");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

  if (!image) return;
  const scale = Math.max(VIDEO_WIDTH / image.width, VIDEO_HEIGHT / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = (VIDEO_WIDTH - width) / 2;
  const y = (VIDEO_HEIGHT - height) / 2;
  ctx.drawImage(image, x, y, width, height);
}

function drawOverlay(ctx: CanvasRenderingContext2D) {
  const dark = ctx.createLinearGradient(0, 0, 0, VIDEO_HEIGHT);
  dark.addColorStop(0, "rgba(0, 0, 0, 0.42)");
  dark.addColorStop(0.44, "rgba(0, 0, 0, 0.14)");
  dark.addColorStop(0.72, "rgba(0, 0, 0, 0.58)");
  dark.addColorStop(1, "rgba(0, 0, 0, 0.84)");
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
}

function drawTopChrome(ctx: CanvasRenderingContext2D, title: string, elapsed: number, duration: number) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.font = "800 25px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("NEWS SHORTS", 54, 74);

  ctx.font = "700 23px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedText(ctx, title, 54, 112, VIDEO_WIDTH - 108, 31, 2);

  const barWidth = VIDEO_WIDTH - 108;
  ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
  roundRect(ctx, 54, 154, barWidth, 8, 999);
  ctx.fillStyle = "#70e0cc";
  roundRect(ctx, 54, 154, Math.max(16, barWidth * Math.min(1, elapsed / duration)), 8, 999);
}

function drawSceneText(ctx: CanvasRenderingContext2D, scene: NewsScene, captions: CaptionSettings) {
  ctx.fillStyle = "#ffcf70";
  ctx.font = "900 30px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(`SCENE ${scene.scene_number}`, 54, 790);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 54px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedText(ctx, scene.scene_title, 54, 865, VIDEO_WIDTH - 108, 64, 3);

  if (!captions.enabled) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    ctx.font = "700 28px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    drawWrappedText(ctx, scene.visual_description || scene.subtitle, 54, 1010, VIDEO_WIDTH - 108, 36, 2);
  }

  if (captions.enabled) {
    drawCaptionBand(ctx, scene.narration || scene.subtitle || scene.scene_title);
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, sourceSummary: string) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
  ctx.font = "600 20px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedText(ctx, sourceSummary || "출처 확인 필요", 54, 1210, VIDEO_WIDTH - 108, 26, 2);
}

function drawCaptionBand(ctx: CanvasRenderingContext2D, text: string) {
  const caption = normalizeCaptionText(text);
  if (!caption) return;

  const x = 30;
  const y = 980;
  const width = VIDEO_WIDTH - 60;
  const height = 140;

  ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
  roundRect(ctx, x, y, width, height, 26);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 26);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.68)";
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";
  ctx.font = "900 40px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedText(ctx, caption, x + 28, y + 50, width - 56, 42, 3, true);
  ctx.fillStyle = "#ffffff";
  drawWrappedText(ctx, caption, x + 28, y + 50, width - 56, 42, 3);
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
  stroke = false
) {
  const lines = wrapText(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => {
    if (stroke) {
      ctx.strokeText(line, x, y + index * lineHeight);
      return;
    }
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const tokens = tokenize(text);
  const lines: string[] = [];
  let line = "";

  for (const token of tokens) {
    const test = line ? `${line}${token}` : token.trimStart();
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) {
      lines.push(line.trim());
      line = token.trimStart();
    } else {
      lines.push(token.trim());
      line = "";
    }
    if (lines.length === maxLines) break;
  }

  if (line && lines.length < maxLines) {
    lines.push(line.trim());
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
  }
  const last = lines.at(-1);
  if (last && tokens.join("").length > lines.join("").length) {
    lines[lines.length - 1] = last.length > 1 ? `${last.slice(0, -1)}...` : "...";
  }
  return lines;
}

function tokenize(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const words = normalized.split(/(\s+)/).filter(Boolean);
  if (words.length > 1) return words;
  return Array.from(normalized);
}

function normalizeCaptionText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}
