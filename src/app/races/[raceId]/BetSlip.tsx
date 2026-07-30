"use client";

import { useId, useState } from "react";
import { parsePoundsToPence } from "@/lib/money";

/**
 * The bet slip.
 *
 * The one client component in Phase 0, because placing a bet needs an
 * idempotency key generated per attempt and a refusal rendered without losing
 * what the user typed.
 *
 * The stake is parsed to integer PENCE in the browser and sent as an integer.
 * No float crosses the wire (.claude/rules/money.md).
 */

export interface SlipRunner {
  runnerId: string;
  clothNumber: number;
  horseName: string;
  startingPrice: string | null;
  status: string;
}

interface Props {
  raceId: string;
  runners: SlipRunner[];
  raceIsOpen: boolean;
  signedIn: boolean;
}

type Result =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "placed"; message: string }
  | { kind: "refused"; message: string };

export function BetSlip({ raceId, runners, raceIsOpen, signedIn }: Props) {
  const ids = {
    runner: useId(),
    type: useId(),
    stake: useId(),
    tolerance: useId(),
  };

  const priced = runners.filter((r) => r.status === "declared" && r.startingPrice);
  const [runnerId, setRunnerId] = useState(priced[0]?.runnerId ?? "");
  const [betType, setBetType] = useState("WIN");
  const [stake, setStake] = useState("10.00");
  const [tolerance, setTolerance] = useState("0.5");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  if (!signedIn) {
    return (
      <div className="panel">
        <h2>Place a bet</h2>
        <p>
          <a href="/login">Sign in</a> to place a bet. Registration gives you a
          virtual bankroll — no real money is involved anywhere in this product.
        </p>
      </div>
    );
  }

  if (!raceIsOpen) {
    return (
      <div className="panel">
        <h2>Place a bet</h2>
        <p>This race is not open for betting.</p>
      </div>
    );
  }

  if (priced.length === 0) {
    return (
      <div className="panel">
        <h2>Place a bet</h2>
        <p>No declared runner in this race has a price, so nothing can be backed.</p>
      </div>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const unitStakeMinor = parsePoundsToPence(stake);
    if (unitStakeMinor === null || unitStakeMinor <= 0n) {
      setResult({
        kind: "refused",
        message: "Enter a stake as pounds and pence, for example 10.00.",
      });
      return;
    }

    const runner = priced.find((r) => r.runnerId === runnerId);
    if (!runner?.startingPrice) {
      setResult({ kind: "refused", message: "Choose a runner with a price." });
      return;
    }

    setResult({ kind: "working" });
    const response = await fetch("/api/bets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // A fresh key per attempt: a retry of THIS submission is idempotent,
        // but deliberately placing the same bet twice is a different bet.
        idempotencyKey: crypto.randomUUID(),
        betType,
        unitStakeMinor: Number(unitStakeMinor),
        raceId,
        runnerId,
        oddsTaken: Number(runner.startingPrice),
        oddsTolerance: Number(tolerance),
      }),
    });

    const body = (await response.json()) as {
      error?: string;
      detail?: string;
      bet?: { id: string; totalStakeMinor: string };
    };

    if (!response.ok) {
      setResult({
        kind: "refused",
        message: body.detail ?? body.error ?? "The bet was not placed.",
      });
      return;
    }

    setResult({
      kind: "placed",
      message: `Bet placed on ${runner.horseName}. See it in My bets.`,
    });
  }

  return (
    <div className="panel">
      <h2>Place a bet</h2>

      {/* aria-live so the outcome is announced, not only shown. */}
      <div aria-live="polite">
        {result.kind === "refused" ? (
          <p className="error">{result.message}</p>
        ) : null}
        {result.kind === "placed" ? (
          <p className="notice">
            {result.message} <a href="/bets">My bets</a>
          </p>
        ) : null}
      </div>

      <form onSubmit={submit}>
        <label htmlFor={ids.runner}>Runner</label>
        <select
          id={ids.runner}
          value={runnerId}
          onChange={(e) => setRunnerId(e.target.value)}
        >
          {priced.map((r) => (
            <option key={r.runnerId} value={r.runnerId}>
              {r.clothNumber}. {r.horseName} — {r.startingPrice}
            </option>
          ))}
        </select>

        <label htmlFor={ids.type}>Bet type</label>
        <select id={ids.type} value={betType} onChange={(e) => setBetType(e.target.value)}>
          <option value="WIN">Win</option>
          <option value="PLACE">Place</option>
          <option value="EACH_WAY">Each-way (stakes twice)</option>
        </select>

        <label htmlFor={ids.stake}>
          Stake per part{" "}
          <span className="hint">
            in pounds. An each-way bet stakes this twice.
          </span>
        </label>
        <input
          id={ids.stake}
          type="text"
          inputMode="decimal"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
        />

        <label htmlFor={ids.tolerance}>
          Price tolerance{" "}
          <span className="hint">
            how far the price may shorten before the bet is refused. 0 refuses
            any movement against you.
          </span>
        </label>
        <input
          id={ids.tolerance}
          type="text"
          inputMode="decimal"
          value={tolerance}
          onChange={(e) => setTolerance(e.target.value)}
        />

        <button type="submit" disabled={result.kind === "working"}>
          {result.kind === "working" ? "Placing…" : "Place bet"}
        </button>
      </form>
    </div>
  );
}
