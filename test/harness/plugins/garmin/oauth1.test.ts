import { describe, expect, it } from "vitest";
import { climbGradeDisplay, toListItem } from "@/harness/plugins/garmin/climb";
import { goJSON } from "@/harness/plugins/garmin/json";
import {
  buildAuthHeader,
  clearOAuthConsumerCache,
  encodeParams,
  fetchOAuthConsumer,
  generateSignature,
  percentEncode,
  randomNonce,
  signOAuth1,
} from "@/harness/plugins/garmin/oauth1";
import { jsonResponse, NOW, scripted } from "./harness";

describe("oauth1", () => {
  it("percent-encodes like RFC 3986", () => {
    const cases: [string, string][] = [
      ["abc", "abc"],
      ["ABC", "ABC"],
      ["123", "123"],
      ["abc-._~", "abc-._~"],
      ["hello world", "hello%20world"],
      ["a=b&c=d", "a%3Db%26c%3Dd"],
      ["100%", "100%25"],
      ["https://example.com/path", "https%3A%2F%2Fexample.com%2Fpath"],
    ];
    for (const [input, want] of cases) expect(percentEncode(input)).toBe(want);
  });

  it("sorts parameter pairs", () => {
    expect(encodeParams({
      a: ["1"],
      b: ["2"],
      oauth_consumer_key: ["key123"],
      oauth_nonce: ["nonce456"],
    })).toBe("a=1&b=2&oauth_consumer_key=key123&oauth_nonce=nonce456");
  });

  it("matches the OAuth 1.0 HMAC-SHA1 example", async () => {
    const signature = await generateSignature(
      "GET",
      "http://photos.example.net/photos",
      {
        file: ["vacation.jpg"],
        oauth_consumer_key: ["dpf43f3p2l4k3l03"],
        oauth_nonce: ["kllo9940pd9333jh"],
        oauth_signature_method: ["HMAC-SHA1"],
        oauth_timestamp: ["1191242096"],
        oauth_token: ["nnch734d00sl2jdk"],
        oauth_version: ["1.0"],
        size: ["original"],
      },
      "kd94hf93k423kf44",
      "pfkkdhi9sl3r4s00",
    );
    expect(signature).toBe("tR3+Ty81lMeYAr/Fid0kMTYa/WM=");
  });

  it("builds a sorted OAuth header", () => {
    const header = buildAuthHeader({
      oauth_consumer_key: "key123",
      oauth_signature: "sig%3D",
      oauth_signature_method: "HMAC-SHA1",
    });
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain(`oauth_consumer_key="key123"`);
    expect(header).toContain(`oauth_signature_method="HMAC-SHA1"`);
  });

  it("signs a request with the required oauth parameters", async () => {
    const header = await signOAuth1({
      consumerKey: "consumer-key",
      consumerSecret: "consumer-secret",
      method: "GET",
      nowMs: NOW,
      token: "token",
      tokenSecret: "token-secret",
      url: "https://api.example.com/resource?param=value",
    });
    expect(header.startsWith("OAuth ")).toBe(true);
    for (const param of ["oauth_consumer_key", "oauth_signature_method", "oauth_timestamp", "oauth_nonce", "oauth_version", "oauth_token", "oauth_signature"]) {
      expect(header).toContain(param);
    }
  });

  it("draws a 32-char nonce", () => {
    const a = randomNonce();
    const b = randomNonce();
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it("caches the oauth consumer document", async () => {
    clearOAuthConsumerCache();
    let hits = 0;
    const fetchFn = scripted(() => {
      hits += 1;
      return jsonResponse(200, JSON.stringify({ consumer_key: "k", consumer_secret: "s" }));
    });
    const first = await fetchOAuthConsumer(fetchFn);
    const second = await fetchOAuthConsumer(fetchFn);
    expect(first).toEqual({ key: "k", secret: "s" });
    expect(second).toEqual(first);
    expect(hits).toBe(1);
    clearOAuthConsumerCache();
    await expect(fetchOAuthConsumer(scripted(() => {
      throw new Error("dial");
    }))).rejects.toThrow(/dial/);
  });
});

describe("climb grades", () => {
  it("displays VERMIN, YDS, and FONT grades", () => {
    expect(climbGradeDisplay({ scale: "VERMIN", valueKey: "V3" })).toBe("V3");
    expect(climbGradeDisplay({ scale: "YDS", valueKey: "_5_11D" })).toBe("5.11d");
    expect(climbGradeDisplay({ scale: "FONT", valueKey: "_4" })).toBe("Font 4");
    expect(climbGradeDisplay({ scale: "OTHER", valueKey: "X" })).toBe("OTHER:X");
    expect(climbGradeDisplay({ valueKey: "V2" })).toBe("V2");
    expect(climbGradeDisplay({ scale: "VERMIN" })).toBe("");
    expect(climbGradeDisplay(null)).toBe("");
  });

  it("copies the first CLIMB_ACTIVE split onto the list item", () => {
    const item = toListItem({
      activityId: 1,
      activityName: "Indoor Climbing",
      activityType: { typeKey: "indoor_climbing" },
      splitSummaries: [{
        maxGradeValue: { scale: "YDS", valueKey: "_5_11D" },
        numClimbSends: 2,
        numClimbsCompleted: 5,
        numFalls: 6,
        splitType: "CLIMB_ACTIVE",
      }],
    });
    expect(item.numFalls).toBe(6);
    expect(item.numClimbSends).toBe(2);
    expect(item.numClimbsCompleted).toBe(5);
    expect(item.maxClimbGrade).toBe("5.11d");
    expect(item.activityType).toBe("indoor_climbing");
    expect(goJSON([item])).toContain(`"maxClimbGrade": "5.11d"`);
  });
});

describe("goJSON", () => {
  it("indents and escapes HTML the way encoding/json does", () => {
    expect(goJSON({ a: "x&y<z>" })).toBe(`{\n  "a": "x\\u0026y\\u003cz\\u003e"\n}`);
  });
});
