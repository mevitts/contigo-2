import logging
from typing import Optional
from sqlmodel import Session
from domain.models import Agent
from config.agents import (
    get_agent as create_agent,
    get_difficulty_info,
    DifficultyLevel,
    SPANISH_AGENT,
    SPANISH_AGENTS
)
from config.settings import settings
from services.db_service import determine_starting_difficulty, engine

logger = logging.getLogger(__name__)

class AgentService:
    """Service for managing ElevenLabs agent configurations with adaptive difficulty"""
    
    def get_agent(
        self,
        difficulty: str = "intermediate",
        custom_instructions: Optional[str] = None,
        api_key: Optional[str] = None,
        use_adaptive: Optional[bool] = None
    ) -> Agent:
        """
        Get a configured Spanish tutor agent.
        
        Args:
            difficulty: Difficulty level ('beginner', 'intermediate', 'advanced')
            custom_instructions: Optional custom instructions
            api_key: Optional API key override
            use_adaptive: Optional override for adaptive difficulty (uses setting if None)
            
        Returns:
            Configured Agent object
        """
        # Determine if adaptive difficulty should be used
        adaptive = use_adaptive if use_adaptive is not None else settings.ENABLE_ADAPTIVE_DIFFICULTY
        
        logger.info(
            f"Getting Spanish tutor agent - difficulty: {difficulty}, adaptive: {adaptive}"
        )
        return create_agent(
            difficulty=difficulty,
            custom_instructions=custom_instructions,
            api_key=api_key or settings.elevenlabs_api_key,
            use_adaptive=adaptive
        )
    
    def get_adaptive_agent(
        self,
        user_id,
        api_key: Optional[str] = None,
        use_adaptive: Optional[bool] = None
    ) -> Agent:
        """
        Get a Spanish tutor agent with automatically determined difficulty based on user's learning history.
        
        Args:
            user_id: UUID of the user
            api_key: Optional API key override
            use_adaptive: Optional override for adaptive difficulty (uses setting if None)
            
        Returns:
            Configured Agent object with DB-determined difficulty
        """
        # Determine difficulty from database learning history
        with Session(engine) as session:
            difficulty = determine_starting_difficulty(session, user_id)
        
        adaptive = use_adaptive if use_adaptive is not None else settings.ENABLE_ADAPTIVE_DIFFICULTY
        
        logger.info(
            f"Getting adaptive Spanish tutor for user {user_id} - determined difficulty: {difficulty}, adaptive: {adaptive}"
        )
        return self.get_agent(
            difficulty=difficulty,
            api_key=api_key,
            use_adaptive=adaptive
        )
    
    def get_agent_info(self) -> dict:
        """
        Get information about the Spanish tutor agent.
        
        Returns:
            Agent configuration details
        """
        # Provide per-difficulty visibility so operators instantly see which
        # ElevenLabs agents are wired up without triggering KeyErrors.
        difficulty_configs = {
            level: {
                "configured": bool(agent_id),
                "agent_id": agent_id or None
            }
            for level, agent_id in SPANISH_AGENTS.items()
        }

        return {
            "name": SPANISH_AGENT["name"],
            "language": SPANISH_AGENT["language"],
            "configured": any(cfg["configured"] for cfg in difficulty_configs.values()),
            "difficulties": difficulty_configs
        }
    
    def validate_agent_config(self, agent: Agent) -> bool:
        """
        Validate that an agent is properly configured.
        
        Args:
            agent: The agent to validate
            
        Returns:
            True if valid, False otherwise
        """
        if not agent.agent_id:
            logger.error(f"Agent {agent.name} missing agent_id")
            return False
        
        if not agent.name or not agent.language:
            logger.error(f"Agent {agent.agent_id} missing required fields")
            return False
            
        return True

# Singleton instance
agent_service = AgentService()
