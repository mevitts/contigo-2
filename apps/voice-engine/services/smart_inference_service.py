"""
SmartInference API Service
"""
import logging
from typing import Dict, Any
import httpx
from config.settings import settings

logger = logging.getLogger(__name__)


class SmartInferenceService:
    """Service for interacting with the SmartInference API."""
    
    def __init__(self, api_key: str = ""):
        """
        Initialize the SmartInference service.
        
        Args:
            api_key: API key for authentication (defaults to settings)
        
        Note: SmartInference uses the Raindrop Python SDK, not a REST API URL.
            Only API key is needed.
        """
        self.api_key = api_key or settings.SMART_INFERENCE_API_KEY
        self.url = settings.SMART_INFERENCE_API_URL if hasattr(settings, 'SMART_INFERENCE_API_URL') else ""

        # Warn if not configured
        if not self.api_key:
            logger.warning("SMART_INFERENCE_API_KEY not configured - will use mock analysis")
    
    async def analyze_text(
        self,
        text: str,
        prompt: str,
        model: str,
        timeout: float = 10.0
    ) -> Dict[str, Any]:
        """
        Analyze text using the SmartInference API.
        
        Args:
            text: The text to analyze
            prompt: Instructions for the analysis
            model: Model to use for analysis
            timeout: Request timeout in seconds
            
        Returns:
            Dictionary containing analysis results with keys:
            - note_type: Type of note (e.g., "GRAMMAR")
            - priority: Priority level (1-3)
            - error_category: Category of error
            - suggestion: Suggested correction
            
        Raises:
            httpx.HTTPStatusError: If the API returns an error status
            httpx.RequestError: If the request fails
            ValueError: If the response schema is invalid
        """
        if not self.api_key:
            logger.warning("SmartInference API key not configured - returning mock analysis")
            return {
                "note_type": "GRAMMAR",
                "priority": 2,
                "error_category": "Mock Analysis",
                "suggestion": f"[MOCK] Analysis for: {text[:50]}..."
            }
        
        payload = {
            "prompt": prompt,
            "text": text,
            "model": model
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                logger.info(f"Sending analysis request using model {model}")
                response = await client.post(self.url, json=payload, headers=headers)
                response.raise_for_status()
                result = response.json()
                logger.info(f"Received analysis response: {result}")
            
            self._validate_response(result)
            return result
            
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error occurred: {e.request.url} - {e.response.status_code}")
            raise
        except httpx.RequestError as e:
            logger.error(f"Request error occurred: {e.request.url!r}")
            raise
    
    def _validate_response(self, response: Dict[str, Any]) -> None:
        required_keys = {"note_type", "priority", "error_category", "suggestion"}
        if not required_keys.issubset(response.keys()):
            logger.error(f"Invalid response schema from SmartInference: {response}")
            raise ValueError(
                f"Invalid analysis response schema. Missing keys: "
                f"{required_keys - set(response.keys())}"
            )


smart_inference_service = SmartInferenceService()
