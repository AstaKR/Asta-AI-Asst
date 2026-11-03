import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api";
import { ArrowIcon } from "../components/Icons";
import { Layout } from "../components/Layout";
import { languageName } from "../lib/languages";
import type { Room } from "../types";

export function StartPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    api.rooms().then(setRooms).catch(() => setRooms([]));
  }, []);

  function join(e: FormEvent) {
    e.preventDefault();
    const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (clean) navigate(`/join/${clean}`);
  }

  return (
    <Layout>
      <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="card flex flex-col p-6">
          <h2 className="font-semibold">Start a new call</h2>
          <p className="mt-1 flex-1 text-sm text-muted">Choose your language, then share the invite code with the other person.</p>
          <Link to="/new" className="btn-primary mt-5">
            New call <ArrowIcon width={18} height={18} />
          </Link>
        </div>
        <form onSubmit={join} className="card flex flex-col p-6">
          <h2 className="font-semibold">Join a call</h2>
          <label className="mt-1 flex-1 text-sm text-muted" htmlFor="code">
            Enter the 8-character invite code.
          </label>
          <input
            id="code"
            className="field mt-3 font-mono tracking-[0.2em] uppercase"
            placeholder="ABCD2345"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn-secondary mt-3" disabled={!code.trim()}>
            Continue
          </button>
        </form>
      </div>
      {rooms.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent calls</h2>
          <ul className="card mt-3 divide-y divide-line">
            {rooms.map((room) => {
              const other = room.participants.find((p) => !p.is_you);
              return (
                <li key={room.code} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm">
                  <div>
                    <div className="font-medium">{other ? other.display_name : "Waiting for someone to join"}</div>
                    <div className="text-xs text-muted">
                      {new Date(room.created_at).toLocaleString()} ·{" "}
                      {room.participants.map((p) => languageName(p.spoken_language)).join(" ↔ ")}
                    </div>
                  </div>
                  {room.status === "ended" ? (
                    <Link to={`/call/${room.code}/summary`} className="text-brand hover:underline">
                      Summary
                    </Link>
                  ) : (
                    <Link to={`/call/${room.code}`} className="text-brand hover:underline">
                      Rejoin
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Layout>
  );
}
