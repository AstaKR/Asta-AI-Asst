import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, meetingsApi } from "../../api";
import { checkUploadFile } from "../../lib/meetings";
import type { MeetingConfig } from "../../types";
import { ErrorBanner } from "../Layout";
import { CONSENT_TEXT, MeetingSetupFields, defaultSetup, type MeetingSetup } from "./MeetingSetupFields";

export function AudioUploader({ config }: { config: MeetingConfig }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [setup, setSetup] = useState<MeetingSetup>({ ...defaultSetup(), spoken_language: "auto" });
  const [engine, setEngine] = useState(config.default_engine);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  function choose(f: File | undefined) {
    if (!f) return;
    const problem = checkUploadFile(f, config);
    setError(problem ?? "");
    setFile(problem ? null : f);
    if (!problem && setup.title.startsWith("Meeting ")) setSetup({ ...setup, title: f.name.replace(/\.[^.]+$/, "") });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0]);
  }

  async function submit() {
    if (!file) return;
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("title", setup.title);
    form.append("source", "upload");
    form.append("spoken_language", setup.spoken_language);
    form.append("translation_language", setup.translation_language);
    form.append("engine", engine);
    form.append("consent", String(setup.consent));
    try {
      setProgress(0);
      const meeting = await meetingsApi.upload(form, setProgress);
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError ? err.message : "Upload failed");
    }
  }

  const engines = Object.entries(config.engines);
  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}
      >
        <p className="text-sm font-medium">{file ? file.name : "Drop an audio file here"}</p>
        <p className="mt-1 text-xs text-muted">
          {file
            ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
            : `${config.allowed_extensions.join(", ")} · up to ${config.max_upload_mb} MB · up to ${Math.round(config.max_duration_seconds / 60)} min`}
        </p>
        <button type="button" className="btn-secondary mt-4" onClick={() => input.current?.click()}>
          Choose file
        </button>
        <input ref={input} type="file" hidden accept={config.allowed_extensions.join(",")} onChange={(e) => choose(e.target.files?.[0])} />
      </div>
      <MeetingSetupFields value={setup} onChange={setSetup} consentText={CONSENT_TEXT} />
      {engines.length > 1 && (
        <fieldset>
          <legend className="label">Transcription engine</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {engines.map(([name, available]) => (
              <label key={name} className={`flex items-center gap-2 ${available ? "" : "text-muted"}`}>
                <input type="radio" name="engine" value={name} checked={engine === name} disabled={!available} onChange={() => setEngine(name)} />
                {name === "sarvam" ? "Sarvam AI (cloud, best for Tamil, ≈ ₹30 per hour of audio)" : "Local Whisper (free, slower, on this server)"}
                {!available && " — not available"}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {progress !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-brand transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <button className="btn-primary" disabled={!file || !setup.consent || !setup.title.trim() || progress !== null} onClick={() => void submit()}>
        {progress !== null ? `Uploading ${Math.round(progress * 100)}%…` : "Upload and transcribe"}
      </button>
    </div>
  );
}
