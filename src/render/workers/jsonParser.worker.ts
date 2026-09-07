// ============================================
// WeaveMD — JSON Parser Web Worker
// ============================================
// 异步 JSON.parse，避免大数据阻塞主线程。

interface ParseRequest {
  id: string;
  json: string;
}

interface ParseSuccess {
  id: string;
  result: unknown;
}

interface ParseError {
  id: string;
  error: string;
}

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, json } = e.data;
  try {
    const result = JSON.parse(json);
    const response: ParseSuccess = { id, result };
    self.postMessage(response);
  } catch (err) {
    const response: ParseError = {
      id,
      error: err instanceof Error ? err.message : 'JSON parse failed',
    };
    self.postMessage(response);
  }
};
