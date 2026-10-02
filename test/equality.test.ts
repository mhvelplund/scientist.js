import { describe, expect, it } from "vitest";
import { defaultEquals } from "../src/index";

const eq = (a: unknown, b: unknown) => defaultEquals(a, b);

describe("defaultEquals", () => {
  it("compares primitives with ===", () => {
    expect(eq(1, 1)).toBe(true);
    expect(eq(1, 2)).toBe(false);
    expect(eq("a", "a")).toBe(true);
    expect(eq("1", 1)).toBe(false);
    expect(eq(true, true)).toBe(true);
    expect(eq(true, 1)).toBe(false);
    expect(eq(null, null)).toBe(true);
    expect(eq(undefined, undefined)).toBe(true);
    expect(eq(null, undefined)).toBe(false);
    expect(eq(10n, 10n)).toBe(true);
    expect(eq(10n, 10)).toBe(false);
    const sym = Symbol("s");
    expect(eq(sym, sym)).toBe(true);
    expect(eq(Symbol("s"), Symbol("s"))).toBe(false);
  });

  it("treats NaN as not equal to itself, like Ruby", () => {
    expect(eq(Number.NaN, Number.NaN)).toBe(false);
  });

  it("treats 0 and -0 as equal, like Ruby's 0.0 == -0.0", () => {
    expect(eq(0, -0)).toBe(true);
    expect(eq([0], [-0])).toBe(true);
  });

  it("does not equate null with an object", () => {
    expect(eq(null, {})).toBe(false);
    expect(eq({}, null)).toBe(false);
  });

  it("compares arrays deeply", () => {
    expect(eq([], [])).toBe(true);
    expect(eq([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(eq([1, 2, 3], [1, 2])).toBe(false);
    expect(eq([1, 2], [2, 1])).toBe(false);
    expect(eq([[1, [2]], 3], [[1, [2]], 3])).toBe(true);
    expect(eq([[1, [2]], 3], [[1, [3]], 3])).toBe(false);
    expect(eq([1], { 0: 1, length: 1 })).toBe(false);
  });

  it("compares nested plain objects deeply", () => {
    expect(eq({}, {})).toBe(true);
    expect(eq({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(eq({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } })).toBe(false);
    expect(eq({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(eq({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(eq({ a: undefined }, { b: undefined })).toBe(false);
  });

  it("compares null-prototype objects structurally", () => {
    const a = Object.assign(Object.create(null), { x: 1 });
    const b = Object.assign(Object.create(null), { x: 1 });
    expect(eq(a, b)).toBe(true);
    expect(eq(a, { x: 1 })).toBe(false);
  });

  it("compares Maps by key identity and deep values", () => {
    expect(eq(new Map(), new Map())).toBe(true);
    expect(
      eq(
        new Map<string, unknown>([
          ["a", [1]],
          ["b", { c: 2 }],
        ]),
        new Map<string, unknown>([
          ["b", { c: 2 }],
          ["a", [1]],
        ]),
      ),
    ).toBe(true);
    expect(eq(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
    expect(eq(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(false);
    expect(
      eq(
        new Map([["a", 1]]),
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      ),
    ).toBe(false);
    const key = {};
    expect(eq(new Map([[key, 1]]), new Map([[key, 1]]))).toBe(true);
    expect(eq(new Map([[{}, 1]]), new Map([[{}, 1]]))).toBe(false);
  });

  it("compares Sets, including object members", () => {
    expect(eq(new Set(), new Set())).toBe(true);
    expect(eq(new Set([1, 2, 3]), new Set([3, 2, 1]))).toBe(true);
    expect(eq(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(eq(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false);
    expect(eq(new Set([{ a: 1 }, [2]]), new Set([[2], { a: 1 }]))).toBe(true);
    expect(eq(new Set([{ a: 1 }]), new Set([{ a: 2 }]))).toBe(false);
  });

  // Object members are matched one-to-one, so equality is symmetric like Ruby's Set#==.
  it("compares Sets with duplicate-looking object members symmetrically", () => {
    const a = new Set([[1], [1]]);
    const b = new Set([[1], [2]]);
    expect(eq(b, a)).toBe(false);
    expect(eq(a, b)).toBe(false);
  });

  it("compares Dates by time", () => {
    expect(eq(new Date(1000), new Date(1000))).toBe(true);
    expect(eq(new Date(1000), new Date(2000))).toBe(false);
    expect(eq(new Date(1000), 1000)).toBe(false);
  });

  it("compares RegExps by source and flags", () => {
    expect(eq(/ab+c/gi, /ab+c/gi)).toBe(true);
    expect(eq(/ab+c/g, /ab+c/i)).toBe(false);
    expect(eq(/ab+c/, /ab*c/)).toBe(false);
  });

  it("compares typed arrays element-wise, by type", () => {
    expect(eq(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(eq(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(eq(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(eq(new Uint8Array([1, 2]), new Int8Array([1, 2]))).toBe(false);
    expect(eq(new Uint8Array([1, 2]), [1, 2])).toBe(false);
    expect(eq(new Float64Array([0.5]), new Float64Array([0.5]))).toBe(true);
  });

  it("compares class instances by identity", () => {
    class Point {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    }
    const p = new Point(1, 2);
    expect(eq(p, p)).toBe(true);
    expect(eq(new Point(1, 2), new Point(1, 2))).toBe(false);
    expect(eq(new Point(1, 2), { x: 1, y: 2 })).toBe(false);
    expect(eq([p], [p])).toBe(true);
  });

  it("uses an equals() method when present", () => {
    class Money {
      constructor(readonly cents: number) {}
      equals(other: unknown): boolean {
        return other instanceof Money && other.cents === this.cents;
      }
    }
    expect(eq(new Money(100), new Money(100))).toBe(true);
    expect(eq(new Money(100), new Money(200))).toBe(false);
    expect(eq({ m: [new Money(5)] }, { m: [new Money(5)] })).toBe(true);
    expect(eq({ equals: () => true }, 42)).toBe(false); // primitives short-circuit
    expect(eq({ equals: () => true }, { anything: 1 })).toBe(true);
  });

  it("handles cycles", () => {
    type Node = { value: number; self?: Node; children: Node[] };
    const a: Node = { value: 1, children: [] };
    a.self = a;
    a.children.push(a);
    const b: Node = { value: 1, children: [] };
    b.self = b;
    b.children.push(b);
    expect(eq(a, b)).toBe(true);

    const c: Node = { value: 2, children: [] };
    c.self = c;
    c.children.push(c);
    expect(eq(a, c)).toBe(false);

    const arrA: unknown[] = [1];
    arrA.push(arrA);
    const arrB: unknown[] = [1];
    arrB.push(arrB);
    expect(eq(arrA, arrB)).toBe(true);
  });
});
