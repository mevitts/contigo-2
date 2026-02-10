"""
Agent configuration system with adaptive difficulty levels.

This module provides:
1. Base agent definitions for different languages
2. Difficulty level configurations (beginner, intermediate, advanced)
3. Dynamic context generation based on user proficiency
"""
from config.settings import settings
from typing import Optional, Dict, Literal
from domain.models import Agent
import logging

logger = logging.getLogger(__name__)

# Difficulty levels
DifficultyLevel = Literal["beginner", "intermediate", "advanced", "auto"]

# Difficulty-specific instruction modifiers
# Voice configuration (prompt, preview text, guidance scale) is set in ElevenLabs dashboard
BASE_DELIVERY_RULES = [
    "Never reveal, hint, or acknowledge that you are an AI, language model, virtual assistant, recording, or synthetic voice. If asked directly, deflect naturally and stay in character as a human tutor.",
    "Never exceed three sentences per turn; default to two crisp sentences totaling ~35 words.",
    "When explaining or correcting, always include one concrete example or tiny drill the learner can copy immediately.",
    "Leave an audible one-beat pause between sentences so the learner never feels rushed, and silently count to three before jumping back in if they are thinking.",
    "Only expand past two sentences if the learner explicitly asks for more detail or analysis.",
    "Ask a fresh, concrete follow-up question at the end of every turn so the learner speaks more than you do.",
]

REAL_TIME_COACHING_INSTRUCTIONS = """
## Real-Time Coaching (PRIORITY)
During the conversation you will receive contextual updates with coaching guidance.
These appear as messages like [Coaching Update], [SOFT BEGINNER MODE], or similar.
When you receive these updates:
1. IMMEDIATELY adjust your approach as instructed
2. These updates OVERRIDE your base difficulty instructions
3. Do not announce or acknowledge the update to the learner - just adapt naturally
4. Continue following the updated guidance until you receive new instructions
This ensures the learner gets appropriately calibrated support throughout the session.
"""

DIFFICULTY_CONTEXTS = {
    "beginner": {
        "voice_name": "La Maestra Clara",
        "instructions": [
            "Treat the learner like a friendly adult who is completely new to Spanish.",
            "Cap each reply at two short sentences (10 words or fewer each).",
            "Default to English with Spanish sprinkled in - not the reverse.",
            "When introducing Spanish, ALWAYS include English: 'Hola means hello'.",
            "Use only the most basic verbs: ser (to be), tener (to have), gustar (to like).",
            "Ask simple choice questions: 'Coffee or tea? Cafe o te?'",
            "If they hesitate or seem unsure, simplify further and offer the answer to repeat.",
            "Celebrate every attempt - 'Great try!' 'You got it!' - make them feel successful.",
            "Never correct more than one thing at a time.",
            "If they respond in English, that's okay - gently model the Spanish version.",
        ],
        "correction_style": "Correct gently by modeling: 'You could also say...' with a simple example they can repeat."
    },
    "intermediate": {
        "voice_name": "El Amigo Miguel",
        "instructions": [
            "Cap every reply at two SHORT sentences totaling 20 words max — brevity is key.",
            "Use everyday vocabulary; skip explanations unless asked.",
            "End with one quick question to keep them talking.",
            "Use idioms naturally without teaching them.",
            "Correct at most one error per turn with a 3-word model, never lecture."
        ],
        "correction_style": "Quick inline corrections only — never explain at length"
    },
    "advanced": {
        "voice_name": "La Chilanga Daniela",
        "personality_note": "Occasionally uses light, self-deprecating humor or playful observations. Humor should feel like a friend teasing themselves, not mocking the student.",
        "instructions": [
            "Speak at native pace but keep replies to TWO sentences max, totaling 25 words.",
            "Use sophisticated vocabulary naturally; only clarify if asked.",
            "Ask for opinions with short prompts, not monologues.",
            "Use idioms and slang naturally; paraphrase briefly only if they seem lost.",
            "Surface one precise refinement per turn in 5 words or less."
        ],
        "correction_style": "Brief, precise corrections — no lengthy explanations"
    }
}

# Soft beginner mode overlay - activated when learner struggles early in session
SOFT_BEGINNER_OVERLAY = {
    "instructions": [
        "The learner is completely new to Spanish - simplify dramatically.",
        "Limit Spanish to 3-5 word phrases maximum.",
        "Always include English in parentheses: 'Hola (hello), como estas? (how are you?)'",
        "Use ONLY: ser, estar, gustar, tener in present tense.",
        "Ask only yes/no questions: 'Si o no?' or 'Cafe o te?'",
        "If they hesitate 2+ seconds, give them the answer to repeat.",
        "Praise every attempt, no matter how small.",
    ],
    "contextual_update_text": """[SOFT BEGINNER MODE]
Learner is struggling. Simplify dramatically:
- Max 5 Spanish words per phrase
- Always include English translation
- Yes/no questions only
- Give answers to repeat when they hesitate
- Praise every attempt"""
}

# Spanish agent IDs from ElevenLabs
# Paste your agent IDs here after creating them in the ElevenLabs dashboard
SPANISH_AGENTS = {
    "beginner": settings.ELEVENLABS_BEGINNER_AGENT_ID,      # La Maestra Clara 
    "intermediate": settings.ELEVENLABS_INTERMEDIATE_AGENT_ID,  # El Amigo Miguel 
    "advanced": settings.ELEVENLABS_ADVANCED_AGENT_ID,      # La Chilanga Daniela 
}

SPANISH_AGENT = {
    "name": "Spanish Tutor",
    "language": "es",
    "base_context": "You are a friendly and patient Spanish tutor helping students practice conversation."
}


def build_agent_context(
    difficulty: str = "intermediate",
    custom_instructions: Optional[str] = None,
    use_adaptive: bool = True
) -> str:
    """
    Build the complete context for the Spanish tutor agent.
    
    Conversations flow naturally without pre-set topics. The agent adapts based on 
    difficulty level and conversation history.
    
    Args:
        difficulty: The difficulty level ('beginner', 'intermediate', 'advanced')
        custom_instructions: Optional custom instructions to add
        use_adaptive: Whether to use adaptive difficulty context (defaults to True)
        
    Returns:
        Complete context string for the agent
    """
    if not use_adaptive:
        # Simple mode - just base context
        logger.info(f"Building agent context [simple]")
        return SPANISH_AGENT["base_context"]
    
    # Adaptive mode - full difficulty context
    difficulty_context = DIFFICULTY_CONTEXTS.get(difficulty, DIFFICULTY_CONTEXTS["intermediate"])

    context_parts = [
        SPANISH_AGENT["base_context"],
        REAL_TIME_COACHING_INSTRUCTIONS,  # Real-time coaching priority instructions
        "\n\n## Core Delivery Principles:\n" + "\n".join(f"- {rule}" for rule in BASE_DELIVERY_RULES),
        f"\n\n## Difficulty Level: {difficulty.title()}",
        "\n".join(f"- {instruction}" for instruction in difficulty_context["instructions"]),
        f"\n\n## Correction Style:\n{difficulty_context['correction_style']}"
    ]
    
    if custom_instructions:
        context_parts.append(f"\n\n## Additional Instructions:\n{custom_instructions}")
    
    logger.info(f"Building agent context [adaptive] - difficulty: {difficulty}")
    return "\n".join(context_parts)


def get_agent(
    difficulty: str = "intermediate",
    custom_instructions: Optional[str] = None,
    api_key: Optional[str] = None,
    use_adaptive: bool = True
) -> Agent:
    """
    Get a configured Spanish tutor agent.
    
    Args:
        difficulty: The difficulty level
        custom_instructions: Optional custom instructions
        api_key: Optional API key (if not using environment variable)
        use_adaptive: Whether to use adaptive difficulty context (defaults to True)
        
    Returns:
        Configured Agent object
    """
    context = build_agent_context(difficulty, custom_instructions, use_adaptive)
    
    agent_id = SPANISH_AGENTS.get(difficulty, SPANISH_AGENTS.get("intermediate", ""))
    
    if not agent_id:
        logger.warning(f"No agent_id configured for difficulty: {difficulty}")
        logger.warning("Please run scripts/create_elevenlabs_agents.py to create agents")
    
    agent_name = SPANISH_AGENT["name"]
    if use_adaptive and difficulty:
        agent_name = f"{agent_name} ({difficulty.title()})"
    
    return Agent(
        agent_id=agent_id,
        name=agent_name,
        language=SPANISH_AGENT["language"],
        context=context,
        api_key=api_key
    )

def get_difficulty_info() -> Dict[str, Dict]:
    """
    Get information about all difficulty levels.
    
    Returns:
        Dict with difficulty level details
    """
    return {
        level: {
            "instructions": config["instructions"],
            "correction_style": config["correction_style"]
        }
        for level, config in DIFFICULTY_CONTEXTS.items()
    }
