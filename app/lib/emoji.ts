/** Colon shortcodes and classic emoticons for the compose box. */

export type EmojiEntry = {
  emoji: string;
  name: string;
  aliases: readonly string[];
};

type Row = readonly [string, string, string?];

const ROWS: readonly Row[] = [
  ["😀", "grinning", "D"],
  ["😃", "smiley"],
  ["😄", "smile"],
  ["😁", "grin"],
  ["😆", "laughing", "xd"],
  ["😅", "sweat_smile"],
  ["🤣", "rofl"],
  ["😂", "joy"],
  ["🙂", "slightly_smiling"],
  ["😊", "blush"],
  ["😇", "innocent"],
  ["😉", "wink"],
  ["😍", "heart_eyes"],
  ["😘", "kissing_heart", "kiss"],
  ["😋", "yum"],
  ["😛", "stuck_out_tongue", "P"],
  ["😜", "stuck_out_tongue_winking_eye"],
  ["🤪", "zany"],
  ["😎", "sunglasses"],
  ["🤓", "nerd"],
  ["🧐", "monocle"],
  ["🤔", "thinking"],
  ["🤨", "raised_eyebrow"],
  ["😐", "neutral"],
  ["😑", "expressionless"],
  ["🙄", "rolling_eyes"],
  ["😏", "smirk"],
  ["😒", "unamused"],
  ["😞", "disappointed"],
  ["😔", "pensive"],
  ["😕", "confused"],
  ["🙁", "slightly_frowning"],
  ["☹️", "frowning"],
  ["😣", "persevere"],
  ["😖", "confounded"],
  ["😫", "tired"],
  ["😩", "weary"],
  ["🥺", "pleading"],
  ["😢", "cry"],
  ["😭", "sob"],
  ["😤", "triumph"],
  ["😠", "angry"],
  ["😡", "rage"],
  ["🤬", "cursing"],
  ["😳", "flushed"],
  ["🥵", "hot"],
  ["🥶", "cold"],
  ["😱", "scream"],
  ["😨", "fearful"],
  ["😰", "cold_sweat"],
  ["😥", "disappointed_relieved"],
  ["😓", "sweat"],
  ["🤗", "hugging"],
  ["🤭", "hand_over_mouth"],
  ["🤫", "shushing"],
  ["🤥", "lying"],
  ["😶", "no_mouth"],
  ["🫠", "melting"],
  ["😴", "sleeping", "zzz"],
  ["🥱", "yawn"],
  ["😷", "mask"],
  ["🤒", "thermometer"],
  ["🤕", "head_bandage"],
  ["🤢", "nauseated"],
  ["🤮", "vomiting"],
  ["🤧", "sneezing"],
  ["🥳", "partying"],
  ["🥸", "disguised"],
  ["🤡", "clown"],
  ["👻", "ghost"],
  ["💀", "skull"],
  ["👽", "alien"],
  ["🤖", "robot"],
  ["💩", "poop", "hankey,shit"],
  ["🙈", "see_no_evil"],
  ["🙉", "hear_no_evil"],
  ["🙊", "speak_no_evil"],
  ["👋", "wave"],
  ["🤚", "raised_back_of_hand"],
  ["🖐️", "hand"],
  ["✋", "raised_hand"],
  ["🖖", "vulcan"],
  ["👌", "ok_hand", "ok"],
  ["🤌", "pinched_fingers"],
  ["🤏", "pinching_hand"],
  ["✌️", "v", "victory"],
  ["🤞", "crossed_fingers"],
  ["🫰", "hand_with_index_finger_and_thumb_crossed"],
  ["🤟", "love_you_gesture"],
  ["🤘", "metal"],
  ["🤙", "call_me"],
  ["👈", "point_left"],
  ["👉", "point_right"],
  ["👆", "point_up"],
  ["👇", "point_down"],
  ["☝️", "point_up_2"],
  ["👍", "thumbsup", "+1,thumbs_up"],
  ["👎", "thumbsdown", "-1,thumbs_down"],
  ["✊", "fist"],
  ["👊", "punch"],
  ["🤛", "left_facing_fist"],
  ["🤜", "right_facing_fist"],
  ["👏", "clap"],
  ["🙌", "raised_hands"],
  ["🫶", "heart_hands"],
  ["👐", "open_hands"],
  ["🤲", "palms_up"],
  ["🤝", "handshake"],
  ["🙏", "pray", "thanks"],
  ["✍️", "writing"],
  ["💅", "nail_care"],
  ["🤳", "selfie"],
  ["💪", "muscle"],
  ["🦾", "mechanical_arm"],
  ["🦵", "leg"],
  ["🦶", "foot"],
  ["👂", "ear"],
  ["👃", "nose"],
  ["👀", "eyes"],
  ["👁️", "eye"],
  ["👅", "tongue"],
  ["👄", "lips"],
  ["🧠", "brain"],
  ["🫀", "anatomical_heart"],
  ["🦴", "bone"],
  ["🤷", "shrug", "person_shrugging"],
  ["🤦", "facepalm", "person_facepalming"],
  ["❤️", "heart"],
  ["🧡", "orange_heart"],
  ["💛", "yellow_heart"],
  ["💚", "green_heart"],
  ["💙", "blue_heart"],
  ["💜", "purple_heart"],
  ["🖤", "black_heart"],
  ["🤍", "white_heart"],
  ["💔", "broken_heart"],
  ["❣️", "heart_exclamation"],
  ["💕", "two_hearts"],
  ["💖", "sparkling_heart"],
  ["💗", "heartpulse"],
  ["💘", "cupid"],
  ["💝", "gift_heart"],
  ["💞", "revolving_hearts"],
  ["💟", "heart_decoration"],
  ["✨", "sparkles"],
  ["⭐", "star"],
  ["🌟", "star2"],
  ["💫", "dizzy"],
  ["🔥", "fire"],
  ["💯", "100"],
  ["💥", "boom", "collision"],
  ["💢", "anger"],
  ["💦", "sweat_drops"],
  ["💨", "dash"],
  ["🕳️", "hole"],
  ["💬", "speech", "speech_balloon"],
  ["👁️‍🗨️", "eye_speech"],
  ["💭", "thought", "thought_balloon"],
  ["💤", "zzz_symbol"],
  ["🎉", "tada", "party"],
  ["🎊", "confetti"],
  ["🎈", "balloon"],
  ["🎁", "gift"],
  ["🏆", "trophy"],
  ["🥇", "first_place", "medal"],
  ["🥈", "second_place"],
  ["🥉", "third_place"],
  ["✅", "white_check_mark", "check"],
  ["❌", "x", "cross"],
  ["⚠️", "warning"],
  ["❓", "question"],
  ["❗", "exclamation"],
  ["💡", "bulb"],
  ["📌", "pushpin", "pin"],
  ["📍", "round_pushpin"],
  ["📝", "memo"],
  ["🔔", "bell"],
  ["🔑", "key"],
  ["🔒", "lock"],
  ["🔓", "unlock"],
  ["🔗", "link"],
  ["📎", "paperclip"],
  ["📷", "camera"],
  ["📸", "camera_flash"],
  ["💻", "computer"],
  ["📱", "phone", "iphone"],
  ["📧", "email", "mail"],
  ["📚", "books", "book"],
  ["✏️", "pencil"],
  ["✂️", "scissors"],
  ["🔨", "hammer"],
  ["🔧", "wrench"],
  ["🗑️", "trash"],
  ["🚀", "rocket"],
  ["🚗", "car"],
  ["✈️", "airplane"],
  ["🏠", "house"],
  ["🌍", "earth", "globe"],
  ["☀️", "sunny", "sun"],
  ["🌙", "moon"],
  ["☁️", "cloud"],
  ["🌈", "rainbow"],
  ["❄️", "snowflake"],
  ["💧", "droplet"],
  ["⚡", "zap"],
  ["☕", "coffee"],
  ["🍺", "beer"],
  ["🍕", "pizza"],
  ["🍔", "hamburger", "burger"],
  ["🍟", "fries"],
  ["🌮", "taco"],
  ["🍣", "sushi"],
  ["🍪", "cookie"],
  ["🎂", "birthday", "cake"],
  ["🍰", "cake_slice"],
  ["🍎", "apple"],
  ["🌹", "rose"],
  ["🌻", "sunflower"],
  ["🌵", "cactus"],
  ["🌳", "tree"],
  ["🐶", "dog"],
  ["🐱", "cat"],
  ["🦊", "fox"],
  ["🐻", "bear"],
  ["🐼", "panda"],
  ["🦄", "unicorn"],
  ["🐝", "bee"],
  ["🐢", "turtle"],
  ["🐙", "octopus"],
  ["🦋", "butterfly"],
  ["🐞", "bug"],
];

function aliasesOf(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
}

export const emojiCatalog: readonly EmojiEntry[] = ROWS.map(([emoji, name, aliases]) => ({
  emoji,
  name,
  aliases: aliasesOf(aliases),
}));

const byName = new Map<string, string>();
for (const entry of emojiCatalog) {
  byName.set(normName(entry.name), entry.emoji);
  for (const alias of entry.aliases) {
    byName.set(normName(alias), entry.emoji);
  }
}

function normName(name: string): string {
  return name.toLowerCase().replace(/-/g, "_");
}

export function emojiForShortcode(name: string): string | undefined {
  return byName.get(normName(name));
}

const DEFAULT_PICK = [
  "grinning",
  "smile",
  "joy",
  "blush",
  "wink",
  "heart_eyes",
  "thinking",
  "sunglasses",
  "cry",
  "sob",
  "rage",
  "scream",
  "partying",
  "shrug",
  "facepalm",
  "thumbsup",
  "thumbsdown",
  "ok_hand",
  "clap",
  "pray",
  "wave",
  "muscle",
  "heart",
  "fire",
  "100",
  "tada",
  "sparkles",
  "star",
  "white_check_mark",
  "x",
  "warning",
  "eyes",
  "poop",
  "skull",
  "ghost",
  "robot",
  "dog",
  "cat",
  "rocket",
  "coffee",
  "pizza",
  "sunny",
  "moon",
  "zap",
] as const;

export function searchEmoji(query: string): readonly EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/:/g, "");
  if (!q) {
    return DEFAULT_PICK.flatMap((name) => {
      const entry = emojiCatalog.find((item) => item.name === name);
      return entry ? [entry] : [];
    });
  }
  return emojiCatalog.filter((entry) =>
    entry.name.includes(q)
    || entry.aliases.some((alias) => alias.includes(q))
    || entry.emoji === query.trim(),
  );
}

type Span = { start: number; end: number; value: string };

const SHORTCODE = /:([a-z0-9_+-]{1,32}):/gi;

/** Letter emoticons wait for a break so `:dog:` can still be typed. */
const EMOTICONS: readonly { token: string; emoji: string; hold: boolean }[] = [
  { token: ":'(", emoji: "😢", hold: false },
  { token: ":-D", emoji: "😀", hold: true },
  { token: ":-P", emoji: "😛", hold: true },
  { token: ":-O", emoji: "😮", hold: true },
  { token: ":-)", emoji: "😊", hold: false },
  { token: ":-(", emoji: "🙁", hold: false },
  { token: ";-)", emoji: "😉", hold: false },
  { token: ":D", emoji: "😀", hold: true },
  { token: ":P", emoji: "😛", hold: true },
  { token: ":O", emoji: "😮", hold: true },
  { token: ":)", emoji: "😊", hold: false },
  { token: ":(", emoji: "🙁", hold: false },
  { token: ";)", emoji: "😉", hold: false },
  { token: ":/", emoji: "😕", hold: false },
  { token: ":|", emoji: "😐", hold: false },
  { token: "xD", emoji: "😆", hold: true },
];

function isBreakBefore(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  return /[\s(]/.test(text[index - 1] ?? "");
}

function isTerminator(ch: string | undefined, hold: boolean, trailing: boolean): boolean {
  if (ch == null) {
    return trailing || !hold;
  }
  if (/[\s.,!?;)]/.test(ch)) {
    return true;
  }
  return false;
}

function shortcodeSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(SHORTCODE)) {
    const name = match[1];
    const emoji = name ? emojiForShortcode(name) : undefined;
    if (!emoji || match.index == null) {
      continue;
    }
    spans.push({ start: match.index, end: match.index + match[0].length, value: emoji });
  }
  return spans;
}

function overlaps(spans: readonly Span[], start: number, end: number): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

function emoticonSpans(text: string, trailing: boolean, blocked: readonly Span[]): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < text.length) {
    if (!isBreakBefore(text, i) || overlaps(blocked, i, i + 1)) {
      i += 1;
      continue;
    }
    let hit: Span | null = null;
    for (const item of EMOTICONS) {
      const slice = text.slice(i, i + item.token.length);
      if (slice.toLowerCase() !== item.token.toLowerCase()) {
        continue;
      }
      const end = i + item.token.length;
      if (overlaps(blocked, i, end)) {
        continue;
      }
      if (!isTerminator(text[end], item.hold, trailing)) {
        continue;
      }
      hit = { start: i, end, value: item.emoji };
      break;
    }
    if (hit) {
      spans.push(hit);
      i = hit.end;
      continue;
    }
    i += 1;
  }
  return spans;
}

function applySpans(text: string, cursor: number, spans: readonly Span[]): { text: string; cursor: number } {
  if (!spans.length) {
    return { text, cursor };
  }
  let out = "";
  let nextCursor = cursor;
  let last = 0;
  let parked = false;
  for (const span of spans) {
    out += text.slice(last, span.start);
    const at = out.length;
    out += span.value;
    if (!parked) {
      if (cursor >= span.end) {
        nextCursor += span.value.length - (span.end - span.start);
      } else if (cursor > span.start) {
        nextCursor = at + span.value.length;
        parked = true;
      }
    }
    last = span.end;
  }
  out += text.slice(last);
  return { text: out, cursor: Math.max(0, Math.min(nextCursor, out.length)) };
}

export function applyEmoji(text: string, cursor: number, when: "type" | "send"): { text: string; cursor: number } {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const codes = shortcodeSpans(text);
  const faces = emoticonSpans(text, when === "send", codes);
  const spans = [...codes, ...faces].sort((a, b) => a.start - b.start);
  return applySpans(text, safeCursor, spans);
}
