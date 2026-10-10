"use client";

import { useEffect, useState } from "react";
import { SettingsSelect } from "./SettingsSelect";
import { applyFont, DEFAULT_FONT, FONT_KEY, FONTS, parseFont, type FontId } from "@/app/lib/font";

/** Settings → Font size. Same dropdown as the other picks; `?font=` and a sibling tab keep it in sync. */
export function FontSelect() {
  const [id, setId] = useState<FontId>(DEFAULT_FONT);

  useEffect(() => {
    function sync() {
      setId(parseFont(document.documentElement.getAttribute("data-font")));
    }
    function onStorage(e: StorageEvent) {
      if (e.key && e.key !== FONT_KEY) {
        return;
      }
      const next = parseFont(e.newValue ?? localStorage.getItem(FONT_KEY));
      applyFont(next);
      setId(next);
    }
    sync();
    window.addEventListener("gantree-font", sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("gantree-font", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function pick(raw: string) {
    const next = parseFont(raw);
    setId(next);
    applyFont(next);
  }

  return <SettingsSelect label="Font size" value={id} options={FONTS} onChange={pick} />;
}
