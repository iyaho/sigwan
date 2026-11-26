/**
 * outbox에 한 줄 쌓일 때 알린다 — 동기화가 2초 모았다가 돈다(7장).
 * repos가 account를 직접 부르면 순환 import가 생겨서 이 작은 다리를 둔다.
 */
let listener: (() => void) | null = null;

export function onOutboxWrite(fn: () => void) {
  listener = fn;
}

export function notifyOutboxWrite() {
  listener?.();
}
