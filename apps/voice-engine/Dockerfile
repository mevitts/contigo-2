FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first (saves ~1.2GB vs full CUDA torch)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Copy and install remaining Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Run as non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Create HuggingFace cache directory owned by appuser BEFORE switching
RUN mkdir -p /home/appuser/.cache/huggingface && chown -R appuser:appgroup /home/appuser

RUN chown -R appuser:appgroup /app
USER appuser

# Pre-download the OPUS-MT translation model as appuser so permissions are correct
ENV HF_HOME=/home/appuser/.cache/huggingface
RUN python -c "from transformers import MarianMTModel, MarianTokenizer; \
    MarianTokenizer.from_pretrained('Helsinki-NLP/opus-mt-es-en'); \
    MarianMTModel.from_pretrained('Helsinki-NLP/opus-mt-es-en'); \
    print('OPUS-MT model downloaded successfully')"

# Expose the port the app runs on
EXPOSE 8000

# Set the entrypoint
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
