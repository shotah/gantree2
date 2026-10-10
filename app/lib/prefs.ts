/** Browser prefs. Theme follow-flag lives with the rest of the chat keys. */

import type { AimRow } from "@/lib/chat/aims";
import type { TodoItem } from "@/lib/chat/todo";
import {
  AIMS_SEEN_KEY,
  aimKey,
  boardFingerprint,
  type BoardSeen,
  boardSeenPref,
  TODO_SEEN_KEY,
  todoKey,
  writeBoardSeenPref,
} from "@/lib/phone/boardSeen";
import type { LangId } from "@/lib/phone/lang";
import type { PhotoSizeId } from "@/lib/phone/photo";
import {
  backdropPrefOn,
  FOLLOW_THEME_PREF_KEY,
  followThemePrefOn,
  geoPrefOn,
  langPref,
  photoSizePref,
  voicePrefOn,
  writeBackdropPref,
  writeFollowThemePref,
  writeGeoPref,
  writeLangPref,
  writePhotoSizePref,
  writeVoicePref,
} from "@/lib/phone/prefs";

export { FOLLOW_THEME_PREF_KEY, followThemePrefOn, writeFollowThemePref };

export function browserGeoPref(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return geoPrefOn(window.localStorage);
}

export function saveGeoPref(on: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  writeGeoPref(window.localStorage, on);
}

export function browserPhotoSizePref(): PhotoSizeId {
  if (typeof window === "undefined") {
    return photoSizePref(null);
  }
  return photoSizePref(window.localStorage);
}

export function savePhotoSizePref(id: PhotoSizeId): void {
  if (typeof window === "undefined") {
    return;
  }
  writePhotoSizePref(window.localStorage, id);
}

export function browserBackdropPref(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return backdropPrefOn(window.localStorage);
}

export function saveBackdropPref(on: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  writeBackdropPref(window.localStorage, on);
}

export function browserFollowThemePref(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return followThemePrefOn(window.localStorage);
}

export function saveFollowThemePref(on: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  writeFollowThemePref(window.localStorage, on);
}

export function browserVoicePref(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return voicePrefOn(window.localStorage);
}

export function saveVoicePref(on: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  writeVoicePref(window.localStorage, on);
}

export function browserLangPref(): LangId {
  if (typeof window === "undefined") {
    return langPref(null);
  }
  return langPref(window.localStorage);
}

export function saveLangPref(id: LangId): void {
  if (typeof window === "undefined") {
    return;
  }
  writeLangPref(window.localStorage, id);
}

export function browserAimsSeen(): BoardSeen {
  if (typeof window === "undefined") {
    return {};
  }
  return boardSeenPref(window.localStorage, AIMS_SEEN_KEY);
}

/** Mark the goals board looked at. Returns the fingerprint either way so state can follow. */
export function saveAimsSeen(aims: AimRow[]): BoardSeen {
  if (typeof window === "undefined") {
    return boardFingerprint(aims, aimKey);
  }
  return writeBoardSeenPref(window.localStorage, AIMS_SEEN_KEY, aims, aimKey);
}

export function browserTodoSeen(): BoardSeen {
  if (typeof window === "undefined") {
    return {};
  }
  return boardSeenPref(window.localStorage, TODO_SEEN_KEY);
}

/** Mark the tasks board looked at. */
export function saveTodoSeen(todo: TodoItem[]): BoardSeen {
  if (typeof window === "undefined") {
    return boardFingerprint(todo, todoKey);
  }
  return writeBoardSeenPref(window.localStorage, TODO_SEEN_KEY, todo, todoKey);
}
