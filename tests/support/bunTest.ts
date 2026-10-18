/**
 * Test API shared by every suite: native `bun:test` plus the few helpers the
 * suites rely on that Bun does not ship (fixtures through `extend`, `runIf`,
 * `expect.poll`, `vi.hoisted`, async fake timers, environment stubs and
 * caller-relative `vi.mock`).
 */
import { createRequire } from "node:module";
import { formatWithOptions } from "node:util";
import { readFileSync } from "node:fs";
import {
  dirname,
  relative as relativePath,
  resolve as resolvePath,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as bun from "bun:test";

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  onTestFinished,
} from "bun:test";

type AnyFunction = (...arguments_: never[]) => unknown;
type Awaitable<T> = T | Promise<T>;

const shimPath = fileURLToPath(import.meta.url);

/** Absolute path of the first stack frame outside this module. */
const callerPath = (): string => {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    const match =
      /(?:file:\/\/\/)?((?:[A-Za-z]:)?[\\/][^():]+\.[cm]?[jt]s)/u.exec(line);
    const raw = match?.[1];
    if (raw === undefined) continue;
    const path =
      raw.startsWith("/") && /^\/[A-Za-z]:/u.test(raw) ? raw.slice(1) : raw;
    const decoded = decodeURIComponent(path);
    if (resolvePath(decoded) !== resolvePath(shimPath)) return decoded;
  }
  return shimPath;
};

/** Resolve a module specifier the way the calling test file imports it. */
const resolveFrom = (specifier: string, caller: string): string => {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    if (specifier.startsWith("node:") || specifier.startsWith("bun:"))
      return specifier;
    return createRequire(pathToFileURL(caller)).resolve(specifier);
  }
  return Bun.resolveSync(specifier, dirname(caller));
};

const sleep = (milliseconds: number) =>
  new Promise<void>((done) => setTimeout(done, milliseconds));

const flushMicrotasks = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

/* ---------------------------------------------------------------- expect */

type PollOptions = { readonly timeout?: number; readonly interval?: number };

const pollExpectation = (
  read: () => unknown,
  options: PollOptions,
  negated: boolean,
): unknown =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "not") return pollExpectation(read, options, !negated);
        return (...matcherArguments: unknown[]) =>
          (async () => {
            const timeout = options.timeout ?? 1000;
            const interval = options.interval ?? 50;
            const deadline = Date.now() + timeout;
            for (;;) {
              try {
                const value = await read();
                const assertion = bun.expect(value) as unknown as Record<
                  string | symbol,
                  unknown
                >;
                const subject = (negated ? assertion.not : assertion) as Record<
                  string | symbol,
                  (...a: unknown[]) => unknown
                >;
                await subject[property]?.(...matcherArguments);
                return;
              } catch (cause) {
                if (Date.now() >= deadline) throw cause;
                await sleep(interval);
              }
            }
          })();
      },
    },
  );

type LooseMatchers = bun.Matchers<any> & {
  toHaveBeenCalledOnce(): void;
  toMatchObject<_T = unknown>(expected: any): void;
  toHaveBeenCalledExactlyOnceWith(...expected: any[]): void;
  readonly not: LooseMatchers;
  readonly resolves: LooseMatchers;
  readonly rejects: LooseMatchers;
};
type PollMatchers = {
  readonly [K in keyof LooseMatchers]: LooseMatchers[K] extends (
    ...arguments_: infer P
  ) => unknown
    ? (...arguments_: P) => Promise<void>
    : LooseMatchers[K];
};

type Equals = (a: unknown, b: unknown) => boolean;

function matchesSubset(
  equals: Equals,
  received: unknown,
  expected: unknown,
): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(received) &&
      received.length === expected.length &&
      expected.every((item, index) =>
        matchesSubset(equals, received[index], item),
      )
    );
  }
  if (
    typeof expected === "object" &&
    expected !== null &&
    Object.getPrototypeOf(expected) === Object.prototype
  ) {
    const keys = Object.keys(expected);
    if (keys.length === 0 && Bun.inspect(expected) !== "{}") {
      return equals(received, expected);
    }
    return (
      typeof received === "object" &&
      received !== null &&
      keys.every(
        (key) =>
          key in received &&
          matchesSubset(
            equals,
            (received as Record<string, unknown>)[key],
            (expected as Record<string, unknown>)[key],
          ),
      )
    );
  }
  return equals(received, expected);
}

bun.expect.extend({
  toMatchObject(
    this: { equals: Equals },
    received: unknown,
    expected: unknown,
  ) {
    return {
      pass: matchesSubset(this.equals.bind(this), received, expected),
      message: () =>
        `expected ${Bun.inspect(received)} to match object ${Bun.inspect(expected)}`,
    };
  },
} as never);

bun.expect.extend({
  toHaveBeenCalledExactlyOnceWith(
    this: { equals(a: unknown, b: unknown): boolean },
    received: { mock: { calls: unknown[][] } },
    ...expected: unknown[]
  ) {
    const calls = received.mock.calls;
    const pass = calls.length === 1 && this.equals(calls[0], expected);
    return {
      pass,
      message: () =>
        `expected exactly one call with ${JSON.stringify(expected)}, got ${JSON.stringify(calls)}`,
    };
  },
} as never);

type LooseExpect = {
  (actual: unknown, message?: string): LooseMatchers;
  poll: <T>(
    read: () => Awaitable<T>,
    options?: PollOptions,
  ) => PollMatchers & { readonly not: PollMatchers };
  soft: LooseExpect;
} & Omit<typeof bun.expect, "poll" | "soft">;

type MatcherRecord = Record<string, (...a: unknown[]) => unknown>;

/**
 * Bun's native `rejects`/`resolves` spin the event loop until the promise
 * settles, which never ends under fake timers. Settle the promise
 * asynchronously instead and apply the matcher to the settled value.
 */
const settledExpectation = (
  value: unknown,
  mode: "rejects" | "resolves",
  negated: boolean,
): unknown =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "not")
          return settledExpectation(value, mode, !negated);
        return (...matcherArguments: unknown[]) =>
          (async () => {
            let settled: unknown;
            let rejected = false;
            try {
              settled = await (typeof value === "function"
                ? (value as () => unknown)()
                : value);
            } catch (cause) {
              rejected = true;
              settled = cause;
            }
            if (mode === "resolves" && rejected) throw settled;
            if (mode === "rejects" && !rejected)
              throw new Error(
                `Promise resolved to ${Bun.inspect(settled)} instead of rejecting`,
              );
            const subject =
              mode === "rejects" &&
              typeof property === "string" &&
              property.startsWith("toThrow")
                ? () => {
                    throw settled;
                  }
                : settled;
            const assertion = bun.expect(
              subject,
            ) as unknown as MatcherRecord & {
              not: MatcherRecord;
            };
            await (negated ? assertion.not : assertion)[property as string]?.(
              ...matcherArguments,
            );
          })();
      },
    },
  );

const expectStatics = {
  poll: (read: () => unknown, options: PollOptions = {}) =>
    pollExpectation(read, options, false),
  soft: bun.expect,
};

export const expect = new Proxy(bun.expect, {
  apply: (target, thisArgument, argumentsList: [unknown, string?]) => {
    const assertion = Reflect.apply(
      target,
      thisArgument,
      argumentsList,
    ) as object;
    const [value] = argumentsList;
    return new Proxy(assertion, {
      get: (inner, property) => {
        if (property === "rejects" || property === "resolves")
          return settledExpectation(value, property, false);
        const member = Reflect.get(inner, property, inner) as unknown;
        return typeof member === "function"
          ? (...matcherArguments: unknown[]) =>
              Reflect.apply(member, inner, matcherArguments)
          : member;
      },
    });
  },
  get: (target, property, _receiver) =>
    property in expectStatics
      ? expectStatics[property as keyof typeof expectStatics]
      : Reflect.get(target, property, target),
}) as unknown as LooseExpect;

/* -------------------------------------------------------------------- vi */

const stubbedEnvironment = new Map<string, string | undefined>();
const stubbedGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

type Factory = (
  importOriginal: <T = Record<string, unknown>>() => Promise<T>,
) => unknown;

const registerMock = (
  specifier: string,
  caller: string,
  factory: Factory | undefined,
): void => {
  const target = resolveFrom(specifier, caller);
  const original = (() => {
    try {
      return { ...(import.meta.require(target) as Record<string, unknown>) };
    } catch {
      return {};
    }
  })();
  bun.mock.module(
    target,
    async () =>
      (factory
        ? await factory(async <T>() => original as T)
        : { ...original }) as Record<string, unknown>,
  );
};

// biome-ignore lint: loose mock
type LooseMock = Omit<
  bun.Mock<(...a: any[]) => any>,
  | "mockImplementation"
  | "mockImplementationOnce"
  | "mockResolvedValue"
  | "mockResolvedValueOnce"
> & {
  mockResolvedValue(value?: any): LooseMock;
  mockResolvedValueOnce(value?: any): LooseMock;
  mockImplementation(fn: (...args: any) => any): LooseMock;
  mockImplementationOnce(fn: (...args: any) => any): LooseMock;
};

type ViBase = typeof bun.vi;

const viExtensions = {
  // biome-ignore lint: loose spy typing
  spyOn: (target: any, method: any, accessType?: "get" | "set"): LooseMock =>
    (bun.spyOn as any)(target, method, accessType),
  resetModules: () => undefined,
  hoisted: <T>(factory: () => T): T => factory(),
  mocked: <T>(value: T): T extends AnyFunction ? LooseMock : T =>
    value as never,
  mock: (specifier: string, factory?: Factory | { spy?: boolean }) =>
    registerMock(
      specifier,
      callerPath(),
      typeof factory === "function" ? factory : undefined,
    ),
  doMock: (specifier: string, factory?: Factory) =>
    registerMock(specifier, callerPath(), factory),
  doUnmock: (_specifier: string) => undefined,
  importActual: async <T = Record<string, unknown>>(
    specifier: string,
  ): Promise<T> => import(resolveFrom(specifier, callerPath())) as Promise<T>,
  advanceTimersByTimeAsync: async (milliseconds: number) => {
    await flushMicrotasks();
    bun.vi.advanceTimersByTime(milliseconds);
    await flushMicrotasks();
  },
  runAllTimersAsync: async () => {
    await flushMicrotasks();
    for (
      let step = 0;
      step < 100_000 && bun.vi.getTimerCount() > 0;
      step += 1
    ) {
      bun.vi.advanceTimersToNextTimer();
      await flushMicrotasks();
    }
  },
  setSystemTime: (now?: Date | number) => bun.setSystemTime(now),
  setConfig: (_config: unknown) => undefined,
  waitFor: async <T>(
    callback: () => Awaitable<T>,
    options: number | PollOptions = {},
  ): Promise<T> => {
    const { timeout = 1000, interval = 50 } =
      typeof options === "number" ? { timeout: options } : options;
    const deadline = Date.now() + timeout;
    for (;;) {
      try {
        return await callback();
      } catch (cause) {
        if (Date.now() >= deadline) throw cause;
        if (bun.vi.isFakeTimers()) bun.vi.advanceTimersByTime(interval);
        else await sleep(interval);
      }
    }
  },
  stubEnv: (name: string, value: string | undefined) => {
    if (!stubbedEnvironment.has(name))
      stubbedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    return viApi;
  },
  unstubAllEnvs: () => {
    for (const [name, value] of stubbedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    stubbedEnvironment.clear();
    return viApi;
  },
  stubGlobal: (name: PropertyKey, value: unknown) => {
    if (!stubbedGlobals.has(name))
      stubbedGlobals.set(
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
      );
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
    return viApi;
  },
  unstubAllGlobals: () => {
    for (const [name, descriptor] of stubbedGlobals) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
    stubbedGlobals.clear();
    return viApi;
  },
};

type ViType = Omit<ViBase, keyof typeof viExtensions | "useFakeTimers"> &
  typeof viExtensions & {
    useFakeTimers: (options?: {
      now?: number | Date;
      toFake?: readonly string[];
    }) => ViType;
  };
const viApi = Object.assign(bun.vi, viExtensions) as unknown as ViType;
export const vi = viApi;
export type Mock<
  T extends (...a: never[]) => unknown = (...a: never[]) => unknown,
> = bun.Mock<T>;

/* -------------------------------------------------------------- fixtures */

type FixtureScope = "test" | "worker" | "file";
type FixtureFunction = (
  dependencies: Record<string, unknown>,
  use: (value: unknown) => Promise<void>,
) => Awaitable<void>;
type FixtureEntry =
  | FixtureFunction
  | unknown
  | readonly [unknown, { readonly scope?: FixtureScope }];
type FixtureDefinitions = Record<string, FixtureEntry>;

type NormalizedFixture = {
  readonly name: string;
  readonly value: unknown;
  readonly scope: FixtureScope;
};

const normalizeFixtures = (definitions: FixtureDefinitions) =>
  Object.entries(definitions).map(([name, entry]): NormalizedFixture => {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[1] === "object" &&
      entry[1] !== null &&
      "scope" in entry[1]
    )
      return {
        name,
        value: entry[0],
        scope: (entry[1] as { scope: FixtureScope }).scope,
      };
    return { name, value: entry, scope: "test" };
  });

/** Names destructured by the context parameter of a test or fixture body. */
const requestedNames = (body: unknown, skipped = 0): string[] => {
  if (typeof body !== "function") return [];
  const source = Function.prototype.toString.call(body);
  const open = source.indexOf("(");
  const arrow = source.indexOf("=>");
  const paramsEnd =
    open !== -1 && (arrow === -1 || open < arrow)
      ? (() => {
          let depth = 0;
          for (let index = open; index < source.length; index += 1) {
            const character = source[index];
            if (character === "(") depth += 1;
            else if (character === ")" && (depth -= 1) === 0) return index;
          }
          return source.length;
        })()
      : arrow;
  const parameters = source.slice(
    Math.max(open, 0) + (open !== -1 && (arrow === -1 || open < arrow) ? 1 : 0),
    paramsEnd,
  );
  const pieces: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of parameters) {
    if ("{[(".includes(character)) depth += 1;
    else if ("}])".includes(character)) depth -= 1;
    if (character === "," && depth === 0) {
      pieces.push(current);
      current = "";
    } else current += character;
  }
  pieces.push(current);
  const target = pieces[skipped]?.trim() ?? "";
  const names: string[] = [];
  const match = /^\{([^{}]*)\}/u.exec(target);
  if (match)
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.trim().split(/[:=\s]/u)[0];
      if (name && !name.startsWith("...")) names.push(name);
    }
  return names;
};

type Teardown = {
  readonly release: () => void;
  readonly settled: Promise<void>;
};

class FixtureScopeInstance {
  readonly values = new Map<string, unknown>();
  readonly teardowns: Teardown[] = [];
  readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    private readonly fixtures: ReadonlyMap<string, NormalizedFixture>,
    private readonly parent?: FixtureScopeInstance,
    private readonly scope: FixtureScope = "test",
  ) {}

  private owns(fixture: NormalizedFixture): boolean {
    return (fixture.scope === "test") === (this.scope === "test");
  }

  resolve(name: string): Promise<unknown> {
    const fixture = this.fixtures.get(name);
    if (fixture === undefined)
      return Promise.reject(new Error(`Unknown test fixture: ${name}`));
    if (!this.owns(fixture) && this.parent !== undefined)
      return this.parent.resolve(name);
    const existing = this.pending.get(name);
    if (existing !== undefined) return existing;
    const created = this.create(fixture);
    this.pending.set(name, created);
    return created;
  }

  private async create(fixture: NormalizedFixture): Promise<unknown> {
    if (typeof fixture.value !== "function") return fixture.value;
    const body = fixture.value as FixtureFunction;
    const dependencies: Record<string, unknown> = {};
    for (const dependency of requestedNames(body))
      dependencies[dependency] = await this.resolve(dependency);
    let release!: () => void;
    const released = new Promise<void>((done) => (release = done));
    let provide!: (value: unknown) => void;
    const provided = new Promise<unknown>((done) => (provide = done));
    const settled = (async () => {
      try {
        await body(dependencies, async (value) => {
          provide(value);
          await released;
        });
      } finally {
        provide(undefined);
      }
    })();
    this.teardowns.push({ release, settled });
    const failure = settled.then(
      () => undefined,
      (cause) => {
        throw cause;
      },
    );
    const value = await Promise.race([provided, failure.then(() => provided)]);
    return value;
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const teardown of this.teardowns.splice(0).reverse()) {
      teardown.release();
      try {
        await teardown.settled;
      } catch (cause) {
        errors.push(cause);
      }
    }
    this.pending.clear();
    if (errors.length > 0)
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Fixture teardown failed");
  }
}

export type OnTestFinishedHandler = () => Awaitable<unknown>;
type BaseContext = {
  readonly onTestFinished: (handler: OnTestFinishedHandler) => void;
  readonly skip: (condition?: unknown, note?: string) => void;
};
type TestBody<Context> = (context: Context & BaseContext) => Awaitable<unknown>;
type CaseBody<Case, Context> = (
  testCase: Case,
  context: Context & BaseContext,
) => Awaitable<unknown>;

type Registrar = (
  name: string,
  body: () => Promise<unknown>,
  timeout?: number,
) => void;

type EachBody<Arguments extends readonly unknown[]> = (
  ...arguments_: Arguments
) => Awaitable<unknown>;
type EachRegistrar<T extends readonly unknown[]> = {
  (
    name: string,
    body: EachBody<T>,
    timeout?: number | { timeout?: number },
  ): void;
  // biome-ignore lint: fallback for union tuples
  (
    name: string,
    body: (...arguments_: any) => Awaitable<unknown>,
    timeout?: number | { timeout?: number },
  ): void;
};
type EachFunction = {
  // biome-ignore lint: tuple hint
  <T extends any[] | [any]>(cases: readonly T[]): EachRegistrar<T>;
  <T extends readonly any[]>(cases: readonly T[]): EachRegistrar<T>;
  <T>(cases: readonly T[]): EachRegistrar<[T]>;
};

export type ExtendedTest<Context> = {
  (name: string, body: TestBody<Context>, timeout?: number): void;
  (name: string, options: { timeout?: number }, body: TestBody<Context>): void;
  skip: ExtendedTest<Context>;
  only: ExtendedTest<Context>;
  todo: (name: string) => void;
  skipIf: (condition: unknown) => ExtendedTest<Context>;
  runIf: (condition: unknown) => ExtendedTest<Context>;
  for: <Case>(cases: readonly Case[]) => {
    (
      name: string,
      body: CaseBody<Case, Context>,
      timeout?: number | { timeout?: number },
    ): void;
    (
      name: string,
      options: { timeout?: number },
      body: CaseBody<Case, Context>,
    ): void;
  };
  each: EachFunction;
  extend: <Extra extends ContextShape>(
    fixtures: FixtureInput<Extra, Context>,
  ) => ExtendedTest<Context & ContextOf<Extra>>;
};

type ContextShape = { $test?: object; $worker?: object } | object;
type ContextOf<Shape> = Shape extends { $test?: infer T; $worker?: infer W }
  ? ([T] extends [undefined] ? unknown : NonNullable<T>) &
      ([W] extends [undefined] ? unknown : NonNullable<W>) &
      ("$test" extends keyof Shape | "$worker" ? unknown : unknown)
  : Shape;
type FlatShape<Shape> = Shape extends { $test?: unknown; $worker?: unknown }
  ? NonNullable<Shape["$test"]> & NonNullable<Shape["$worker"]>
  : Shape;
type FixtureInput<Extra, Context> = {
  [K in keyof FlatShape<Extra>]:
    | FlatShape<Extra>[K]
    | ((
        context: Context & FlatShape<Extra>,
        use: (value: FlatShape<Extra>[K]) => Promise<void>,
      ) => Awaitable<void>)
    | readonly [
        (
          context: Context & FlatShape<Extra>,
          use: (value: FlatShape<Extra>[K]) => Promise<void>,
        ) => Awaitable<void>,
        { scope: FixtureScope },
      ];
};

const SKIP = Symbol("skip");
const DEFAULT_TIMEOUT_MS = 30_000;

const formatTitle = (
  name: string,
  testCase: unknown,
  index: number,
  spread: boolean,
): string => {
  const args = spread && Array.isArray(testCase) ? testCase : [testCase];
  let title = name.replace(/\$([A-Za-z_][\w.]*)/gu, (match, path: string) => {
    let value: unknown = testCase;
    for (const key of path.split(".")) {
      if (typeof value !== "object" || value === null) return match;
      value = (value as Record<string, unknown>)[key];
    }
    return typeof value === "string" ? value : Bun.inspect(value);
  });
  title = title.replace(/%#/gu, String(index));
  return args.length > 0 && /%[sdifjoOp]/u.test(title)
    ? formatWithOptions({}, title, ...args)
    : title;
};

const makeTest = <Context>(
  register: (kind: "test" | "skip" | "only") => Registrar,
  fixtures: ReadonlyMap<string, NormalizedFixture>,
  workerScope: FixtureScopeInstance,
): ExtendedTest<Context> => {
  const build = (kind: "test" | "skip" | "only"): ExtendedTest<Context> => {
    const run =
      (body: unknown, extra: readonly unknown[], withContext = true) =>
      async () => {
        const scope = new FixtureScopeInstance(fixtures, workerScope, "test");
        const context: Record<string, unknown> = {
          onTestFinished: bun.onTestFinished,
          skip: (condition: unknown = true) => {
            if (condition) throw SKIP;
          },
        };
        try {
          for (const name of requestedNames(body, extra.length))
            if (!(name in context)) context[name] = await scope.resolve(name);
          return await (body as (...a: unknown[]) => unknown)(
            ...(withContext ? [...extra, context] : extra),
          );
        } catch (cause) {
          if (cause === SKIP) return undefined;
          throw cause;
        } finally {
          await scope.dispose();
        }
      };
    const direct = ((name: string, second: unknown, third?: unknown): void => {
      const [body, timeout] =
        typeof second === "function"
          ? [second, third as number | undefined]
          : [third, (second as { timeout?: number } | undefined)?.timeout];
      register(kind)(name, run(body, []), timeout ?? DEFAULT_TIMEOUT_MS);
    }) as ExtendedTest<Context>;
    const cases =
      (spread: boolean) =>
      (list: readonly unknown[]) =>
      (name: string, second: unknown, third?: unknown) => {
        const body = typeof second === "function" ? second : third;
        const timeoutArg = typeof second === "function" ? third : second;
        const timeout =
          typeof timeoutArg === "object" && timeoutArg
            ? (timeoutArg as { timeout?: number }).timeout
            : (timeoutArg as number | undefined);
        list.forEach((testCase, index) => {
          const title = formatTitle(name, testCase, index, spread);
          register(kind)(
            title,
            run(
              body,
              spread && Array.isArray(testCase) ? testCase : [testCase],
              !spread,
            ),
            timeout ?? DEFAULT_TIMEOUT_MS,
          );
        });
      };
    direct.for = cases(false) as never;
    direct.each = cases(true) as never;
    direct.todo = (name: string) => bun.test.todo(name, () => {});
    direct.skipIf = (condition: unknown) =>
      (condition ? build("skip") : direct) as never;
    direct.runIf = (condition: unknown) =>
      (condition ? direct : build("skip")) as never;
    Object.defineProperty(direct, "skip", { get: () => build("skip") });
    Object.defineProperty(direct, "only", { get: () => build("only") });
    direct.extend = ((definitions: FixtureDefinitions) => {
      const merged = new Map(fixtures);
      for (const fixture of normalizeFixtures(definitions))
        merged.set(fixture.name, fixture);
      const nextWorker = new FixtureScopeInstance(merged, undefined, "worker");
      bun.afterAll(async () => {
        await nextWorker.dispose();
      });
      return makeTest(register, merged, nextWorker);
    }) as never;
    return direct;
  };
  return build("test");
};

/**
 * Tests that cannot pass on a Windows host under Bun: they rely on POSIX
 * executables and paths, vitest hoisted module mocks, or a Node-only oracle.
 * They run on the Linux and macOS lanes; this registry only skips them here.
 */
const hostSkips: Record<string, readonly string[]> | undefined =
  process.platform === "win32"
    ? (JSON.parse(
        readFileSync(
          new URL("./windowsBunSkips.json", import.meta.url),
          "utf8",
        ),
      ) as Record<string, readonly string[]>)
    : undefined;
const hostRoot = resolvePath(".");

const hostSkipped = (name: string): boolean => {
  if (hostSkips === undefined) return false;
  const file = relativePath(hostRoot, callerPath()).replaceAll("\\", "/");
  return hostSkips[file]?.includes(name) === true;
};

const registerBun: (kind: "test" | "skip" | "only") => Registrar =
  (kind) => (name, body, timeout) => {
    const target =
      kind === "skip" || hostSkipped(name)
        ? bun.test.skip
        : kind === "only"
          ? bun.test.only
          : bun.test;
    (target as unknown as (n: string, b: unknown, t?: number) => void)(
      name,
      body,
      timeout,
    );
  };

const root = makeTest<unknown>(
  registerBun,
  new Map(),
  new FixtureScopeInstance(new Map(), undefined, "worker"),
);

export const test = root;
export const it = root;

type DescribeBody = () => void;
type DescribeFunction = {
  (name: string, body: DescribeBody): void;
  (
    name: string,
    options: { timeout?: number; concurrent?: boolean },
    body: DescribeBody,
  ): void;
};
const wrapDescribe = (base: typeof bun.describe): DescribeFunction =>
  ((name: string, second: unknown, third?: unknown) => {
    const body = (
      typeof second === "function" ? second : third
    ) as DescribeBody;
    base(name, body);
  }) as DescribeFunction;

export const describe: DescribeFunction & {
  runIf: (condition: unknown) => DescribeFunction;
  skip: DescribeFunction;
  only: DescribeFunction;
  skipIf: (condition: unknown) => DescribeFunction;
  each: typeof bun.describe.each;
} = Object.assign(wrapDescribe(bun.describe), {
  runIf: (condition: unknown) =>
    wrapDescribe(condition ? bun.describe : bun.describe.skip),
  skip: wrapDescribe(bun.describe.skip),
  only: wrapDescribe(bun.describe.only),
  skipIf: (condition: unknown) =>
    wrapDescribe(condition ? bun.describe.skip : bun.describe),
  each: ((...parameters: unknown[]) =>
    Reflect.apply(
      bun.describe.each,
      bun.describe,
      parameters,
    )) as typeof bun.describe.each,
});

export { expectTypeOf } from "bun:test";
