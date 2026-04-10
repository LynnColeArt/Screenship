const SESSION_KEY_PREFIX = "screenship:capture-session:";

function sessionKey(sessionId) {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

export async function createSession(payload) {
  const sessionId = crypto.randomUUID();
  await chrome.storage.local.set({
    [sessionKey(sessionId)]: payload
  });
  return sessionId;
}

export async function readSession(sessionId) {
  const key = sessionKey(sessionId);
  const data = await chrome.storage.local.get(key);
  return data[key] ?? null;
}

export async function clearSession(sessionId) {
  await chrome.storage.local.remove(sessionKey(sessionId));
}

