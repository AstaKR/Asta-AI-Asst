import { describe, expect, it } from "vitest";

import type { Contact } from "../types";
import { avatarColor, initialOf, matchContacts, toKeys } from "./smartDial";

const person = (over: Partial<Contact>): Contact => ({
  id: 1,
  name: "Someone",
  target: "someone",
  username: "someone",
  spoken_language: "ta-IN",
  listen_language: "hi-IN",
  voice: "",
  favorite: false,
  call_count: 0,
  last_called_at: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const ravi = person({ id: 1, name: "Ravi anna", username: "ravi_k", target: "ravi_k" });
const meena = person({ id: 2, name: "Meena Akka", username: "meena", target: "+919876543210" });
const arjun = person({ id: 3, name: "Arjun", username: "arjun", target: "arjun", favorite: true });
const all = [ravi, meena, arjun];

describe("toKeys", () => {
  it("spells words on the phone keys", () => {
    expect(toKeys("Ravi")).toBe("7284");
    expect(toKeys("meena")).toBe("63362");
  });
  it("keeps digits and plus, skips letters it does not know", () => {
    expect(toKeys("+91 98")).toBe("+9198");
    expect(toKeys("வணக்கம்")).toBe("");
  });
});

describe("matchContacts", () => {
  it("finds a name from the digits that spell its start", () => {
    expect(matchContacts(all, "7284").map((c) => c.name)).toEqual(["Ravi anna"]);
    expect(matchContacts(all, "7")).toContain(ravi);
  });
  it("matches any word of the name, not only the first", () => {
    expect(matchContacts(all, "2552").map((c) => c.name)).toEqual(["Meena Akka"]); // AKKA
  });
  it("matches part of a saved mobile number once three digits are typed", () => {
    expect(matchContacts(all, "98765").map((c) => c.name)).toEqual(["Meena Akka"]);
    expect(matchContacts([meena], "98")).toEqual([]); // two digits is too few to guess a number
  });
  it("matches typed letters by plain text on name, username or number", () => {
    expect(matchContacts(all, "ann").map((c) => c.name)).toEqual(["Ravi anna"]);
    expect(matchContacts(all, "MEEN")).toEqual([meena]);
  });
  it("puts favourites and the most-called people first", () => {
    const a = person({ id: 4, name: "Asha", username: "asha", target: "asha", call_count: 1 });
    const b = person({ id: 5, name: "Anil", username: "anil", target: "anil", call_count: 9 });
    const c = person({ id: 6, name: "Amar", username: "amar", target: "amar", favorite: true });
    expect(matchContacts([a, b, c], "2").map((x) => x.name)).toEqual(["Amar", "Anil", "Asha"]);
  });
  it("returns nothing for an empty entry and respects the limit", () => {
    expect(matchContacts(all, "  ")).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => person({ id: i, name: `Ana ${i}`, username: `ana${i}`, target: `ana${i}` }));
    expect(matchContacts(many, "262", 3)).toHaveLength(3);
  });
});

describe("avatar helpers", () => {
  it("gives the same colour to the same person", () => {
    expect(avatarColor("ravi")).toBe(avatarColor("ravi"));
  });
  it("uses the first letter, including non-Latin scripts", () => {
    expect(initialOf("ravi")).toBe("R");
    expect(initialOf("  தமிழ்")).toBe("த");
    expect(initialOf("")).toBe("?");
  });
});
