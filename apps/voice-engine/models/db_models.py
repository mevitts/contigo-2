import uuid
from datetime import datetime
from enum import Enum
from typing import List, Optional, ClassVar
from sqlmodel import Field, Relationship, SQLModel, Column, TEXT

class NoteType(str, Enum):
    GRAMMAR = "GRAMMAR"
    VOCAB = "VOCAB"
    VOCABULARY = "VOCABULARY"
    PRONUNCIATION = "PRONUNCIATION"
    FLUENCY = "FLUENCY"
    TOPIC_MENTION = "TOPIC_MENTION"
    CLUSTER = "CLUSTER"


class ReferenceType(str, Enum):
    SONG = "SONG"
    LYRICS = "LYRICS"
    ARTICLE = "ARTICLE"
    VIDEO = "VIDEO"
    BOOK_EXCERPT = "BOOK_EXCERPT"
    CULTURAL = "CULTURAL"
    OTHER = "OTHER"

class Users(SQLModel, table=True):
    # Force SQL table name to lowercase 'users'
    __tablename__: ClassVar[str] = "users"

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True, index=True)
    workos_id: str = Field(
        sa_column=Column("workos_id", TEXT, unique=True, index=True),
        description="Auth provider-issued user identifier"
    )
    email: str = Field(unique=True, index=True)
    name: Optional[str] = Field(default=None, sa_column=Column("name", TEXT))

    conversations: List["Conversations"] = Relationship(back_populates="user")
    learning_notes: List["LearningNotes"] = Relationship(back_populates="user")
    user_references: List["UserReferences"] = Relationship(back_populates="user")

class Conversations(SQLModel, table=True):
    # Force SQL table name to lowercase 'conversations'
    __tablename__: ClassVar[str] = "conversations"

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True, index=True)
    # Note: This foreign key string matches the new table name defined above
    user_id: uuid.UUID = Field(foreign_key="users.id")
    # Use start_time/end_time to match existing DB schema
    start_time: datetime = Field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    agent_display_name: Optional[str] = Field(default=None, sa_column=Column("agent_display_name", TEXT))
    language: Optional[str] = Field(default="es")
    difficulty: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    adaptive: bool = Field(default=False)
    topic: Optional[str] = Field(default=None, sa_column=Column(TEXT))

    user: "Users" = Relationship(back_populates="conversations")
    learning_notes: List["LearningNotes"] = Relationship(back_populates="conversation")

class LearningNotes(SQLModel, table=True):
    __tablename__: ClassVar[Optional[str]] = "learning_notes"

    note_id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id")
    conversation_id: uuid.UUID = Field(foreign_key="conversations.id")

    timestamp: datetime = Field(default_factory=datetime.utcnow)
    note_type: NoteType
    priority: int
    error_category: str
    user_text: str = Field(sa_column=Column(TEXT))
    agent_context: str = Field(sa_column=Column(TEXT))
    suggestion: str = Field(sa_column=Column(TEXT))

    user: "Users" = Relationship(back_populates="learning_notes")
    conversation: "Conversations" = Relationship(back_populates="learning_notes")


class SessionSummaries(SQLModel, table=True):
    __tablename__: ClassVar[str] = "session_summaries"

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    conversation_id: uuid.UUID = Field(foreign_key="conversations.id")
    user_id: uuid.UUID = Field(foreign_key="users.id")
    summary: str = Field(sa_column=Column(TEXT))
    highlights_json: str = Field(sa_column=Column(TEXT))
    episodic_summary: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserReferences(SQLModel, table=True):
    __tablename__: ClassVar[str] = "user_references"

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    conversation_id: Optional[uuid.UUID] = Field(default=None, foreign_key="conversations.id")

    title: str = Field(sa_column=Column(TEXT))
    reference_type: ReferenceType
    url: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    content_text: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    source: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    is_pinned: bool = Field(default=False)
    tags: Optional[str] = Field(default=None, sa_column=Column(TEXT))  # JSON array as TEXT
    notes: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    detected_context: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    detection_method: Optional[str] = Field(default=None, sa_column=Column(TEXT))  # "auto" | "manual"
    created_at: datetime = Field(default_factory=datetime.utcnow)

    user: "Users" = Relationship(back_populates="user_references")


class WeeklyArticles(SQLModel, table=True):
    __tablename__: ClassVar[str] = "weekly_articles"

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    url: str = Field(sa_column=Column(TEXT))
    title: str = Field(sa_column=Column(TEXT))
    author: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    source_name: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    content_text: str = Field(sa_column=Column(TEXT))
    summary: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    key_points: Optional[str] = Field(default=None, sa_column=Column(TEXT))  # JSON array as TEXT
    image_url: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    difficulty_level: Optional[str] = Field(default=None, sa_column=Column(TEXT))
    tags: Optional[str] = Field(default=None, sa_column=Column(TEXT))  # JSON array as TEXT
    is_active: bool = Field(default=True)
    week_start: datetime = Field(default_factory=datetime.utcnow)
    week_end: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserArticleAnalyses(SQLModel, table=True):
    __tablename__: ClassVar[str] = "user_article_analyses"

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    article_id: uuid.UUID = Field(foreign_key="weekly_articles.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    vocab_items: Optional[str] = Field(default=None, sa_column=Column(TEXT))  # JSON array as TEXT
    grammar_patterns: Optional[str] = Field(default=None, sa_column=Column(TEXT))  # JSON array as TEXT
    cultural_notes: Optional[str] = Field(default=None, sa_column=Column(TEXT))  # JSON array as TEXT
    personalized_tips: Optional[str] = Field(default=None, sa_column=Column(TEXT))  # JSON array as TEXT
    created_at: datetime = Field(default_factory=datetime.utcnow)