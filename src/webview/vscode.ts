import type { FromWebview } from '../extension/messages';

interface VsCodeApi {
  postMessage(message: FromWebview): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();

/** UI state (filters, toggles) that survives the webview being hidden and shown again. */
export function loadUiState<T extends object>(defaults: T): T {
  return { ...defaults, ...(vscode.getState<Partial<T>>() ?? {}) };
}
