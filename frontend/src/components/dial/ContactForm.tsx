import { useState, type FormEvent } from "react";

import { ApiError, contactsApi } from "../../api";
import type { Contact } from "../../types";
import { Switch } from "../call/Switch";
import { StarIcon, TrashIcon } from "../Icons";
import { ErrorBanner } from "../Layout";
import { VOICES } from "../LanguagePicker";
import { LanguageKnob } from "./LanguageKnob";

export interface ContactDraft {
  target: string;
  spoken_language: string;
  listen_language: string;
}

/** Add a person to the phonebook, or change one: who they are and how you talk to them. */
export function ContactForm({
  contact,
  draft,
  onSaved,
  onCancel,
  onDeleted,
}: {
  contact?: Contact;
  draft?: ContactDraft;
  onSaved: (c: Contact) => void;
  onCancel: () => void;
  onDeleted?: (c: Contact) => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [target, setTarget] = useState(contact?.target ?? draft?.target ?? "");
  const [spoken, setSpoken] = useState(contact?.spoken_language ?? draft?.spoken_language ?? "ta-IN");
  const [listen, setListen] = useState(contact?.listen_language ?? draft?.listen_language ?? "ta-IN");
  const [voice, setVoice] = useState(contact?.voice ?? "");
  const [favorite, setFavorite] = useState(contact?.favorite ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = contact
        ? await contactsApi.update(contact.id, { name: name.trim(), spoken_language: spoken, listen_language: listen, voice, favorite })
        : await contactsApi.create({ target: target.trim(), name: name.trim(), spoken_language: spoken, listen_language: listen, voice, favorite });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the contact");
      setBusy(false);
    }
  }

  async function remove() {
    if (!contact || !window.confirm(`Remove ${contact.name} from your contacts?`)) return;
    setBusy(true);
    try {
      await contactsApi.remove(contact.id);
      onDeleted?.(contact);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the contact");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card wm-pop space-y-5 p-5 sm:p-6" aria-label={contact ? `Edit ${contact.name}` : "New contact"}>
      <h2 className="page-title text-[1.5rem]">{contact ? "Edit contact" : "New contact"}</h2>
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">Name</span>
          <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ravi anna" autoComplete="off" />
        </label>
        <label>
          <span className="label">Username or mobile number</span>
          <input className="field" value={target} maxLength={40} onChange={(e) => setTarget(e.target.value)} placeholder="ravi or 98765 43210" autoComplete="off" disabled={Boolean(contact)} required />
        </label>
      </div>
      <div>
        <p className="label">How you talk to them</p>
        <div className="flex flex-wrap items-start justify-center gap-x-8 gap-y-2 rounded-2xl border-2 border-dashed border-edge/50 py-3">
          <LanguageKnob label="I speak" value={spoken} onChange={setSpoken} />
          <LanguageKnob label="I hear" value={listen} onChange={setListen} />
        </div>
        <p className="mt-2 text-xs text-muted">These fill in the dialer whenever you call this person, and are used when you tap call in your contacts.</p>
      </div>
      <label className="block">
        <span className="label">Your translated voice for this person</span>
        <select className="field" value={voice} onChange={(e) => setVoice(e.target.value)}>
          <option value="">Default</option>
          {VOICES.map((v) => (
            <option key={v} value={v}>
              {v[0].toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <Switch checked={favorite} onChange={setFavorite} title="Favourite" icon={<StarIcon width={20} height={20} />}>
        Favourites sit at the top of your contacts.
      </Switch>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={busy || !target.trim()}>
          {busy ? "Saving…" : contact ? "Save changes" : "Save contact"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {contact && (
          <button type="button" className="btn-ghost ml-auto !text-danger" onClick={() => void remove()} disabled={busy}>
            <TrashIcon width={18} height={18} /> Remove
          </button>
        )}
      </div>
    </form>
  );
}
