import {
	appendToHistory,
	appendToSession,
	listSessions,
	loadHistory,
	loadProjectInstructions,
	loadSessions,
	searchSessions,
	setSessionTitle,
} from "../utils/sessionStorage";

export class SessionStore {
	append(sessionId: string, entry: object): void {
		appendToSession(sessionId, entry);
	}

	appendHistory(prompt: string): void {
		appendToHistory(prompt);
	}

	setTitle(sessionId: string, title: string): void {
		setSessionTitle(sessionId, title);
	}

	listSessions(): ReturnType<typeof listSessions> {
		return listSessions();
	}

	loadSession(sessionId: string): ReturnType<typeof loadSessions> {
		return loadSessions(sessionId);
	}

	searchSessions(query: string): ReturnType<typeof searchSessions> {
		return searchSessions(query);
	}

	loadHistory(): ReturnType<typeof loadHistory> {
		return loadHistory();
	}

	loadProjectInstructions(cwd: string): ReturnType<typeof loadProjectInstructions> {
		return loadProjectInstructions(cwd);
	}
}
