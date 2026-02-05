export interface UserProfile {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  organizationId?: string;
  connectionType?: string;
  demoMode: boolean;
  developerMode?: boolean;
  membershipTier?: "free" | "premium" | "demo";
  maxConversationMinutes?: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  language: string;
  topic?: string | null;
  agentDisplayName?: string | null;
  difficulty?: string | null;
  adaptive?: boolean | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateSessionRequest {
  userId: string;
  agentId: string;
  agentName: string;
  language: string;
  difficulty?: string;
  adaptive?: boolean;
  topic?: string;
}

export interface VoiceWebsocketInfo {
  websocketUrl: string;
  sessionId: string;
  userId: string;
  difficulty?: string | null;
  adaptive?: boolean;
}

export interface ApiErrorShape {
  error?: string;
  message?: string;
  status?: number;
}

export interface SessionNote {
  noteId: string;
  noteType?: string;
  suggestion?: string;
  userText?: string;
  agentContext?: string;
  errorCategory?: string;
  priority?: number;
  timestamp?: string;
}

export interface AppConfig {
  apiBaseUrl: string;
  translationServiceUrl: string;
  defaultAgentId: string;
  defaultAgentName: string;
  defaultLanguage: string;
  demoAuthCode: string;
  developerMode: boolean;
  devUserProfile?: Partial<UserProfile> & { id: string } | null;
}

export interface SpanishSnippet {
  spanish: string;
  english?: string;
  context?: string;
}

export interface SessionHighlights {
  topics: string[];
  notableMoments: string[];
  learningFocus: string[];
  personalConnections: string[];
  spanishSnippets: SpanishSnippet[];
  errorInsights: string[];
}

export interface LocalizedSummary {
  text: string;
  language: string;
}

export interface SessionSummaryDetails {
  conversationId: string;
  createdAt: string;
  summary: string;
  highlights: SessionHighlights;
  episodicSummary?: string | null;
  localizedSummary?: LocalizedSummary | null;
}
