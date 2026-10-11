/**
 * Arithmetic from harness/mcp/math. `^` is power. `17.5% of 240` and `50%`
 * rewrite before eval; `10 % 3` stays modulo because of the spaces.
 */

const NUM = String.raw`(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`;
const PERCENT_OF = new RegExp(`${NUM}\\s*%\\s*of\\s*`, "gi");
const PERCENT = new RegExp(`${NUM}%`, "g");

const PHI = (1 + Math.sqrt(5)) / 2;

type Bin = "+" | "-" | "*" | "/" | "%" | "**";

type Expr
  = | { kind: "num"; value: number }
    | { kind: "name"; name: string }
    | { kind: "unary"; op: "+" | "-"; expr: Expr }
    | { kind: "bin"; op: Bin; left: Expr; right: Expr }
    | { kind: "call"; name: string; args: Expr[] };

const UNARY = new Set([
  "abs", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan",
  "log", "log10", "log2", "exp", "floor", "ceil", "round", "trunc",
  "sinh", "cosh", "tanh", "deg", "rad",
]);

const BINARY = new Set(["pow", "atan2", "mod", "hypot", "min", "max"]);

export function normalizeExpr(expression: string): string {
  const trimmed = expression.trim();
  if (!trimmed) return "";
  let s = trimmed.replaceAll("^", "**");
  s = s.replace(PERCENT_OF, "(($1)/100)*");
  s = s.replace(PERCENT, "(($1)/100)");
  return s;
}

export function evaluate(expression: string): number {
  const code = normalizeExpr(expression);
  if (!code) throw new Error("expression is required");
  let expr: Expr;
  try {
    expr = parse(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : "syntax";
    throw new Error(`invalid expression: ${message}`, { cause: err });
  }
  const value = evalExpr(expr);
  if (!Number.isFinite(value)) throw new Error("result is not finite");
  return value;
}

/** Go `strconv.FormatFloat(f, 'g', 15, 64)`, with integers printed without a decimal. */
export function formatFloat(f: number): string {
  if (f === Math.trunc(f) && Math.abs(f) < 1e15) return String(Math.trunc(f));
  const precise = f.toPrecision(15);
  const expAt = precise.search(/e/i);
  if (expAt >= 0) {
    let mantissa = precise.slice(0, expAt);
    const exp = precise.slice(expAt);
    if (mantissa.includes(".")) mantissa = mantissa.replace(/0+$/, "").replace(/\.$/, "");
    return mantissa + exp;
  }
  return precise.includes(".") ? precise.replace(/0+$/, "").replace(/\.$/, "") : precise;
}

function roundHalfAway(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.sign(n) * Math.round(Math.abs(n));
}

function callFn(name: string, args: number[]): number {
  const a = args[0] ?? Number.NaN;
  const b = args[1] ?? Number.NaN;
  switch (name) {
    case "abs": return Math.abs(a);
    case "sqrt": return Math.sqrt(a);
    case "sin": return Math.sin(a);
    case "cos": return Math.cos(a);
    case "tan": return Math.tan(a);
    case "asin": return Math.asin(a);
    case "acos": return Math.acos(a);
    case "atan": return Math.atan(a);
    case "log": return Math.log(a);
    case "log10": return Math.log10(a);
    case "log2": return Math.log2(a);
    case "exp": return Math.exp(a);
    case "floor": return Math.floor(a);
    case "ceil": return Math.ceil(a);
    case "round": return roundHalfAway(a);
    case "trunc": return Math.trunc(a);
    case "sinh": return Math.sinh(a);
    case "cosh": return Math.cosh(a);
    case "tanh": return Math.tanh(a);
    case "deg": return a * 180 / Math.PI;
    case "rad": return a * Math.PI / 180;
    case "pow": return Math.pow(a, b);
    case "atan2": return Math.atan2(a, b);
    case "mod": return a % b;
    case "hypot": return Math.hypot(a, b);
    case "min": return Math.min(a, b);
    case "max": return Math.max(a, b);
    default: throw new Error(`unknown function ${name}`);
  }
}

function evalExpr(expr: Expr): number {
  switch (expr.kind) {
    case "num": return expr.value;
    case "name":
      if (expr.name === "pi") return Math.PI;
      if (expr.name === "e") return Math.E;
      if (expr.name === "phi") return PHI;
      throw new Error(`unknown name ${expr.name}`);
    case "unary": {
      const v = evalExpr(expr.expr);
      return expr.op === "-" ? -v : v;
    }
    case "bin": {
      const l = evalExpr(expr.left);
      const r = evalExpr(expr.right);
      switch (expr.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return l / r;
        case "%": return l % r;
        case "**": return l ** r;
      }
      return Number.NaN;
    }
    case "call":
      return callFn(expr.name, expr.args.map(evalExpr));
  }
}

type Tok
  = | { kind: "num"; value: number }
    | { kind: "id"; name: string }
    | { kind: "op"; op: string }
    | { kind: "lp" }
    | { kind: "rp" }
    | { kind: "comma" };

function tokenize(input: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i] ?? "";
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && (input[i + 1] ?? "") >= "0" && (input[i + 1] ?? "") <= "9")) {
      const m = /^(?:(?:\d+\.\d+|\d+|\.\d+)[eE][+-]?\d+|\d+\.\d+|\d+|\.\d+)/.exec(input.slice(i));
      if (!m) throw new Error("bad number");
      out.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i));
      if (!m) throw new Error("bad name");
      out.push({ kind: "id", name: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === "*" && input[i + 1] === "*") {
      out.push({ kind: "op", op: "**" });
      i += 2;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%") {
      out.push({ kind: "op", op: c });
      i += 1;
      continue;
    }
    if (c === "(") {
      out.push({ kind: "lp" });
      i += 1;
      continue;
    }
    if (c === ")") {
      out.push({ kind: "rp" });
      i += 1;
      continue;
    }
    if (c === ",") {
      out.push({ kind: "comma" });
      i += 1;
      continue;
    }
    throw new Error(`unexpected ${c}`);
  }
  return out;
}

function parse(input: string): Expr {
  const toks = tokenize(input);
  let i = 0;
  const peek = (): Tok | undefined => toks[i];
  const take = (): Tok => {
    const t = toks[i];
    if (!t) throw new Error("unexpected end");
    i += 1;
    return t;
  };

  const parseExpr = (min: number): Expr => {
    let left = parsePrefix();
    for (;;) {
      const t = peek();
      if (!t || t.kind !== "op") break;
      const prec = binPrec(t.op);
      if (prec < min) break;
      take();
      const nextMin = t.op === "**" ? prec : prec + 1;
      const right = parseExpr(nextMin);
      left = { kind: "bin", op: t.op as Bin, left, right };
    }
    return left;
  };

  const parsePrefix = (): Expr => {
    const t = take();
    if (t.kind === "num") return { kind: "num", value: t.value };
    if (t.kind === "op" && (t.op === "+" || t.op === "-")) {
      return { kind: "unary", op: t.op, expr: parseExpr(3) };
    }
    if (t.kind === "lp") {
      const inner = parseExpr(0);
      const close = take();
      if (close.kind !== "rp") throw new Error("expected )");
      return inner;
    }
    if (t.kind === "id") {
      if (peek()?.kind === "lp") {
        take();
        const args: Expr[] = [];
        if (peek()?.kind !== "rp") {
          for (;;) {
            args.push(parseExpr(0));
            if (peek()?.kind === "comma") {
              take();
              continue;
            }
            break;
          }
        }
        const close = take();
        if (close.kind !== "rp") throw new Error("expected )");
        const want = UNARY.has(t.name) ? 1 : BINARY.has(t.name) ? 2 : -1;
        if (want < 0 || args.length !== want) throw new Error(`bad call ${t.name}`);
        return { kind: "call", name: t.name, args };
      }
      return { kind: "name", name: t.name };
    }
    throw new Error("expected expression");
  };

  const expr = parseExpr(0);
  if (i !== toks.length) throw new Error("trailing input");
  return expr;
}

function binPrec(op: string): number {
  if (op === "**") return 4;
  if (op === "*" || op === "/" || op === "%") return 2;
  if (op === "+" || op === "-") return 1;
  return -1;
}
