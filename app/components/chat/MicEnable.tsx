"use client";

import { useState } from "react";
import { PermitRow } from "./PermitRow";
import { browserAskMic } from "@/app/lib/mic";
import { useDevicePermission } from "@/app/lib/permit";
import { blockedHint, micAskState, type DevicePermission } from "@/lib/phone/permit";

/**
 * Settings row: ask for the microphone so hold-to-talk is not a surprise
 * `not-allowed` on the bar. Tracks are stopped immediately; Web Speech is the ear.
 * A query of denied is not a stop — Chrome lies until getUserMedia runs, same
 * as Enable notifications still calls requestPermission.
 */
export function MicEnable() {
  const queried = useDevicePermission("microphone");
  const [asked, setAsked] = useState<DevicePermission | null>(null);
  const permission = micAskState(queried, asked);
  const hint = asked === "denied" || asked === "unsupported" ? blockedHint(permission) : "";

  async function enable() {
    const next = await browserAskMic();
    setAsked(next);
  }

  if (permission === "granted") {
    return <PermitRow name="Microphone" action="On" />;
  }
  if (permission === "unsupported") {
    return <PermitRow name="Microphone" action="Enable microphone" hint={hint} disabled />;
  }
  return (
    <PermitRow
      name="Microphone"
      action="Enable microphone"
      hint={hint}
      onClick={() => void enable()}
    />
  );
}
