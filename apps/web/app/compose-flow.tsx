"use client";

import { useMemo, useState, useTransition } from "react";
import { WizardCard, FieldLabel } from "./components/card";
import { Stepper, type Step } from "./components/stepper";

type Rep = {
  id: string;
  fullName: string;
  honorific: string | null;
  party: string | null;
  chamberKind: "lower" | "upper" | "unicameral";
  jurisdictionCode: string;
  electorateName: string | null;
  stateCode: string | null;
  primaryEmail: string | null;
  contactFormUrl: string | null;
  photoUrl: string | null;
};

type LookupResp = {
  point: { lat: number; lng: number };
  matched?: string;
  electorates: Array<{ chamberKind: string; name: string }>;
  stateCode: string | null;
  reps: Rep[];
};

type SendResp = {
  messageId: string;
  recipients: Array<{
    repId: string;
    repName: string;
    channel: "email" | "form";
    status: "sent" | "failed";
    error?: string;
  }>;
};

export function ComposeFlow() {
  const [step, setStep] = useState<Step>("address");

  // Step 1
  const [street, setStreet] = useState("");
  const [suburb, setSuburb] = useState("");
  const [postcode, setPostcode] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResp | null>(null);
  const [lookingUp, startLookup] = useTransition();

  // Step 2
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Step 3
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResp | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const fullAddress = useMemo(() => {
    return [street, suburb, postcode].filter(Boolean).join(", ");
  }, [street, suburb, postcode]);

  function onSubmitAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!street || !suburb || !/^\d{4}$/.test(postcode)) {
      setLookupError("Please enter street, suburb, and a 4-digit postcode.");
      return;
    }
    setLookupError(null);
    setResult(null);
    startLookup(async () => {
      const res = await fetch(
        `/api/lookup?address=${encodeURIComponent(fullAddress)}`,
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string; detail?: string }
          | null;
        setLookupError(j?.detail ?? j?.error ?? `Lookup failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as LookupResp;
      setResult(data);
      // Default-select: lower house + federal senate. State-wide upper houses
      // (NSW LC, WA LC, SA LC) are shown but unchecked — sending to all 42
      // NSW LC members by default would feel like spam.
      setSelected(
        new Set(
          data.reps
            .filter(
              (r) =>
                r.chamberKind === "lower" ||
                r.chamberKind === "unicameral" ||
                (r.chamberKind === "upper" && r.jurisdictionCode === "federal"),
            )
            .map((r) => r.id),
        ),
      );
      setStep("reps");
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSend() {
    if (!result) return;
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject,
          body,
          userEmail,
          userName,
          userPostalAddress: result.matched ?? fullAddress,
          userPostcode: postcode,
          userLat: result.point.lat,
          userLng: result.point.lng,
          repIds: result.reps
            .filter((r) => selected.has(r.id))
            .map((r) => r.id),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setSendError(j?.error ?? `Send failed (${res.status})`);
      } else {
        setSendResult((await res.json()) as SendResp);
      }
    } finally {
      setSending(false);
    }
  }

  const canMessage = selected.size > 0;
  const canSend =
    canMessage &&
    subject.trim().length >= 3 &&
    body.trim().length >= 20 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(userEmail) &&
    userName.trim().length >= 2 &&
    !sending;

  // Group reps by jurisdiction + chamber for the picker. Federal lower first,
  // then federal upper, then any state-level rows we returned.
  const groupedReps: Array<{ label: string; reps: Rep[] }> = useMemo(() => {
    if (!result) return [];
    const groups = new Map<string, Rep[]>();
    for (const r of result.reps) {
      const key =
        r.jurisdictionCode === "federal"
          ? `Federal — ${r.chamberKind === "lower" ? "House of Representatives" : "Senate"}`
          : `${r.jurisdictionCode.toUpperCase()} — ${
              r.chamberKind === "lower"
                ? "Lower House"
                : r.chamberKind === "upper"
                  ? "Upper House"
                  : "Assembly"
            }`;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    return Array.from(groups, ([label, reps]) => ({ label, reps }));
  }, [result]);

  return (
    <div className="space-y-12">
      <Stepper
        current={step}
        onJump={(s) => {
          if (s === "address") setStep("address");
          if (s === "reps" && result) setStep("reps");
        }}
      />

      {step === "address" && (
        <WizardCard>
          <form onSubmit={onSubmitAddress} className="space-y-5">
            <div className="space-y-1.5">
              <FieldLabel>Street address</FieldLabel>
              <input
                type="text"
                autoComplete="street-address"
                className="block w-full border-b border-neutral-300 bg-transparent py-2 text-base focus:border-neutral-900 focus:outline-none"
                placeholder="1 Parliament Drive"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel>Suburb / City</FieldLabel>
                <input
                  type="text"
                  autoComplete="address-level2"
                  className="block w-full border-b border-neutral-300 bg-transparent py-2 text-base focus:border-neutral-900 focus:outline-none"
                  placeholder="Canberra"
                  value={suburb}
                  onChange={(e) => setSuburb(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Postcode</FieldLabel>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoComplete="postal-code"
                  className="block w-full border-b border-neutral-300 bg-transparent py-2 text-base focus:border-neutral-900 focus:outline-none"
                  placeholder="2600"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
            </div>
            {lookupError && (
              <p className="text-sm text-red-600">{lookupError}</p>
            )}
            <div className="flex items-center justify-end pt-2">
              <button
                type="submit"
                disabled={lookingUp}
                className="brand-bar inline-flex items-center rounded-full px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-white shadow-sm hover:opacity-95 disabled:opacity-60"
              >
                {lookingUp ? "Looking up…" : "Find my reps"}
              </button>
            </div>
          </form>
          <p className="mt-6 border-t border-neutral-100 pt-4 text-center text-xs text-neutral-500">
            Democracy.au uses OpenStreetMap Nominatim and Australian Electoral
            Commission boundary data to look up your representatives.
          </p>
        </WizardCard>
      )}

      {step === "reps" && result && (
        <WizardCard>
          <p className="text-sm text-neutral-600">
            You live in the federal electorate of{" "}
            <span className="font-semibold text-neutral-900">
              {result.electorates[0]?.name}
            </span>
            , in{" "}
            <span className="font-semibold text-neutral-900">
              {result.stateCode}
            </span>
            . Choose who should receive your message:
          </p>
          <div className="mt-6 space-y-6">
            {groupedReps.map((g) => (
              <div key={g.label} className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                  {g.label}
                </p>
                <div className="space-y-1">
                  {g.reps.map((r) => (
                    <RepRow
                      key={r.id}
                      rep={r}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep("address")}
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              ← Change address
            </button>
            <button
              type="button"
              disabled={!canMessage}
              onClick={() => setStep("message")}
              className="brand-bar inline-flex items-center rounded-full px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-white shadow-sm hover:opacity-95 disabled:opacity-50"
            >
              Continue ({selected.size})
            </button>
          </div>
        </WizardCard>
      )}

      {step === "message" && result && !sendResult && (
        <WizardCard>
          <div className="space-y-5">
            <div className="space-y-1.5">
              <FieldLabel>Subject</FieldLabel>
              <input
                type="text"
                className="block w-full border-b border-neutral-300 bg-transparent py-2 text-base focus:border-neutral-900 focus:outline-none"
                placeholder="A concise subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Message</FieldLabel>
              <textarea
                rows={9}
                className="block w-full border-b border-neutral-300 bg-transparent py-2 text-base focus:border-neutral-900 focus:outline-none"
                placeholder="Write your message. Short personal messages get the highest response rates."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel>Your name</FieldLabel>
                <input
                  type="text"
                  autoComplete="name"
                  className="block w-full border-b border-neutral-300 bg-transparent py-2 text-base focus:border-neutral-900 focus:outline-none"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Your email</FieldLabel>
                <input
                  type="email"
                  autoComplete="email"
                  className="block w-full border-b border-neutral-300 bg-transparent py-2 text-base focus:border-neutral-900 focus:outline-none"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                />
              </div>
            </div>
            {sendError && <p className="text-sm text-red-600">{sendError}</p>}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep("reps")}
                className="text-sm text-neutral-600 hover:text-neutral-900"
              >
                ← Back to representatives
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                className="brand-bar inline-flex items-center rounded-full px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-white shadow-sm hover:opacity-95 disabled:opacity-50"
              >
                {sending
                  ? "Sending…"
                  : `Send to ${selected.size} recipient${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </WizardCard>
      )}

      {sendResult && (
        <WizardCard>
          <div className="text-center">
            <p className="brand-text text-sm font-semibold uppercase tracking-[0.14em]">
              Message delivered
            </p>
            <h2 className="font-display mt-2 text-3xl">
              Sent to {sendResult.recipients.length}{" "}
              {sendResult.recipients.length === 1 ? "recipient" : "recipients"}
            </h2>
            <p className="mt-3 text-sm text-neutral-600">
              Thank you. They&apos;ve received your message via official email
              channels.
            </p>
          </div>
          <ul className="mt-8 divide-y divide-neutral-100">
            {sendResult.recipients.map((r) => (
              <li
                key={r.repId}
                className="flex items-center justify-between py-3"
              >
                <span className="text-sm">{r.repName}</span>
                <span className="text-xs uppercase tracking-wide text-neutral-500">
                  {r.channel} · {r.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-center font-mono text-[10px] text-neutral-400">
            #{sendResult.messageId}
          </p>
        </WizardCard>
      )}
    </div>
  );
}

function RepRow({
  rep,
  checked,
  onChange,
}: {
  rep: Rep;
  checked: boolean;
  onChange: () => void;
}) {
  const role =
    rep.chamberKind === "lower"
      ? `MP for ${rep.electorateName ?? "—"}`
      : `Senator for ${rep.stateCode ?? "—"}`;
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md px-2 py-3 hover:bg-neutral-50">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="size-4 accent-pink-500"
        />
        <div>
          <p className="font-medium">{rep.fullName}</p>
          <p className="text-xs text-neutral-500">
            {role} · {rep.party ?? "Independent"}
          </p>
        </div>
      </div>
      <span className="hidden font-mono text-xs text-neutral-400 md:inline">
        {rep.primaryEmail}
      </span>
    </label>
  );
}
