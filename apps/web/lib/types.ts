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

export type ReferenceType = 'SONG' | 'LYRICS' | 'ARTICLE' | 'VIDEO' | 'BOOK_EXCERPT' | 'CULTURAL' | 'OTHER';

export interface Reference {
  id: string;
  userId: string;
  conversationId?: string | null;
  title: string;
  referenceType: ReferenceType;
  url?: string | null;
  contentText?: string | null;
  source?: string | null;
  isPinned: boolean;
  tags?: string[] | null;
  notes?: string | null;
  detectedContext?: string | null;
  detectionMethod?: 'auto' | 'manual' | null;
  createdAt: string;
}

export interface DetectedReference {
  title: string;
  type: ReferenceType;
  source?: string;
  context: string;
  confidence: number;
}

export interface CreateReferenceRequest {
  userId: string;
  conversationId?: string | null;
  title: string;
  referenceType: ReferenceType;
  url?: string | null;
  contentText?: string | null;
  source?: string | null;
  isPinned?: boolean;
  tags?: string[] | null;
  notes?: string | null;
  detectedContext?: string | null;
  detectionMethod?: 'auto' | 'manual';
}

export interface UpdateReferenceRequest {
  title?: string;
  referenceType?: ReferenceType;
  url?: string | null;
  contentText?: string | null;
  source?: string | null;
  isPinned?: boolean;
  tags?: string[] | null;
  notes?: string | null;
}

// Weekly Reading Spotlight types

export interface WeeklyArticle {
  id: string;
  url: string;
  title: string;
  author?: string | null;
  sourceName?: string | null;
  contentText?: string | null;
  summary?: string | null;
  keyPoints: string[];
  imageUrl?: string | null;
  difficultyLevel?: string | null;
  tags: string[];
  isActive: boolean;
  weekStart?: string | null;
  weekEnd?: string | null;
  createdAt: string;
}

export interface ArticleVocabItem {
  word: string;
  translation: string;
  context?: string;
  levelNote?: string;
}

export interface ArticleGrammarPattern {
  pattern: string;
  example: string;
  explanation: string;
}

export interface ArticleCulturalNote {
  topic: string;
  explanation: string;
  connection?: string;
}

export interface ArticleAnalysis {
  id: string;
  articleId: string;
  userId: string;
  vocabItems: ArticleVocabItem[];
  grammarPatterns: ArticleGrammarPattern[];
  culturalNotes: ArticleCulturalNote[];
  personalizedTips: string[];
  createdAt: string;
}
