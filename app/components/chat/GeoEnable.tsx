"use client";

import { useState } from "react";
import { PermitRow } from "./PermitRow";
import { browserGeo } from "@/app/lib/geo";
import { useDevicePermission } from "@/app/lib/permit";
import { GEO_WARM_MS } from "@/lib/phone/geo";
import { blockedHint, type DevicePermission } from "@/lib/phone/permit";

/**
 * Settings row: OS location permission, then the same send-on-turns pref as
 * the attach-chip GPS toggle. Denied is Chrome/iOS settings, not this cog.
 */
export function GeoEnable({
  sending,
  onToggle,
}: {
  sending: boolean;
  onToggle: () => void;
}) {
  const queried = useDevicePermission("geolocation");
  const [asked, setAsked] = useState<DevicePermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [latchedOn, setLatchedOn] = useState(false);
  const permission = queried !== "prompt" ? queried : (asked ?? queried);
  const hint = blockedHint(permission);
  const send = sending || latchedOn;

  async function enable() {
    setBusy(true);
    const fix = await browserGeo(GEO_WARM_MS);
    setBusy(false);
    if (fix.ok) {
      setAsked("granted");
      if (!sending) {
        setLatchedOn(true);
        onToggle();
      }
      return;
    }
    setAsked(fix.reason === "denied" ? "denied" : permission);
  }

  if (permission === "denied" || permission === "unsupported") {
    return (
      <PermitRow
        name="Location"
        action={permission === "denied" ? "Blocked" : "Enable location"}
        hint={hint}
        disabled
      />
    );
  }
  if (permission === "granted") {
    return (
      <PermitRow
        name="Location"
        action={send ? "On" : "Off"}
        pressed={send}
        onClick={() => {
          setLatchedOn(false);
          onToggle();
        }}
      />
    );
  }
  return (
    <PermitRow
      name="Location"
      action="Enable location"
      disabled={busy}
      onClick={() => void enable()}
    />
  );
}
