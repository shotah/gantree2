"use client";

import { useEffect, useState } from "react";
import { PermitRow } from "./PermitRow";
import { isIos, isStandalone } from "@/app/lib/install";
import { browserAskNotify, browserShowNotify, notifyPermission } from "@/app/lib/notify";
import {
  NOTIFY_TEST,
  notifyAskState,
  notifyHint,
  notifyNeedHomeScreen,
  type NotifyPermission,
} from "@/lib/phone/notify";
import {
  PushRegister,
  pushRegisterHint,
  PushTestFail,
  pushTestHint,
  type PushRegisterResult,
  type PushTestResult,
} from "@/lib/phone/pushState";

export function NotifyEnable({
  onGranted,
  onTest,
}: {
  /** Register this browser for lock-screen push once the OS says yes. */
  onGranted?: () => PushRegisterResult | Promise<PushRegisterResult>;
  /** Ask the Worker for a real push. Without it, Test is a local toast only. */
  onTest?: () => PushTestResult | Promise<PushTestResult>;
}) {
  const [permission, setPermission] = useState<NotifyPermission>("default");
  const [asked, setAsked] = useState(false);
  const [needHome, setNeedHome] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    function sync() {
      setPermission(notifyPermission());
      setNeedHome(notifyNeedHomeScreen(isIos(navigator), isStandalone(window, navigator)));
    }
    sync();
    const perms = navigator.permissions;
    if (!perms || typeof perms.query !== "function") {
      return;
    }
    let statusHandle: PermissionStatus | undefined;
    let dead = false;
    void perms.query({ name: "notifications" })
      .then((next) => {
        if (dead) {
          return;
        }
        statusHandle = next;
        next.onchange = () => {
          sync();
        };
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      if (statusHandle) {
        statusHandle.onchange = null;
      }
    };
  }, []);

  const view = notifyAskState(permission, asked);
  const granted = view === "granted";
  const blocked = needHome || view === "unsupported";
  const hint = status || notifyHint({ permission: view, needHomeScreen: needHome });

  async function enable() {
    setStatus("");
    setAsked(true);
    const next = await browserAskNotify();
    setPermission(next);
    if (next !== "granted") {
      return;
    }
    const registered: PushRegisterResult = onGranted ? await onGranted() : PushRegister.Ok;
    const ok = await browserShowNotify(NOTIFY_TEST);
    if (registered !== PushRegister.Ok) {
      setStatus(`Granted, but lock-screen push did not register. ${pushRegisterHint(registered)}`.trim());
      return;
    }
    setStatus(ok ? "Sent a test ping." : "Granted, but the toast did not appear.");
  }

  async function test() {
    // The real thing when the Worker can: a card through the push service, shown even with the app open.
    const pushed: PushTestResult | undefined = onTest ? await onTest() : undefined;
    if (pushed && pushed !== PushTestFail.NoVapid) {
      setStatus(pushTestHint(pushed));
      return;
    }
    const ok = await browserShowNotify(NOTIFY_TEST);
    if (pushed === PushTestFail.NoVapid) {
      setStatus(pushTestHint(pushed));
      return;
    }
    setStatus(ok ? "Sent a test ping." : "The toast did not appear.");
  }

  if (granted) {
    return (
      <PermitRow
        name="Notifications"
        action="Test"
        hint={hint}
        onClick={() => void test()}
      />
    );
  }
  return (
    <PermitRow
      name="Notifications"
      action="Enable notifications"
      hint={hint}
      disabled={blocked}
      onClick={() => void enable()}
    />
  );
}
