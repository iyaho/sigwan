import { uuidv7 } from 'uuidv7';

/**
 * 7장 — ID는 클라이언트가 만든다. 오프라인 생성과 멱등 요청이 여기서 나온다.
 * UUIDv7이라 시간순으로 증가해 인덱스가 망가지지 않는다.
 */
export const newId = (): string => uuidv7();

export const nowIso = (): string => new Date().toISOString();
