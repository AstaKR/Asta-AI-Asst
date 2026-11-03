import { MEETING_LANGUAGES } from "../../lib/meetings";

export interface MeetingSetup {
  title: string;
  spoken_language: string; // "auto" allowed for recordings/uploads
  translation_language: string; // "" = no translation
  consent: boolean;
}

export function defaultSetup(): MeetingSetup {
  const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return { title: `Meeting ${date}`, spoken_language: "ta", translation_language: "en", consent: false };
}

export function MeetingSetupFields({
  value,
  onChange,
  allowAuto = true,
  consentText,
}: {
  value: MeetingSetup;
  onChange: (v: MeetingSetup) => void;
  allowAuto?: boolean;
  consentText: string;
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="label">Meeting title</span>
        <input className="field" value={value.title} maxLength={200} onChange={(e) => onChange({ ...value, title: e.target.value })} required />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Spoken language</span>
          <select className="field" value={value.spoken_language} onChange={(e) => onChange({ ...value, spoken_language: e.target.value })}>
            {allowAuto && <option value="auto">Detect automatically (mixed speech)</option>}
            {MEETING_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} · {l.native}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Translate into</span>
          <select className="field" value={value.translation_language} onChange={(e) => onChange({ ...value, translation_language: e.target.value })}>
            <option value="">No translation</option>
            {MEETING_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} · {l.native}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-start gap-3 rounded-xl bg-subtle px-4 py-3 text-sm">
        <input type="checkbox" className="mt-1" checked={value.consent} onChange={(e) => onChange({ ...value, consent: e.target.checked })} />
        <span className="text-ink">{consentText}</span>
      </label>
    </div>
  );
}

export const CONSENT_TEXT =
  "Everyone in this recording has agreed to it being recorded, stored on our server, and processed by AI services (Sarvam AI for speech and translation; Anthropic Claude for summaries if used). It is kept until I delete it.";
