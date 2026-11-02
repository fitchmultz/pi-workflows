import assert from "node:assert/strict";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {Record<string, unknown>} */
export function asRecord(value) {
  if (!isRecord(value)) {
    throw new Error("fixture value must be an object");
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function asString(value) {
  if (typeof value !== "string") {
    throw new Error("fixture value must be a string");
  }
  return value;
}

/** @param {unknown} value @returns {unknown[]} */
export function asArray(value) {
  if (!Array.isArray(value)) {
    throw new Error("fixture value must be an array");
  }
  return value;
}

/**
 * @param {import("@earendil-works/pi-coding-agent").AgentSession["messages"]} messages
 * @param {string} customType
 */
export const customMessages = (messages, customType) =>
  messages.flatMap((message) =>
    message.role === "custom" && message.customType === customType ? [message] : [],
  );

/**
 * @param {import("@earendil-works/pi-coding-agent").AgentSession["messages"]} messages
 * @param {string} toolCallId
 */
export const toolResults = (messages, toolCallId) =>
  messages.flatMap((message) =>
    message.role === "toolResult" && message.toolCallId === toolCallId ? [message] : [],
  );

/** @param {Array<{ type: string, text?: string }>} content @returns {string} */
export const textOf = (content) =>
  content
    .flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : []))
    .join("\n");

/** @param {Array<{ type: string, text?: string }>} content @returns {string} */
export function firstText(content) {
  const first = content[0];
  if (first === undefined || first.type !== "text" || first.text === undefined) {
    throw new Error(`unexpected tool result content: ${JSON.stringify(content)}`);
  }
  return first.text;
}

/** @param {import("node:http").Server} server @returns {import("node:net").AddressInfo} */
export const loopbackAddress = (server) => {
  const address = server.address();
  assert.ok(typeof address === "object" && address !== null, "fixture loopback address");
  return address;
};

/** @param {string} content @param {string} replacement @returns {{ agent: string, label: string, task: string }} */
export const recipePayload = (content, replacement) => {
  const payload = { agent: "", label: "", task: "" };
  for (const match of content.matchAll(/^- `(agent|label|task)`: "([^"\n]+)"$/gm)) {
    const [, key, value] = match;
    assert.ok(key !== undefined && value !== undefined, "fixture prompt shape");
    if (key === "agent" || key === "label" || key === "task") {
      payload[key] = value.replaceAll("$ARGUMENTS", replacement);
    }
  }
  return payload;
};

/** @param {Record<string, string | undefined>} inherited @param {Record<string, string | undefined>} saved @param {NodeJS.ProcessEnv} env */
export const adoptFixtureEnv = (inherited, saved, env) => {
  for (const key of Object.keys(inherited)) {
    delete process.env[key];
  }
  Object.assign(process.env, Object.fromEntries(Object.keys(saved).map((key) => [key, env[key]])));
};

/** @param {Record<string, string | undefined>} saved */
export const restoreEnv = (saved) => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};
