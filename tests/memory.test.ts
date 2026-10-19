import { expect, it } from "vitest";
import {
  availableMemory,
  isDenied,
  stopService,
  topProcesses,
  type Run,
} from "../src/core/memory.js";

const calls: string[] = [];
const fake: Run = (cmd, args) => {
  calls.push([cmd, ...args].join(" "));
  if (cmd === "ps")
    return "  1 /sbin/launchd\n 10 /usr/bin/omlx\n 11 /Applications/Claude.app/x\n 12 /usr/bin/small\n";
  if (cmd === "footprint") {
    const mb = { "1": "5 MB", "10": "9 GB", "11": "2 GB", "12": "100 MB" }[args[1]];
    return `x [${args[1]}]: 64-bit Footprint: ${mb} (16384 bytes per page)\n`;
  }
  if (cmd === "vm_stat")
    return "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 65536.\nPages inactive: 32768.\nPages speculative: 16384.\n";
  if (cmd === "memory_pressure")
    return "The system has 8589934592 bytes\nSystem-wide memory free percentage: 42%\n";
  return "";
};

it("lists by footprint and flags denied", () => {
  const top = topProcesses(fake, 3);
  expect(top.map((p) => p.pid)).toEqual([10, 11, 12]);
  expect(top[0].footprintMb).toBe(9216);
  expect(top[1].denied).toBe(true);
});

it("computes free memory and pressure", () => {
  expect(availableMemory(fake)).toEqual({
    freeGb: 1.75,
    pressure: "System-wide memory free percentage: 42%",
  });
});

it("stops only allow-listed services", () => {
  calls.length = 0;
  expect(stopService("omlx", fake).method).toBe("brew services stop");
  expect(calls).toEqual(["brew services stop omlx"]);
  for (const bad of ["aam-daemon", "ontokb-api", "Paperclip", "Claude", "WindowServer", "random"]) {
    expect(() => stopService(bad, fake)).toThrow(/Refusing/);
  }
  expect(calls).toEqual(["brew services stop omlx"]);
  expect(isDenied("com.openai.chatgpt")).toBe(true);
});

it("falls back to launchctl bootout", () => {
  const seen: string[] = [];
  const r: Run = (c, a) => {
    seen.push(c);
    if (c === "brew") throw new Error("no brew");
    return "";
  };
  expect(stopService("homebrew.mxcl.omlx", r).method).toBe("launchctl bootout");
  expect(seen).toEqual(["brew", "launchctl"]);
});
