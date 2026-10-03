"use client";

import {
  CircleNotch,
  Microphone,
  Stop,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { relationshipIntegrationFetch } from "@/components/workspace-session-request";
import { encodeVoiceWav } from "@/lib/agent-voice-wav";

type VoicePhase =
  | "idle"
  | "disclosure"
  | "requesting"
  | "recording"
  | "transcribing"
  | "failed";

type VoiceResource = {
  context: AudioContext;
  gain: GainNode;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
};

const DISCLOSURE_KEY = "talent-signal:voice-disclosure:v1";
const MAX_RECORDING_SECONDS = 60;

function voiceErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "麦克风访问已关闭。请在浏览器设置中允许后重试。";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "此设备没有可用麦克风。";
  }
  return error instanceof Error
    ? error.message
    : "语音输入未能创建可编辑草稿。";
}

export function AgentVoiceInput({
  disabled = false,
  onTranscript,
}: {
  disabled?: boolean;
  onTranscript: (transcript: string) => void;
}) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const resourcesRef = useRef<VoiceResource | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  }, []);

  const releaseAudio = useCallback(() => {
    clearTimers();
    const resources = resourcesRef.current;
    resourcesRef.current = null;
    if (!resources) return;
    resources.processor.onaudioprocess = null;
    resources.source.disconnect();
    resources.processor.disconnect();
    resources.gain.disconnect();
    for (const track of resources.stream.getTracks()) track.stop();
    void resources.context.close();
  }, [clearTimers]);

  function reset() {
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    releaseAudio();
    chunksRef.current = [];
    sampleRateRef.current = 0;
    setElapsedSeconds(0);
    setError("");
    setPhase("idle");
  }

  async function transcribeRecording() {
    const chunks = chunksRef.current;
    const sampleRate = sampleRateRef.current;
    releaseAudio();
    if (chunks.reduce((total, chunk) => total + chunk.length, 0) < sampleRate / 4) {
      setError("没有录到语音，请尝试说一句简短的话。");
      setPhase("failed");
      return;
    }
    setPhase("transcribing");
    const controller = new AbortController();
    requestAbortRef.current?.abort();
    requestAbortRef.current = controller;
    try {
      const wav = encodeVoiceWav(chunks, sampleRate);
      const requestId = crypto.randomUUID();
      const form = new FormData();
      form.set("request_id", requestId);
      form.set(
        "file",
        new File([wav], "relationship-voice.wav", { type: "audio/wav" }),
      );
      const result = await relationshipIntegrationFetch(
        "/api/local-integration/voice-transcriptions",
        { method: "POST", body: form, signal: controller.signal },
      );
      const payload = (await result.json()) as {
        client_request_id?: string;
        message?: string;
        provider?: string;
        status?: string;
        temporary_audio_stored_by_talent_signal?: boolean;
        transcript?: string;
      };
      if (
        !result.ok ||
        payload.client_request_id !== requestId ||
        payload.provider !== "doubao" ||
        payload.status !== "draft" ||
        payload.temporary_audio_stored_by_talent_signal !== false ||
        !payload.transcript?.trim()
      ) {
        throw new Error(
          payload.message ?? "语音转写没有返回可编辑草稿。",
        );
      }
      onTranscript(payload.transcript.trim());
      reset();
    } catch (caught) {
      if (controller.signal.aborted) return;
      chunksRef.current = [];
      sampleRateRef.current = 0;
      setError(voiceErrorMessage(caught));
      setPhase("failed");
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
    }
  }

  async function startRecording() {
    setError("");
    setPhase("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("此浏览器不支持语音输入。");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (document.visibilityState !== "visible") {
        for (const track of stream.getTracks()) track.stop();
        throw new Error("录制语音时，请让此标签页保持可见。");
      }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const gain = context.createGain();
      gain.gain.value = 0;
      chunksRef.current = [];
      sampleRateRef.current = context.sampleRate;
      processor.onaudioprocess = (event) => {
        chunksRef.current.push(
          new Float32Array(event.inputBuffer.getChannelData(0)),
        );
      };
      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);
      resourcesRef.current = { context, gain, processor, source, stream };
      try {
        sessionStorage.setItem(DISCLOSURE_KEY, "accepted");
      } catch {
        // Storage availability must not decide whether an approved recording works.
      }
      setElapsedSeconds(0);
      setPhase("recording");
      const startedAt = Date.now();
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(
          Math.min(
            MAX_RECORDING_SECONDS,
            Math.floor((Date.now() - startedAt) / 1_000),
          ),
        );
      }, 250);
      timeoutRef.current = setTimeout(() => {
        void transcribeRecording();
      }, MAX_RECORDING_SECONDS * 1_000);
    } catch (caught) {
      releaseAudio();
      setError(voiceErrorMessage(caught));
      setPhase("failed");
    }
  }

  function openVoice() {
    if (phase === "recording") {
      void transcribeRecording();
      return;
    }
    if (phase !== "idle") return;
    let disclosureAccepted = false;
    try {
      disclosureAccepted =
        sessionStorage.getItem(DISCLOSURE_KEY) === "accepted";
    } catch {
      disclosureAccepted = false;
    }
    if (disclosureAccepted) {
      void startRecording();
    } else {
      setPhase("disclosure");
    }
  }

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" || !resourcesRef.current) return;
      releaseAudio();
      chunksRef.current = [];
      setError("标签页离开前台时，语音录制已停止，没有发送任何内容。");
      setPhase("failed");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      releaseAudio();
    };
  }, [releaseAudio]);

  const busy = phase === "requesting" || phase === "transcribing";
  const buttonLabel =
    phase === "recording"
      ? "停止并转写"
      : busy
        ? "正在准备语音输入"
        : "开始语音输入";

  return (
    <div className="context-chat__voice" data-phase={phase}>
      <button
        aria-label={buttonLabel}
        aria-pressed={phase === "recording"}
        className="context-chat__voice-button"
        disabled={disabled || busy}
        onClick={openVoice}
        type="button"
      >
        {busy ? (
          <CircleNotch aria-hidden="true" className="spin" size={18} />
        ) : phase === "recording" ? (
          <Stop aria-hidden="true" size={17} weight="fill" />
        ) : (
          <Microphone aria-hidden="true" size={18} weight="duotone" />
        )}
      </button>

      {phase !== "idle" ? (
        <div
          aria-live="polite"
          className="context-chat__voice-status"
          role={phase === "disclosure" ? "dialog" : "status"}
        >
          {phase === "disclosure" ? (
            <>
              <div>
                <strong>把语音转换为可编辑草稿？</strong>
                <p>
                  临时音频会发送给豆包进行转写，capri 不会保存。按下发送前，任何内容都不会进入智能助理。
                </p>
              </div>
              <div className="context-chat__voice-actions">
                <button onClick={reset} type="button">暂时不要</button>
                <button onClick={() => void startRecording()} type="button">
                  开始录音
                </button>
              </div>
            </>
          ) : phase === "recording" ? (
            <>
              <div>
                <strong>正在聆听 · {elapsedSeconds} 秒</strong>
                <p>仅前台录制 · 最长 {MAX_RECORDING_SECONDS} 秒</p>
              </div>
              <button aria-label="取消语音输入" onClick={reset} type="button">
                <X aria-hidden="true" size={16} />
              </button>
            </>
          ) : phase === "requesting" ? (
            <div>
              <strong>正在等待麦克风权限…</strong>
              <p>录制停止前不会发送音频。</p>
            </div>
          ) : phase === "transcribing" ? (
            <>
              <div>
                <strong>正在创建可编辑对话稿…</strong>
                <p>完成前，当前消息草稿保持不变。</p>
              </div>
              <button
                aria-label="取消语音转写"
                onClick={reset}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </>
          ) : (
            <>
              <div>
                <strong>未创建语音草稿</strong>
                <p>{error}</p>
              </div>
              <button aria-label="关闭语音错误" onClick={reset} type="button">
                <X aria-hidden="true" size={16} />
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
