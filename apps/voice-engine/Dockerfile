FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the OPUS-MT translation model so it's ready at runtime
RUN python -c "from transformers import MarianMTModel, MarianTokenizer; \
    MarianTokenizer.from_pretrained('Helsinki-NLP/opus-mt-es-en'); \
    MarianMTModel.from_pretrained('Helsinki-NLP/opus-mt-es-en'); \
    print('OPUS-MT model downloaded successfully')"

# Copy the rest of the application code
COPY . .

# Run as non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
RUN chown -R appuser:appgroup /app
USER appuser

# Expose the port the app runs on
EXPOSE 8000

# Set the entrypoint
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
