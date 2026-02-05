from dataclasses import dataclass
from typing import Optional, Dict
from datetime import datetime
import uuid

@dataclass
class VoiceSession:
    """Domain model for a tutoring voice session"""
    conversation_id: str
    user_id: uuid.UUID
    agent_id: str
    agent_name: str
    language: str
    status: str
    start_time: datetime
    model: Optional[str] = None  # GPT model for tutor analysis
    custom_context: Optional[Dict] = None
    
    def to_dict(self) -> Dict:
        return {
            "conversation_id": self.conversation_id,
            "user_id": str(self.user_id),
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "language": self.language,
            "status": self.status,
            "start_time": self.start_time.isoformat(),
            "model": self.model,
            "custom_context": self.custom_context
        }

@dataclass
class Agent:
    """ElevenLabs agent configuration"""
    agent_id: str
    name: str
    language: str
    context: str
    api_key: Optional[str] = None
    
    def to_dict(self) -> Dict:
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "language": self.language,
            "context": self.context,
            "api_key": self.api_key
        }
