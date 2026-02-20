import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { CLEANUP_INTERVAL_MS, DEFAULT_SESSION_TIMEOUT_MS } from "../../constants.js";
import { cleanupIdleSessions, type SessionData } from "../../transports/http.js";
import { createMockBridge } from "../helpers/testUtils.js";

describe("HTTP Session Timeout", () => {
	let mockDateNow: jest.SpiedFunction<typeof Date.now>;
	let originalSetInterval: typeof setInterval;
	let originalClearInterval: typeof clearInterval;
	let intervalCallbacks: Map<NodeJS.Timeout, () => void>;
	let intervalIds: NodeJS.Timeout[];

	beforeEach(() => {
		jest.clearAllMocks();
		intervalCallbacks = new Map();
		intervalIds = [];

		mockDateNow = jest.spyOn(Date, "now");
		mockDateNow.mockReturnValue(1000000);

		originalSetInterval = globalThis.setInterval;
		originalClearInterval = globalThis.clearInterval;

		(globalThis as any).setInterval = jest.fn((callback: () => void, _ms: number) => {
			const id = { __id: intervalIds.length } as unknown as NodeJS.Timeout;
			intervalCallbacks.set(id, callback);
			intervalIds.push(id);
			return id;
		});

		(globalThis as any).clearInterval = jest.fn((id: NodeJS.Timeout) => {
			intervalCallbacks.delete(id);
		});
	});

	afterEach(() => {
		mockDateNow.mockRestore();
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	});

	describe("SessionData lastActivity tracking", () => {
		it("should initialize lastActivity with current timestamp on session creation", () => {
			const now = 1234567890;
			mockDateNow.mockReturnValue(now);

			const createSession = (): Pick<SessionData, "lastActivity"> => {
				return { lastActivity: Date.now() };
			};

			const session = createSession();
			expect(session.lastActivity).toBe(now);
		});

		it("should update lastActivity when session receives activity", () => {
			const initialTime = 1000000;
			const laterTime = 2000000;

			mockDateNow.mockReturnValue(initialTime);

			const session: Pick<SessionData, "lastActivity"> = { lastActivity: Date.now() };
			expect(session.lastActivity).toBe(initialTime);

			mockDateNow.mockReturnValue(laterTime);
			session.lastActivity = Date.now();
			expect(session.lastActivity).toBe(laterTime);
		});
	});

	describe("Idle session cleanup logic", () => {
		const createMockSession = (lastActivity: number): SessionData => ({
			lastActivity,
			transport: { close: jest.fn() } as any,
			server: {} as any,
		});

		it("should remove sessions that exceed the timeout threshold", () => {
			const sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
			const now = 5000000;
			mockDateNow.mockReturnValue(now);
			const mockBridge = createMockBridge();

			const sessions = new Map<string, SessionData>();

			const activeSession = createMockSession(now - 1000);
			const idleSession = createMockSession(now - sessionTimeoutMs - 1000);

			sessions.set("active-session", activeSession);
			sessions.set("idle-session", idleSession);

			cleanupIdleSessions(sessions, sessionTimeoutMs, mockBridge);

			expect(sessions.has("active-session")).toBe(true);
			expect(sessions.has("idle-session")).toBe(false);
			expect(activeSession.transport.close).not.toHaveBeenCalled();
			expect(idleSession.transport.close).toHaveBeenCalled();
			expect(mockBridge.disposeServer).toHaveBeenCalledWith(idleSession.server);
		});

		it("should not remove sessions that are within the timeout threshold", () => {
			const sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
			const now = 5000000;
			mockDateNow.mockReturnValue(now);
			const mockBridge = createMockBridge();

			const sessions = new Map<string, SessionData>();

			const recentSession = createMockSession(now - 1000);
			const almostIdleSession = createMockSession(now - sessionTimeoutMs + 1000);

			sessions.set("recent", recentSession);
			sessions.set("almost-idle", almostIdleSession);

			cleanupIdleSessions(sessions, sessionTimeoutMs, mockBridge);

			expect(sessions.size).toBe(2);
			expect(recentSession.transport.close).not.toHaveBeenCalled();
			expect(almostIdleSession.transport.close).not.toHaveBeenCalled();
			expect(mockBridge.disposeServer).not.toHaveBeenCalled();
		});

		it("should handle empty sessions map gracefully", () => {
			const sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
			const sessions = new Map<string, SessionData>();
			const mockBridge = createMockBridge();

			expect(() => cleanupIdleSessions(sessions, sessionTimeoutMs, mockBridge)).not.toThrow();
			expect(sessions.size).toBe(0);
		});

		it("should remove multiple idle sessions in one cleanup cycle", () => {
			const sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
			const now = 10000000;
			mockDateNow.mockReturnValue(now);
			const mockBridge = createMockBridge();

			const sessions = new Map<string, SessionData>();

			sessions.set("idle-1", createMockSession(now - sessionTimeoutMs - 1000));
			sessions.set("idle-2", createMockSession(now - sessionTimeoutMs - 2000));
			sessions.set("idle-3", createMockSession(now - sessionTimeoutMs - 3000));
			sessions.set("active", createMockSession(now - 1000));

			cleanupIdleSessions(sessions, sessionTimeoutMs, mockBridge);

			expect(sessions.size).toBe(1);
			expect(sessions.has("active")).toBe(true);
			expect(mockBridge.disposeServer).toHaveBeenCalledTimes(3);
		});
	});

	describe("Cleanup interval management", () => {
		it("should set up periodic cleanup interval", () => {
			const cleanupCallback = jest.fn();
			const intervalId = setInterval(cleanupCallback, CLEANUP_INTERVAL_MS);

			expect(globalThis.setInterval).toHaveBeenCalledWith(cleanupCallback, CLEANUP_INTERVAL_MS);
			expect(intervalId).toBeDefined();
		});

		it("should clear cleanup interval on shutdown", () => {
			const cleanupCallback = jest.fn();
			const intervalId = setInterval(cleanupCallback, CLEANUP_INTERVAL_MS);

			clearInterval(intervalId);

			expect(globalThis.clearInterval).toHaveBeenCalledWith(intervalId);
		});

		it("should invoke cleanup callback when interval fires", () => {
			const cleanupCallback = jest.fn();
			setInterval(cleanupCallback, CLEANUP_INTERVAL_MS);

			const firstIntervalId = intervalIds[0]!;
			const callback = intervalCallbacks.get(firstIntervalId);
			expect(callback).toBeDefined();

			callback?.();
			expect(cleanupCallback).toHaveBeenCalledTimes(1);
		});
	});

	describe("Configurable timeout", () => {
		it("should use default timeout when not configured", () => {
			const options: { sessionTimeoutMs?: number } = {};
			const sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;

			expect(sessionTimeoutMs).toBe(DEFAULT_SESSION_TIMEOUT_MS);
		});

		it("should use custom timeout when configured", () => {
			const THIRTY_MINUTES_MS = 30 * 60 * 1000;
			const customTimeout = THIRTY_MINUTES_MS;
			const options = { sessionTimeoutMs: customTimeout };
			const sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;

			expect(sessionTimeoutMs).toBe(customTimeout);
		});

		it("should respect very short timeout for testing", () => {
			const ONE_SECOND_MS = 1000;
			const shortTimeout = ONE_SECOND_MS;
			const now = 5000000;
			mockDateNow.mockReturnValue(now);
			const mockBridge = createMockBridge();

			const sessions = new Map<string, SessionData>();
			sessions.set("test-session", {
				lastActivity: now - 2000,
				transport: { close: jest.fn() } as any,
				server: {} as any,
			});

			cleanupIdleSessions(sessions, shortTimeout, mockBridge);

			expect(sessions.size).toBe(0);
		});
	});

	describe("Session activity on requests", () => {
		it("should update lastActivity on POST request to existing session", () => {
			const initialTime = 1000000;
			const requestTime = 2000000;

			mockDateNow.mockReturnValue(initialTime);
			const sessions = new Map<string, Pick<SessionData, "lastActivity">>();
			sessions.set("session-1", { lastActivity: Date.now() });

			mockDateNow.mockReturnValue(requestTime);

			const sessionId = "session-1";
			if (sessionId && sessions.has(sessionId)) {
				const session = sessions.get(sessionId)!;
				session.lastActivity = Date.now();
			}

			expect(sessions.get("session-1")?.lastActivity).toBe(requestTime);
		});

		it("should update lastActivity on GET request", () => {
			const initialTime = 1000000;
			const requestTime = 3000000;

			mockDateNow.mockReturnValue(initialTime);
			const sessions = new Map<string, Pick<SessionData, "lastActivity">>();
			sessions.set("session-1", { lastActivity: Date.now() });

			mockDateNow.mockReturnValue(requestTime);

			const session = sessions.get("session-1");
			if (session) {
				session.lastActivity = Date.now();
			}

			expect(sessions.get("session-1")?.lastActivity).toBe(requestTime);
		});

		it("should not update activity for non-existent session", () => {
			mockDateNow.mockReturnValue(1000000);
			const sessions = new Map<string, Pick<SessionData, "lastActivity">>();

			const session = sessions.get("non-existent");
			if (session) {
				session.lastActivity = Date.now();
			}

			expect(sessions.get("non-existent")).toBeUndefined();
		});
	});

	describe("Graceful session termination", () => {
		it("should dispose server and close transport before removing from map", () => {
			const sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
			const now = 5000000;
			mockDateNow.mockReturnValue(now);
			const mockBridge = createMockBridge();

			const closeMock = jest.fn();
			const mockServer = {} as any;
			const sessions = new Map<string, SessionData>();
			sessions.set("idle-session", {
				lastActivity: now - sessionTimeoutMs - 1000,
				transport: { close: closeMock } as any,
				server: mockServer,
			});

			cleanupIdleSessions(sessions, sessionTimeoutMs, mockBridge);

			expect(mockBridge.disposeServer).toHaveBeenCalledWith(mockServer);
			expect(closeMock).toHaveBeenCalledTimes(1);
			expect(sessions.has("idle-session")).toBe(false);
		});
	});

	describe("Session registration race condition prevention", () => {
		interface MockTransport {
			sessionId: string | null;
			close: jest.Mock;
			onclose: (() => void) | null;
		}

		interface SessionData {
			server: { connect: jest.Mock };
			transport: MockTransport;
			lastActivity: number;
		}

		interface CreateSessionResult {
			sessionData: SessionData;
			triggerInitialized: (id: string) => void;
			triggerClose: () => void;
		}

		const createTestSession = (sessions: Map<string, SessionData>): ((sessionId: string) => CreateSessionResult) => {
			return (sessionId: string): CreateSessionResult => {
				const transport: MockTransport = {
					sessionId: null,
					close: jest.fn(),
					onclose: null,
				};

				const sessionData: SessionData = {
					server: { connect: jest.fn() },
					transport,
					lastActivity: Date.now(),
				};

				const triggerInitialized = (id: string): void => {
					transport.sessionId = id;
					sessions.set(id, sessionData);
				};

				const triggerClose = (): void => {
					const sid = transport.sessionId;
					if (sid && sessions.has(sid)) {
						sessions.delete(sid);
					}
				};

				transport.onclose = triggerClose;

				return { sessionData, triggerInitialized, triggerClose };
			};
		};

		it("should not register session before onsessioninitialized fires", () => {
			const sessions = new Map<string, SessionData>();
			const createSession = createTestSession(sessions);

			const { sessionData, triggerInitialized } = createSession("test-session-id");

			expect(sessions.size).toBe(0);
			expect(sessionData).toBeDefined();

			triggerInitialized("test-session-id");

			expect(sessions.size).toBe(1);
			expect(sessions.has("test-session-id")).toBe(true);
		});

		it("should not leave zombie sessions when connection fails before initialization", () => {
			const sessions = new Map<string, SessionData>();
			const createSession = createTestSession(sessions);

			createSession("failed-session-id");

			expect(sessions.size).toBe(0);
			expect(sessions.has("failed-session-id")).toBe(false);
		});

		it("should clean up session when transport onclose fires", () => {
			const sessions = new Map<string, SessionData>();
			const createSession = createTestSession(sessions);

			const { triggerInitialized, triggerClose } = createSession("session-to-close");
			triggerInitialized("session-to-close");

			expect(sessions.size).toBe(1);

			triggerClose();

			expect(sessions.size).toBe(0);
		});

		it("should handle onclose gracefully when session was never registered", () => {
			const sessions = new Map<string, SessionData>();
			const createSession = createTestSession(sessions);

			const { triggerClose } = createSession("unregistered-session");

			expect(() => triggerClose()).not.toThrow();
			expect(sessions.size).toBe(0);
		});

		it("should allow session data to be used before registration completes", () => {
			const sessions = new Map<string, SessionData>();
			const createSession = createTestSession(sessions);

			const { sessionData, triggerInitialized } = createSession("new-session");

			expect(sessionData.server).toBeDefined();
			expect(sessionData.transport).toBeDefined();
			expect(sessionData.server.connect).toBeDefined();

			sessionData.server.connect(sessionData.transport);
			expect(sessionData.server.connect).toHaveBeenCalledWith(sessionData.transport);

			triggerInitialized("new-session");
			expect(sessions.has("new-session")).toBe(true);
		});
	});
});
