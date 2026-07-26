import assert from "node:assert/strict";
import test from "node:test";
import { mapHostPath } from "../../core.ts";

const mount = { hostPath: "/home/user/project", guestPath: "/workspace", readOnly: false };

test("mapped host paths are translated into the guest mount", () => {
  assert.equal(mapHostPath("/home/user/project", [mount]), "/workspace");
  assert.equal(mapHostPath("/home/user/project/src/a.ts", [mount]), "/workspace/src/a.ts");
});

test("unmapped host paths are rejected instead of reaching the host", () => {
  assert.throws(
    () => mapHostPath("/home/user/project-secret/token", [mount]),
    /unmapped host path/,
  );
  assert.throws(() => mapHostPath("/etc/passwd", [mount]), /unmapped host path/);
});
